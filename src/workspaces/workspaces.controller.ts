import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspacesService } from './workspaces.service';
import { UpdateAllowedDomainsDto } from './dto/update-allowed-domains.dto';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
@SkipThrottle()  // Authenticated workspace reads — JWT already gates access, no throttle needed
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  /**
   * GET /workspaces/settings
   * Returns current workspace settings including the domain whitelist.
   */
  @Get('settings')
  getSettings(@Req() req: Request & { user: { workspaceId: string } }) {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      throw new UnauthorizedException(
        'Your session is missing workspace context. Please log out and log in again.',
      );
    }
    return this.workspacesService.getSettings(workspaceId);
  }

  /**
   * POST /workspaces/allowed-domains
   * Replaces the allowed_domains list for the authenticated workspace.
   * Body: { domains: string[] }
   * Returns: { allowed_domains: string[] }
   *
   * Pass an empty array to allow all origins (open / backward-compatible mode).
   */
  @Post('allowed-domains')
  updateAllowedDomains(
    @Req() req: Request & { user: { workspaceId: string } },
    @Body() dto: UpdateAllowedDomainsDto,
  ) {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      throw new UnauthorizedException(
        'Your session is missing workspace context. Please log out and log in again.',
      );
    }
    return this.workspacesService.updateAllowedDomains(workspaceId, dto.domains);
  }
}