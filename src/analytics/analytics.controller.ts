import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
@SkipThrottle() // JWT-authenticated — no throttle needed on dashboard routes
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /analytics/summary
   * Returns workspace-wide totals: story views, slide views, CTA clicks, CTR.
   */
  @Get('summary')
  getSummary(@Req() req: Request & { user: { workspaceId: string } }) {
    return this.analyticsService.getSummary(req.user.workspaceId);
  }

  /**
   * GET /analytics/timeline?days=7
   * Returns a time-series of story_view and cta_click counts.
   * Query param: days (1–90, default 7).
   */
  @Get('timeline')
  getTimeline(
    @Req() req: Request & { user: { workspaceId: string } },
    @Query('days', new DefaultValuePipe(7), ParseIntPipe) days: number,
  ) {
    return this.analyticsService.getTimeline(req.user.workspaceId, days);
  }

  /**
   * GET /analytics/stories/:id
   * Returns per-story analytics including completion rate.
   */
  @Get('stories/:id')
  getStoryStats(
    @Req() req: Request & { user: { workspaceId: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.analyticsService.getStoryStats(req.user.workspaceId, id);
  }
}