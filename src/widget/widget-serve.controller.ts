import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import { readFileSync } from 'fs';

/**
 * Serves the embeddable widget JS bundle.
 * No authentication — this endpoint is fully public.
 * Versioned path allows future /widget/v2/widget.js without breaking existing embeds.
 */
@Controller('widget/v1')
export class WidgetServeController {
  private readonly widgetSource: string;

  constructor() {
    // Resolve from project root: src/../public/widget.js
    const widgetPath = join(process.cwd(), 'public', 'widget.js');
    this.widgetSource = readFileSync(widgetPath, 'utf-8');
  }

  /**
   * GET /widget/v1/widget.js
   * Serves the widget bundle as application/javascript.
   * Cache-Control: 1 hour public cache — short enough for updates to propagate.
   */
  @Get('widget.js')
  serveWidget(@Res() res: Response) {
    res
      .set('Content-Type', 'application/javascript; charset=utf-8')
      .set('Cache-Control', 'public, max-age=3600')
      .set('X-Content-Type-Options', 'nosniff')
      .send(this.widgetSource);
  }
}