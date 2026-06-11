import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  DefaultValuePipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import type { Response } from 'express';
import { WidgetService } from './widget.service';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { CreateEventsDto } from './dto/create-events.dto';
import { PlanViewGuard } from '../billing/plan.guard';

/** Shape attached to req.workspace by ApiKeyGuard */
interface WorkspaceContext {
  workspaceId: string;
  allowedDomains: string[];
  origin: string | null;
}

/**
 * Sets Access-Control-Allow-Origin to the exact request Origin (not wildcard)
 * and adds Vary: Origin so CDNs/proxies cache CORS headers per-origin.
 * No-op when origin is null (open-whitelist mode — no Origin header sent).
 */
function setCorsHeaders(res: Response, origin: string | null): void {
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
}

@Controller('widget')
@UseGuards(ApiKeyGuard)
export class WidgetController {
  constructor(private readonly widgetService: WidgetService) {}

  /**
   * POST /widget/events
   * Bulk-inserts events in a single query. Tighter rate limit than stories.
   */
  @Post('events')
  @UseGuards(PlanViewGuard)
  @HttpCode(HttpStatus.CREATED)
  // 120 event batches per minute per IP — generous for real usage, blocks hammering
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  trackEvents(
    @Req() req: Request & { workspace: WorkspaceContext },
    @Res({ passthrough: true }) res: Response,
    @Body() dto: CreateEventsDto,
  ) {
    setCorsHeaders(res, req.workspace.origin);
    return this.widgetService.trackEvents(req.workspace.workspaceId, dto.events);
  }

  /**
   * GET /widget/stories
   * GET /widget/stories?category=<slug>&limit=<n>
   */
  @Get('stories')
  @Throttle({ default: { ttl: 60_000, limit: 300 } })  // 300/min: multiple visitors, multiple embeds
  findAll(
    @Req() req: Request & { workspace: WorkspaceContext },
    @Res({ passthrough: true }) res: Response,
    @Query('category') category?: string,
    // data-limit from widget script tag (0 = no limit)
    @Query('limit', new DefaultValuePipe(0), ParseIntPipe) limit?: number,
  ) {
    setCorsHeaders(res, req.workspace.origin);
    return this.widgetService.findPublished(
      req.workspace.workspaceId,
      category,
      limit,
    );
  }

  /**
   * GET /widget/stories/:id
   */
  @Get('stories/:id')
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  findOne(
    @Req() req: Request & { workspace: WorkspaceContext },
    @Res({ passthrough: true }) res: Response,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    setCorsHeaders(res, req.workspace.origin);
    return this.widgetService.findOnePublished(req.workspace.workspaceId, id);
  }
}