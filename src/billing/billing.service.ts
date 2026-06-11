import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import StripeSDK = require('stripe');
import { PLANS, PlanId, CorePlanId, PlanLimits } from './plans.config';
import { PlanLimitExceededException } from './exceptions/plan-limit-exceeded.exception';


// ── Stripe types derived from the instance (avoids broken namespace access in v22) ──
type StripeInstance        = StripeSDK.Stripe;
type StripeEvent           = Awaited<ReturnType<StripeInstance['events']['retrieve']>>;
type StripeSubscription    = Awaited<ReturnType<StripeInstance['subscriptions']['retrieve']>>;
type StripeInvoice         = Awaited<ReturnType<StripeInstance['invoices']['retrieve']>>;
type StripeCheckoutSession = Awaited<ReturnType<StripeInstance['checkout']['sessions']['retrieve']>>;

// Event types that must be deduplicated via processed_stripe_events table.
const IDEMPOTENT_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
]);

// Postgres max int — treated as Infinity for plan limits
const PG_MAX_INT = 2147483647;

type PlanConfigResult = PlanLimits & {
  stripe_price_id:  string | null;
  display_name:     string;
  price_monthly:    number;
};

type PaymentMethodInfo = {
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
} | null;

@Injectable()
export class BillingService {
  private readonly supabase: SupabaseClient;
  private readonly stripe: StripeInstance;
  private readonly logger = new Logger(BillingService.name);

