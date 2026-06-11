import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CategoriesService } from '../categories/categories.service';
import { EventItemDto } from './dto/create-events.dto';

const WIDGET_STORY_SELECT = `
  id,
  title,
  category_id,
  cover_image_url,
  logo_url,
  thumbnail_url,
  slides,
  config,
  published_at
`;

// Hard ceiling — prevents accidentally returning thousands of stories
const MAX_LIMIT = 50;

export interface CategoryFontInfo {
  font_family: string;
  custom_font_url: string | null;
  card_shape: string;
}

@Injectable()
export class WidgetService {
  private readonly supabase: SupabaseClient;
  private readonly logger = new Logger(WidgetService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly categoriesService: CategoriesService,
  ) {
    this.supabase = createClient(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
      this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  // ─────────────────────────────────────────────
  //  Subscription enforcement
  // ─────────────────────────────────────────────

  private async assertSubscriptionActive(workspaceId: string): Promise<void> {
    const { data: workspace, error } = await this.supabase
      .from('workspaces')
      .select('plan, subscription_status')
      .eq('id', workspaceId)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `assertSubscriptionActive: failed to fetch workspace ${workspaceId}`,
        error,
      );
      throw new InternalServerErrorException('Could not verify subscription.');
    }

    const plan: string        = workspace?.plan ?? 'free';
    const status: string | null = workspace?.subscription_status ?? null;

    if (plan === 'free') return;
    if (status === null) return;
    if (status === 'active' || status === 'trialing') return;

    if (status === 'past_due') {
      this.logger.warn(
        `Workspace ${workspaceId} is past_due — serving widget with grace period`,
      );
      return;
    }

    if (status === 'canceled') {
      this.logger.error(`Workspace ${workspaceId} blocked — subscription canceled`);
      throw new ForbiddenException('Subscription has been canceled.');
    }

    if (status === 'unpaid') {
      this.logger.error(`Workspace ${workspaceId} blocked — subscription unpaid`);
      throw new ForbiddenException('Subscription payment is overdue.');
    }
  }

  // ─────────────────────────────────────────────
  //  POST /widget/events — bulk insert, single query
  // ─────────────────────────────────────────────

  async trackEvents(workspaceId: string, events: EventItemDto[]) {
    if (!events?.length) return { inserted: 0 };

    const rows = events.map((e) => ({
      workspace_id: workspaceId,
      story_id:     e.story_id,
      session_id:   e.session_id,
      event_type:   e.event_type,
      slide_index:  e.slide_index ?? null,
      referrer_url: e.referrer_url ?? null,
    }));

    const { error } = await this.supabase.from('events').insert(rows);

    if (error) {
      this.logger.error('Failed to bulk-insert events', error);
      throw new InternalServerErrorException('Could not record events.');
    }

    return { inserted: rows.length };
  }

  // ─────────────────────────────────────────────
  //  GET /widget/stories — optional category + limit
  //  Returns { stories, category } where category
  //  contains font_family and custom_font_url.
  // ─────────────────────────────────────────────

  async findPublished(
    workspaceId: string,
    categorySlug?: string,
    limit = 0,
  ): Promise<{ stories: unknown[]; category: CategoryFontInfo | null }> {
    await this.assertSubscriptionActive(workspaceId);

    let query = this.supabase
      .from('stories')
      .select(WIDGET_STORY_SELECT)
      .eq('workspace_id', workspaceId)
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    let categoryFontInfo: CategoryFontInfo | null = null;

    if (categorySlug) {
      const category = await this.categoriesService.findBySlug(
        workspaceId,
        categorySlug,
      );

      if (!category) return { stories: [], category: null };

      query = query.eq('category_id', category.id);

      categoryFontInfo = {
        font_family:     (category as any).font_family     ?? 'Inter',
        custom_font_url: (category as any).custom_font_url ?? null,
        card_shape:      (category as any).card_shape      ?? 'rounded',
      };
    }

    // Apply limit — clamp to MAX_LIMIT ceiling
    const effectiveLimit = limit > 0 ? Math.min(limit, MAX_LIMIT) : MAX_LIMIT;
    query = query.limit(effectiveLimit);

    const { data, error } = await query;

    if (error) {
      this.logger.error('Widget: failed to fetch stories', error);
      throw new InternalServerErrorException('Could not retrieve stories.');
    }

    return { stories: data ?? [], category: categoryFontInfo };
  }

  // ─────────────────────────────────────────────
  //  GET /widget/stories/:id
  // ─────────────────────────────────────────────

  async findOnePublished(workspaceId: string, storyId: string) {
    await this.assertSubscriptionActive(workspaceId);

    const { data: story, error } = await this.supabase
      .from('stories')
      .select(WIDGET_STORY_SELECT)
      .eq('id', storyId)
      .eq('workspace_id', workspaceId)
      .eq('status', 'published')
      .maybeSingle();

    if (error) {
      this.logger.error('Widget: failed to fetch story', error);
      throw new InternalServerErrorException('Could not retrieve story.');
    }

    if (!story) throw new NotFoundException('Story not found.');

    return story;
  }
}