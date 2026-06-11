import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PLANS, type PlanId } from '../billing/plans.config';

@Injectable()
export class WorkspacesService {
  private readonly supabase: SupabaseClient;
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(private readonly configService: ConfigService) {
    this.supabase = createClient(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
      this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  // ─────────────────────────────────────────────
  //  GET /workspaces/settings
  // ─────────────────────────────────────────────

  async getSettings(workspaceId: string): Promise<{
    allowed_domains: string[];
    max_allowed_domains: number;
    plan: string;
  }> {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('allowed_domains, plan')
      .eq('id', workspaceId)
      .single();

    if (error) {
      this.logger.error('Failed to fetch workspace settings', error);
      throw new InternalServerErrorException('Could not retrieve workspace settings.');
    }

    const plan = (data.plan as PlanId) ?? 'free';
    const max_allowed_domains = PLANS[plan]?.maxAllowedDomains ?? PLANS.free.maxAllowedDomains;

    return {
      allowed_domains: (data.allowed_domains as string[]) ?? [],
      max_allowed_domains,
      plan,
    };
  }

  // ─────────────────────────────────────────────
  //  POST /workspaces/allowed-domains
  // ─────────────────────────────────────────────

  async updateAllowedDomains(
    workspaceId: string,
    domains: string[],
  ): Promise<{ allowed_domains: string[] }> {
    // ADDED: require at least one domain — empty list would silently block
    // all widget traffic, so we surface an explicit error instead.
    if (domains.length === 0) {
      throw new BadRequestException(
        'At least one domain is required. ' +
        'The widget will not serve stories until a domain is configured.',
      );
    }

    // Step 1: Fetch current workspace plan
    const { data: workspace, error: fetchError } = await this.supabase
      .from('workspaces')
      .select('plan')
      .eq('id', workspaceId)
      .single();

    if (fetchError) {
      this.logger.error('Failed to fetch workspace plan for domain limit check', fetchError);
      throw new InternalServerErrorException('Could not verify plan limits.');
    }

    // Step 2: Resolve the domain limit for this plan
    const plan = (workspace.plan as PlanId) ?? 'free';
    const limit = PLANS[plan]?.maxAllowedDomains ?? PLANS.free.maxAllowedDomains;

    // Step 3: Enforce the plan limit
    if (domains.length > limit) {
      throw new BadRequestException(
        `Your ${plan} plan allows a maximum of ${limit} domain${limit === 1 ? '' : 's'}. Upgrade your plan to add more.`,
      );
    }

    const { error } = await this.supabase
      .from('workspaces')
      .update({ allowed_domains: domains })
      .eq('id', workspaceId);

    if (error) {
      this.logger.error('Failed to update allowed_domains', error);
      throw new InternalServerErrorException('Could not update allowed domains.');
    }

    return { allowed_domains: domains };
  }
}