  // ── In-memory plan cache ──────────────────────────────────
  private planCache = new Map<string, { data: PlanConfigResult; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 30_000; // 30 seconds

  constructor(private readonly configService: ConfigService) {
    this.supabase = createClient(
      this.configService.getOrThrow('SUPABASE_URL'),
      this.configService.getOrThrow('SUPABASE_SERVICE_ROLE_KEY'),
    );

    this.stripe = new StripeSDK(
      this.configService.getOrThrow('STRIPE_SECRET_KEY'),
      { apiVersion: '2026-04-22.dahlia' },
    );
  }

  // ─────────────────────────────────────────────
  //  Plan config cache + DB lookup
  // ─────────────────────────────────────────────

  private async getPlanConfig(planId: string): Promise<PlanConfigResult> {
    // 1. Cache hit
    const cached = this.planCache.get(planId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    // 2. DB query
    const { data: row, error } = await this.supabase
      .from('plan_configs')
      .select('*')
      .eq('plan_id', planId)
      .limit(1)
      .maybeSingle();

    if (error || !row) {
      this.logger.warn(
        `getPlanConfig: could not load plan '${planId}' from DB (${error?.message ?? 'no row'}) — using hardcoded fallback`,
      );
      // 3. Fallback to hardcoded PLANS constant
      const fallbackLimits = PLANS[planId as CorePlanId] ?? PLANS['free'];
      // Hardcoded display names / prices for core plans only
      const FALLBACK_META: Record<string, { display_name: string; price_monthly: number }> = {
        free:     { display_name: 'Free',     price_monthly: 0    },
        pro:      { display_name: 'Pro',      price_monthly: 2900 },
        business: { display_name: 'Business', price_monthly: 9900 },
      };
      const meta = FALLBACK_META[planId] ?? { display_name: planId, price_monthly: 0 };
      return { ...fallbackLimits, stripe_price_id: null, ...meta };
    }

    // 4. Map DB row
    const result: PlanConfigResult = {
      maxStories:        row.max_stories        as number,
      maxMonthlyViews:   row.max_monthly_views   as number,
      maxAllowedDomains: row.max_allowed_domains as number,
      stripe_price_id:   (row.stripe_price_id   as string | null) ?? null,
      display_name:      (row.display_name      as string) ?? planId,
      price_monthly:     (row.price_monthly     as number) ?? 0,
    };

    // 5. Store in cache
    this.planCache.set(planId, { data: result, expiresAt: Date.now() + this.CACHE_TTL_MS });

    // 6. Return
    return result;
  }

  // ─────────────────────────────────────────────
  //  Public plans (pricing page — no auth, no stripe_price_id)
  // ─────────────────────────────────────────────

  async getPublicPlans(): Promise<Omit<{
    id: string;
    plan_id: string;
    display_name: string;
    price_monthly: number;
    stripe_price_id: string | null;
    max_stories: number;
    max_monthly_views: number;
    max_allowed_domains: number;
    is_active: boolean;
    sort_order: number;
    features: string[];
  }, 'stripe_price_id'>[]> {
    const { data, error } = await this.supabase
      .from('plan_configs')
      .select(
        'id, plan_id, display_name, price_monthly, max_stories, max_monthly_views, max_allowed_domains, is_active, sort_order, features',
      )
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error || !data || data.length === 0) {
      this.logger.warn(
        `getPublicPlans: DB query failed (${error?.message ?? 'empty result'}) — returning hardcoded fallback`,
      );
      return [
        {
          id: 'fallback-free',
          plan_id: 'free',
          display_name: 'Free',
          price_monthly: 0,
          max_stories: 5,
          max_monthly_views: 1000,
          max_allowed_domains: 1,
          is_active: true,
          sort_order: 0,
          features: ['5 stories', '1,000 monthly views', 'Basic analytics', 'Widget embed'],
        },
        {
          id: 'fallback-pro',
          plan_id: 'pro',
          display_name: 'Pro',
          price_monthly: 2900,
          max_stories: 50,
          max_monthly_views: 50000,
          max_allowed_domains: 3,
          is_active: true,
          sort_order: 1,
          features: [
            '50 stories',
            '50,000 monthly views',
            'Advanced analytics',
            'Widget embed',
            'Custom branding',
            'Priority support',
          ],
        },
        {
          id: 'fallback-business',
          plan_id: 'business',
          display_name: 'Business',
          price_monthly: 9900,
          max_stories: 2147483647,
          max_monthly_views: 2147483647,
          max_allowed_domains: 10,
          is_active: true,
          sort_order: 2,
          features: [
            'Unlimited stories',
            'Unlimited views',
            'Advanced analytics',
            'Widget embed',
            'Custom branding',
            'Priority support',
            'SLA support',
          ],
        },
      ];
    }

    return data as Omit<{
      id: string;
      plan_id: string;
      display_name: string;
      price_monthly: number;
      stripe_price_id: string | null;
      max_stories: number;
      max_monthly_views: number;
      max_allowed_domains: number;
      is_active: boolean;
      sort_order: number;
      features: string[];
    }, 'stripe_price_id'>[];
  }

  public invalidatePlanCache(planId?: string): void {
    if (planId !== undefined) {
      this.planCache.delete(planId);
    } else {
      this.planCache.clear();
    }
  }

  // ─────────────────────────────────────────────
  //  Price ID helpers
  // ─────────────────────────────────────────────

  private async getPriceId(plan: 'pro' | 'business'): Promise<string> {
    const config = await this.getPlanConfig(plan);

    if (config.stripe_price_id && config.stripe_price_id.trim() !== '') {
      return config.stripe_price_id;
    }

    const envKey  = plan === 'pro' ? 'STRIPE_PRICE_PRO' : 'STRIPE_PRICE_BUSINESS';
    const priceId = this.configService.get<string>(envKey);
    if (!priceId || priceId.startsWith('__unset')) {
      throw new BadRequestException(`No Stripe price configured for plan: ${plan}`);
    }
    return priceId;
  }

  private async mapPriceIdToPlan(priceId: string): Promise<PlanId> {
    const { data: row, error } = await this.supabase
      .from('plan_configs')
      .select('plan_id')
      .eq('stripe_price_id', priceId)
      .limit(1)
      .maybeSingle();

    if (!error && row?.plan_id) {
      return row.plan_id as PlanId;
    }

    const proPriceId      = this.configService.get<string>('STRIPE_PRICE_PRO');
    const businessPriceId = this.configService.get<string>('STRIPE_PRICE_BUSINESS');

    if (priceId === businessPriceId) return 'business';
    if (priceId === proPriceId)      return 'pro';

    this.logger.warn(`Unrecognised Stripe price ID: ${priceId} — defaulting to 'pro'`);
    return 'pro';
  }

  // ─────────────────────────────────────────────
  //  Checkout session
  // ─────────────────────────────────────────────

  async createCheckoutSession(workspaceId: string, plan: 'pro' | 'business') {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required to create a checkout session.');
    }

    const priceId    = await this.getPriceId(plan);
    const customerId = await this.getOrCreateCustomer(workspaceId);
    const successUrl = this.configService.getOrThrow('STRIPE_SUCCESS_URL');
    const cancelUrl  = this.configService.getOrThrow('STRIPE_CANCEL_URL');

    const session = await this.stripe.checkout.sessions.create({
      mode:        'subscription',
      customer:    customerId,
      line_items:  [{ price: priceId, quantity: 1 }],
      metadata:    { workspace_id: workspaceId },
      success_url: successUrl,
      cancel_url:  cancelUrl,
    });

    this.logger.log(
      `Checkout session ${session.id} created for workspace ${workspaceId} (plan: ${plan})`,
    );

    return { url: session.url };
  }

