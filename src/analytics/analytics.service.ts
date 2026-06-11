import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AnalyticsService {
  private readonly supabase: SupabaseClient;
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly configService: ConfigService) {
    this.supabase = createClient(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
      this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  // ─────────────────────────────────────────────
  //  GET /analytics/summary
  // ─────────────────────────────────────────────

  async getSummary(workspaceId: string) {
    // Single round-trip: Postgres counts grouped by event_type — no rows loaded into memory.
    const { data, error } = await this.supabase.rpc('get_event_counts_by_type', {
      p_workspace_id: workspaceId,
    });

    if (error) {
      this.logger.error('Failed to fetch analytics summary via RPC — falling back', error);
      return this.getSummaryFallback(workspaceId);
    }

    const counts = this.parseEventCounts(data as Array<{ event_type: string; count: number }>);

    const storyViews = counts['story_view'] ?? 0;
    const slideViews = counts['slide_view'] ?? 0;
    const ctaClicks  = counts['cta_click']  ?? 0;
    const ctr        = storyViews > 0 ? ctaClicks / storyViews : 0;

    return {
      story_views: storyViews,
      slide_views: slideViews,
      cta_clicks:  ctaClicks,
      ctr:         parseFloat(ctr.toFixed(4)),
    };
  }

  // ─────────────────────────────────────────────
  //  GET /analytics/stories/:id
  // ─────────────────────────────────────────────

  async getStoryStats(workspaceId: string, storyId: string) {
    // Fetch story's slide count to determine "last slide" for completion rate.
    const { data: story, error: storyError } = await this.supabase
      .from('stories')
      .select('slides')
      .eq('id', storyId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (storyError) {
      this.logger.error('Failed to fetch story for analytics', storyError);
      throw new InternalServerErrorException('Could not retrieve story.');
    }

    // Aggregate event counts server-side — no event rows loaded into memory.
    const { data: eventData, error: eventsError } = await this.supabase.rpc(
      'get_story_event_counts',
      {
        p_workspace_id: workspaceId,
        p_story_id:     storyId,
      },
    );

    if (eventsError) {
      this.logger.error('Failed to fetch story event counts via RPC — falling back', eventsError);
      return this.getStoryStatsFallback(workspaceId, storyId, story);
    }

    const counts = this.parseEventCounts(
      eventData as Array<{ event_type: string; count: number }>,
    );

    const storyViews = counts['story_view'] ?? 0;
    const slideViews = counts['slide_view'] ?? 0;
    const ctaClicks  = counts['cta_click']  ?? 0;

    let completionRate = 0;
    if (story && Array.isArray(story.slides) && story.slides.length > 0) {
      const lastSlideIndex = story.slides.length - 1;

      const { count: completions, error: completionError } = await this.supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('story_id', storyId)
        .eq('event_type', 'slide_view')
        .eq('slide_index', lastSlideIndex);

      if (completionError) {
        this.logger.error('Failed to count completion events', completionError);
        throw new InternalServerErrorException('Could not retrieve analytics.');
      }

      completionRate = storyViews > 0 ? (completions ?? 0) / storyViews : 0;
    }

    return {
      story_id:        storyId,
      story_views:     storyViews,
      slide_views:     slideViews,
      cta_clicks:      ctaClicks,
      completion_rate: parseFloat(completionRate.toFixed(4)),
    };
  }

  // ─────────────────────────────────────────────
  //  GET /analytics/timeline?days=7
  // ─────────────────────────────────────────────

  async getTimeline(workspaceId: string, days: number) {
    const clampedDays = Math.min(Math.max(days, 1), 90);

    // Start of day, UTC, clampedDays ago
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - clampedDays + 1);
    startDate.setUTCHours(0, 0, 0, 0);

    // Attempt RPC first
    let rows: Array<{ date: string; event_type: string; count: number }> | null = null;

    const { data: rpcData, error: rpcError } = await this.supabase.rpc(
      'get_event_timeline',
      {
        p_workspace_id: workspaceId,
        p_start_date:   startDate.toISOString(),
      },
    );

    if (!rpcError && rpcData) {
      rows = rpcData as Array<{ date: string; event_type: string; count: number }>;
    } else {
      if (rpcError) {
        this.logger.warn('get_event_timeline RPC not available — using fallback', rpcError.message);
      }

      // Fallback: fetch raw events and aggregate in TypeScript
      const { data: rawEvents, error: rawError } = await this.supabase
        .from('events')
        .select('event_type, created_at')
        .eq('workspace_id', workspaceId)
        .gte('created_at', startDate.toISOString())
        .in('event_type', ['story_view', 'cta_click']);

      if (rawError) {
        this.logger.error('Failed to fetch raw events for timeline', rawError);
        throw new InternalServerErrorException('Could not retrieve analytics timeline.');
      }

      // Aggregate by date + event_type in TypeScript
      const aggregated: Record<string, Record<string, number>> = {};
      for (const event of rawEvents ?? []) {
        const date = new Date(event.created_at as string)
          .toISOString()
          .slice(0, 10); // YYYY-MM-DD
        if (!aggregated[date]) aggregated[date] = {};
        aggregated[date][event.event_type as string] =
          (aggregated[date][event.event_type as string] ?? 0) + 1;
      }

      rows = [];
      for (const [date, typeCounts] of Object.entries(aggregated)) {
        for (const [event_type, count] of Object.entries(typeCounts)) {
          rows.push({ date, event_type, count });
        }
      }
    }

    // Build a lookup: date (YYYY-MM-DD) → { story_view, cta_click }
    const lookup: Record<string, { story_view: number; cta_click: number }> = {};
    for (const row of rows ?? []) {
      const dateKey = row.date.slice(0, 10); // normalise to YYYY-MM-DD
      if (!lookup[dateKey]) lookup[dateKey] = { story_view: 0, cta_click: 0 };
      if (row.event_type === 'story_view') lookup[dateKey].story_view = Number(row.count);
      if (row.event_type === 'cta_click')  lookup[dateKey].cta_click  = Number(row.count);
    }

    // Generate every date in the range, even those with zero events
    const labels: string[]      = [];
    const storyViewsSeries: number[] = [];
    const ctaClicksSeries: number[]  = [];

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    for (let i = 0; i < clampedDays; i++) {
      const d = new Date(startDate);
      d.setUTCDate(startDate.getUTCDate() + i);

      const isoKey = d.toISOString().slice(0, 10);
      const label  = new Date(isoKey).toLocaleDateString('en-US', {
        month: 'short',
        day:   'numeric',
        timeZone: 'UTC',
      });

      labels.push(label);
      storyViewsSeries.push(lookup[isoKey]?.story_view ?? 0);
      ctaClicksSeries.push(lookup[isoKey]?.cta_click   ?? 0);
    }

    return {
      days:    clampedDays,
      labels,
      datasets: {
        story_views: storyViewsSeries,
        cta_clicks:  ctaClicksSeries,
      },
    };
  }

  // ─────────────────────────────────────────────
  //  Private helpers
  // ─────────────────────────────────────────────

  private parseEventCounts(
    rows: Array<{ event_type: string; count: number }>,
  ): Record<string, number> {
    const result: Record<string, number> = {};
    for (const row of rows ?? []) {
      result[row.event_type] = Number(row.count);
    }
    return result;
  }

  /**
   * Fallback for getSummary when the RPC is not yet deployed.
   * Three parallel COUNT queries — O(1) memory, no rows transferred.
   */
  private async getSummaryFallback(workspaceId: string) {
    const countFor = async (eventType: string): Promise<number> => {
      const { count, error } = await this.supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('event_type', eventType);

      if (error) {
        this.logger.error(`Failed to count ${eventType} events`, error);
        throw new InternalServerErrorException('Could not retrieve analytics.');
      }

      return count ?? 0;
    };

    const [storyViews, slideViews, ctaClicks] = await Promise.all([
      countFor('story_view'),
      countFor('slide_view'),
      countFor('cta_click'),
    ]);

    const ctr = storyViews > 0 ? ctaClicks / storyViews : 0;

    return {
      story_views: storyViews,
      slide_views: slideViews,
      cta_clicks:  ctaClicks,
      ctr:         parseFloat(ctr.toFixed(4)),
    };
  }

  /**
   * Fallback for getStoryStats when the RPC is not yet deployed.
   * Three parallel COUNT queries — O(1) memory, no rows transferred.
   */
  private async getStoryStatsFallback(
    workspaceId: string,
    storyId: string,
    story: { slides: unknown } | null,
  ) {
    const countFor = async (eventType: string): Promise<number> => {
      const { count, error } = await this.supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('story_id', storyId)
        .eq('event_type', eventType);

      if (error) {
        this.logger.error(`Failed to count ${eventType} events for story ${storyId}`, error);
        throw new InternalServerErrorException('Could not retrieve analytics.');
      }

      return count ?? 0;
    };

    const [storyViews, slideViews, ctaClicks] = await Promise.all([
      countFor('story_view'),
      countFor('slide_view'),
      countFor('cta_click'),
    ]);

    let completionRate = 0;
    if (story && Array.isArray(story.slides) && story.slides.length > 0) {
      const lastSlideIndex = story.slides.length - 1;

      const { count: completions, error: completionError } = await this.supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('story_id', storyId)
        .eq('event_type', 'slide_view')
        .eq('slide_index', lastSlideIndex);

      if (completionError) {
        this.logger.error('Failed to count completion events', completionError);
        throw new InternalServerErrorException('Could not retrieve analytics.');
      }

      completionRate = storyViews > 0 ? (completions ?? 0) / storyViews : 0;
    }

    return {
      story_id:        storyId,
      story_views:     storyViews,
      slide_views:     slideViews,
      cta_clicks:      ctaClicks,
      completion_rate: parseFloat(completionRate.toFixed(4)),
    };
  }
}