  // ─────────────────────────────────────────────
  //  Customer portal
  // ─────────────────────────────────────────────

  async createPortalSession(workspaceId: string) {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('stripe_customer_id')
      .eq('id', workspaceId)
      .single();

    if (error || !data?.stripe_customer_id) {
      throw new BadRequestException(
        'No billing account found for this workspace. Complete a subscription first.',
      );
    }

    const returnUrl = this.configService.getOrThrow('STRIPE_SUCCESS_URL');

    const session = await this.stripe.billingPortal.sessions.create({
      customer:   data.stripe_customer_id,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  // ─────────────────────────────────────────────
  //  Webhook
  // ─────────────────────────────────────────────

  async handleWebhook(rawBody: Buffer | string, signature: string) {
    const secret = this.configService.getOrThrow('STRIPE_WEBHOOK_SECRET');

    let event: StripeEvent;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret) as StripeEvent;
    } catch (err) {
      this.logger.error('Webhook signature verification failed', err);
      throw new BadRequestException('Invalid webhook signature.');
    }

    this.logger.log(`Stripe webhook received: ${event.type}`);

    if (IDEMPOTENT_EVENT_TYPES.has(event.type)) {
      const alreadyProcessed = await this.isEventProcessed(event.id);
      if (alreadyProcessed) {
        this.logger.log(`Duplicate webhook skipped: ${event.id} (${event.type})`);
        return { received: true };
      }
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event.data.object as StripeCheckoutSession);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event.data.object as StripeSubscription);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object as StripeSubscription);
        break;
      case 'invoice.payment_failed':
        await this.onPaymentFailed(event.data.object as StripeInvoice);
        break;
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }

    if (IDEMPOTENT_EVENT_TYPES.has(event.type)) {
      await this.markEventProcessed(event.id);
    }

    return { received: true };
  }

  // ─────────────────────────────────────────────
  //  Plan limit guards (used by PlanGuard)
  // ─────────────────────────────────────────────

  async checkStoryLimit(workspaceId: string): Promise<void> {
    const plan   = await this.getWorkspacePlan(workspaceId);
    const limits = await this.getPlanConfig(plan);
    if (limits.maxStories >= PG_MAX_INT) return;

    const { count, error } = await this.supabase
      .from('stories')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);

    if (error) {
      this.logger.error('Failed to count stories', error);
      throw new InternalServerErrorException('Could not verify plan limits.');
    }

    const current = count ?? 0;
    if (current >= limits.maxStories) {
      throw new PlanLimitExceededException({
        limit_type: 'stories',
        current,
        limit: limits.maxStories,
        plan,
      });
    }
  }

  async checkViewLimit(workspaceId: string): Promise<void> {
    const plan   = await this.getWorkspacePlan(workspaceId);
    const limits = await this.getPlanConfig(plan);
    if (limits.maxMonthlyViews >= PG_MAX_INT) return;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count, error } = await this.supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('event_type', 'story_view')
      .gte('created_at', startOfMonth.toISOString());

    if (error) {
      this.logger.error('Failed to count monthly views', error);
      throw new InternalServerErrorException('Could not verify plan limits.');
    }

    const current = count ?? 0;
    if (current >= limits.maxMonthlyViews) {
      throw new PlanLimitExceededException({
        limit_type: 'views',
        current,
        limit: limits.maxMonthlyViews,
        plan,
      });
    }
  }

  // ─────────────────────────────────────────────
  //  Billing status
  // ─────────────────────────────────────────────

  async getStatus(workspaceId: string) {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('plan, subscription_status, stripe_subscription_id')
      .eq('id', workspaceId)
      .single();

    if (error) throw new InternalServerErrorException('Could not fetch billing status.');

    const plan: PlanId = (data.plan as PlanId) ?? 'free';
    const config = await this.getPlanConfig(plan);

    // Map PG_MAX_INT → Infinity so the frontend can treat it as "unlimited"
    const limits = {
      maxStories:        config.maxStories        >= PG_MAX_INT ? Infinity : config.maxStories,
      maxMonthlyViews:   config.maxMonthlyViews   >= PG_MAX_INT ? Infinity : config.maxMonthlyViews,
      maxAllowedDomains: config.maxAllowedDomains,
    };

    const base = {
      plan,
      plan_display_name:      config.display_name,
      plan_price_monthly:     config.price_monthly,
      subscription_status:    data.subscription_status    ?? null,
      stripe_subscription_id: data.stripe_subscription_id ?? null,
      limits,
      current_period_end:   null as string | null,
      cancel_at_period_end: false,
    };

    if (!data.stripe_subscription_id) return base;

    try {
      const subscription = await this.stripe.subscriptions.retrieve(
        data.stripe_subscription_id,
      );

      return {
        ...base,
        current_period_end: new Date((subscription as any).current_period_end * 1000).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
      };
    } catch (err) {
      this.logger.error(
        `Failed to retrieve Stripe subscription ${data.stripe_subscription_id} for workspace ${workspaceId}`,
        err,
      );
      return base;
    }
  }

  // ─────────────────────────────────────────────
  //  Plan change (upgrade / downgrade)
  // ─────────────────────────────────────────────

  async changePlan(workspaceId: string, newPlan: 'pro' | 'business') {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('plan, stripe_subscription_id')
      .eq('id', workspaceId)
      .single();

    if (error) throw new InternalServerErrorException('Could not fetch workspace.');

    if (!data.stripe_subscription_id) {
      throw new BadRequestException(
        'No active subscription found. Please use checkout to subscribe.',
      );
    }

    if (newPlan === (data.plan as string)) {
      throw new BadRequestException('You are already on this plan.');
    }

    const newPriceId = await this.getPriceId(newPlan);

    const subscription = await this.stripe.subscriptions.retrieve(
      data.stripe_subscription_id,
    );

    const currentItemId = subscription.items.data[0].id;

    await this.stripe.subscriptions.update(data.stripe_subscription_id, {
      items: [{ id: currentItemId, price: newPriceId }],
      proration_behavior: 'create_prorations',
    });

    // Optimistically update workspace plan (webhook confirms)
    await this.upsertWorkspaceBilling(workspaceId, { plan: newPlan });

    this.invalidatePlanCache(newPlan);

    return this.getStatus(workspaceId);
  }

  // ─────────────────────────────────────────────
  //  Cancel subscription
  // ─────────────────────────────────────────────

  async cancelSubscription(workspaceId: string): Promise<{ success: boolean; cancel_at_period_end: boolean }> {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('stripe_subscription_id')
      .eq('id', workspaceId)
      .single();

    if (error) throw new InternalServerErrorException('Could not fetch workspace.');

    if (!data?.stripe_subscription_id) {
      throw new BadRequestException('No active subscription to cancel.');
    }

    await this.stripe.subscriptions.update(data.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    this.logger.log(`Workspace ${workspaceId} subscription set to cancel at period end`);

    return { success: true, cancel_at_period_end: true };
  }

  // ─────────────────────────────────────────────
  //  Reactivate subscription
  // ─────────────────────────────────────────────

  async reactivateSubscription(workspaceId: string): Promise<{ success: boolean; cancel_at_period_end: boolean }> {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('stripe_subscription_id')
      .eq('id', workspaceId)
      .single();

    if (error) throw new InternalServerErrorException('Could not fetch workspace.');

    if (!data?.stripe_subscription_id) {
      throw new BadRequestException('No subscription found to reactivate.');
    }

    await this.stripe.subscriptions.update(data.stripe_subscription_id, {
      cancel_at_period_end: false,
    });

    this.logger.log(`Workspace ${workspaceId} subscription reactivated`);

    return { success: true, cancel_at_period_end: false };
  }

  // ─────────────────────────────────────────────
  //  Get payment method
  // ─────────────────────────────────────────────

  async getPaymentMethod(workspaceId: string): Promise<PaymentMethodInfo> {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('stripe_subscription_id')
      .eq('id', workspaceId)
      .single();

    if (error || !data?.stripe_subscription_id) return null;

    try {
      const subscription = await this.stripe.subscriptions.retrieve(
        data.stripe_subscription_id,
        { expand: ['default_payment_method'] },
      );

      const pm = subscription.default_payment_method;

      if (pm && typeof pm === 'object' && 'card' in pm && pm.card) {
        return {
          brand:     pm.card.brand     as string,
          last4:     pm.card.last4     as string,
          exp_month: pm.card.exp_month as number,
          exp_year:  pm.card.exp_year  as number,
        };
      }

      return null;
    } catch (err) {
      this.logger.error(`getPaymentMethod: Stripe error for workspace ${workspaceId}`, err);
      return null;
    }
  }

  // ─────────────────────────────────────────────
  //  Setup intent (for updating payment method)
  // ─────────────────────────────────────────────

  async createSetupIntent(workspaceId: string): Promise<{ client_secret: string | null }> {
    const customerId = await this.getOrCreateCustomer(workspaceId);

    const setupIntent = await this.stripe.setupIntents.create({
      customer:  customerId,
      usage:     'off_session',
    });

    return { client_secret: setupIntent.client_secret };
  }

  // ─────────────────────────────────────────────
  //  Confirm / attach new payment method
  // ─────────────────────────────────────────────

  async confirmPaymentMethod(workspaceId: string, paymentMethodId: string): Promise<PaymentMethodInfo> {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('id', workspaceId)
      .single();

    if (error) throw new InternalServerErrorException('Could not fetch workspace.');

    if (!data?.stripe_customer_id) {
      throw new BadRequestException('No billing account found.');
    }

    try {
      await this.stripe.paymentMethods.attach(paymentMethodId, {
        customer: data.stripe_customer_id,
      });

      await this.stripe.customers.update(data.stripe_customer_id, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });

      if (data.stripe_subscription_id) {
        await this.stripe.subscriptions.update(data.stripe_subscription_id, {
          default_payment_method: paymentMethodId,
        });
      }

      const pm = await this.stripe.paymentMethods.retrieve(paymentMethodId);

      return {
        brand:     pm.card?.brand     ?? null,
        last4:     pm.card?.last4     ?? null,
        exp_month: pm.card?.exp_month ?? null,
        exp_year:  pm.card?.exp_year  ?? null,
      } as PaymentMethodInfo;
    } catch (err) {
      this.logger.error(`confirmPaymentMethod: Stripe error for workspace ${workspaceId}`, err);
      throw new InternalServerErrorException('Failed to update payment method.');
    }
  }

  // ─────────────────────────────────────────────
  //  Private webhook handlers
  // ─────────────────────────────────────────────

  private async onCheckoutCompleted(session: StripeCheckoutSession) {
    const workspaceId = session.metadata?.workspace_id;

    this.logger.log(`checkout.session.completed — session.id: ${session.id}`);
    this.logger.log(`SESSION METADATA: ${JSON.stringify(session.metadata)}`);

    if (!workspaceId) {
      this.logger.warn(
        'checkout.session.completed received but workspace_id is missing from metadata. ' +
        'This usually means workspaceId was undefined when the session was created (stale JWT). ' +
        'The user must log out and log in again before upgrading.',
      );
      return;
    }

    const subscription = await this.stripe.subscriptions.retrieve(
      session.subscription as string,
    );

    const priceId      = subscription.items.data[0]?.price?.id;
    const plan: PlanId = priceId ? await this.mapPriceIdToPlan(priceId) : 'pro';

    await this.upsertWorkspaceBilling(workspaceId, {
      plan,
      stripe_customer_id:     session.customer as string,
      stripe_subscription_id: subscription.id,
      subscription_status:    'active',
    });

    this.logger.log(
      `Workspace ${workspaceId} upgraded to plan '${plan}' via subscription ${subscription.id}`,
    );
  }

  private async onSubscriptionUpdated(subscription: StripeSubscription) {
    const workspaceId = await this.findWorkspaceBySubscription(subscription.id);
    if (!workspaceId) return;

    const priceId    = subscription.items.data[0]?.price?.id;
    const mappedPlan = priceId ? await this.mapPriceIdToPlan(priceId) : 'pro';
    const isActive   = ['active', 'trialing'].includes(subscription.status);

    await this.upsertWorkspaceBilling(workspaceId, {
      plan:                isActive ? mappedPlan : 'free',
      subscription_status: subscription.status,
    });
  }

  private async onSubscriptionDeleted(subscription: StripeSubscription) {
    const workspaceId = await this.findWorkspaceBySubscription(subscription.id);
    if (!workspaceId) return;

    await this.upsertWorkspaceBilling(workspaceId, {
      plan:                   'free',
      subscription_status:    'canceled',
      stripe_subscription_id: null,
    });
  }

  private async onPaymentFailed(invoice: StripeInvoice) {
    const rawSub = (invoice as any).parent?.subscription_details?.subscription
      ?? (invoice as any).subscription;
    const subscriptionId = typeof rawSub === 'string' ? rawSub : rawSub?.id;
    if (!subscriptionId) return;

    const workspaceId = await this.findWorkspaceBySubscription(subscriptionId);
    if (!workspaceId) return;

    await this.upsertWorkspaceBilling(workspaceId, { subscription_status: 'past_due' });
  }

  // ─────────────────────────────────────────────
  //  Idempotency helpers
  // ─────────────────────────────────────────────

  private async isEventProcessed(stripeEventId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('processed_stripe_events')
      .select('stripe_event_id')
      .eq('stripe_event_id', stripeEventId)
      .maybeSingle();

    if (error) {
      this.logger.error('Failed to check processed_stripe_events', error);
      return false;
    }

    return data !== null;
  }

  private async markEventProcessed(stripeEventId: string): Promise<void> {
    const { error } = await this.supabase
      .from('processed_stripe_events')
      .insert({ stripe_event_id: stripeEventId });

    if (error) {
      this.logger.error('Failed to record processed_stripe_events entry', error);
    }
  }

  // ─────────────────────────────────────────────
  //  Private helpers
  // ─────────────────────────────────────────────

  private async getWorkspacePlan(workspaceId: string): Promise<PlanId> {
    const { data } = await this.supabase
      .from('workspaces')
      .select('plan')
      .eq('id', workspaceId)
      .maybeSingle();

    return (data?.plan as PlanId) ?? 'free';
  }

  private async getOrCreateCustomer(workspaceId: string): Promise<string> {
    const { data } = await this.supabase
      .from('workspaces')
      .select('stripe_customer_id, name')
      .eq('id', workspaceId)
      .single();

    if (data?.stripe_customer_id) return data.stripe_customer_id;

    const customer = await this.stripe.customers.create({
      metadata: { workspace_id: workspaceId },
      name:     data?.name ?? undefined,
    });

    await this.supabase
      .from('workspaces')
      .update({ stripe_customer_id: customer.id })
      .eq('id', workspaceId);

    this.logger.log(`Created Stripe customer ${customer.id} for workspace ${workspaceId}`);

    return customer.id;
  }

  private async findWorkspaceBySubscription(subscriptionId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('workspaces')
      .select('id')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle();

    if (!data) {
      this.logger.warn(`No workspace found for subscription ${subscriptionId}`);
      return null;
    }

    return data.id;
  }

  private async upsertWorkspaceBilling(
    workspaceId: string,
    fields: {
      plan?: PlanId;
      stripe_customer_id?: string;
      stripe_subscription_id?: string | null;
      subscription_status?: string;
    },
  ) {
    const { error } = await this.supabase
      .from('workspaces')
      .update(fields)
      .eq('id', workspaceId);

    if (error) {
      this.logger.error('Failed to update workspace billing fields', error);
      throw new InternalServerErrorException('Failed to update billing status.');
    }
  }
}