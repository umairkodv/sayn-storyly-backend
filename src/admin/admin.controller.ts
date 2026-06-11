import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/current-user.decorator';
import { AdminGuard } from './admin.guard';
import { AdminService, UpdatePlanDto, CreatePlanDto } from './admin.service';
import { IsIn } from 'class-validator';
import { SkipThrottle } from '@nestjs/throttler';

class OverridePlanDto {
  @IsIn(['free', 'pro', 'business'])
  plan!: 'free' | 'pro' | 'business';
}

class SetRoleDto {
  @IsIn(['user', 'admin'])
  role!: 'user' | 'admin';
}

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
@SkipThrottle() // JWT + admin-role authenticated — no throttle needed
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── GET /admin/stats ──────────────────────────────────────
  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  // ── GET /admin/revenue ────────────────────────────────────
  @Get('revenue')
  getRevenue() {
    return this.adminService.getRevenue();
  }

  // ── GET /admin/workspaces ─────────────────────────────────
  @Get('workspaces')
  getWorkspaces(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.adminService.getWorkspaces(page, limit);
  }

  // ── GET /admin/workspaces/:id/subscription ────────────────
  // Declared BEFORE /:id so NestJS does not swallow 'subscription'
  // as a second :id parameter value.
  @Get('workspaces/:id/subscription')
  getSubscriptionDetails(@Param('id') id: string) {
    return this.adminService.getSubscriptionDetails(id);
  }

  // ── GET /admin/workspaces/:id ─────────────────────────────
  @Get('workspaces/:id')
  getWorkspaceById(@Param('id') id: string) {
    return this.adminService.getWorkspaceById(id);
  }

  // ── POST /admin/workspaces/:id/cancel-subscription ────────
  @Post('workspaces/:id/cancel-subscription')
  cancelSubscription(
    @Param('id') id: string,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.adminService.cancelSubscription(id, req.user.userId);
  }

  // ── POST /admin/workspaces/:id/override-plan ──────────────
  @Post('workspaces/:id/override-plan')
  overridePlan(
    @Param('id') workspaceId: string,
    @Body() dto: OverridePlanDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.adminService.overridePlan(workspaceId, dto.plan, user.userId);
  }

  // ── GET /admin/users ──────────────────────────────────────
  @Get('users')
  getUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.adminService.getUsers(page, limit);
  }

  // ── POST /admin/users/:id/set-role ────────────────────────
  @Post('users/:id/set-role')
  setUserRole(
    @Param('id') targetUserId: string,
    @Body() dto: SetRoleDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.adminService.setUserRole(targetUserId, dto.role, user.userId);
  }

  // ── GET /admin/plans ──────────────────────────────────────
  @Get('plans')
  getPlans() {
    return this.adminService.getPlans();
  }

  // ── POST /admin/plans ─────────────────────────────────────
  // Must be declared BEFORE /:planId routes
  @Post('plans')
  createPlan(@Body() dto: CreatePlanDto) {
    return this.adminService.createPlan(dto);
  }

  // ── PATCH /admin/plans/:planId ────────────────────────────
  @Patch('plans/:planId')
  updatePlan(
    @Param('planId') planId: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.adminService.updatePlan(planId, dto);
  }

  // ── POST /admin/plans/:planId/toggle ──────────────────────
  @Post('plans/:planId/toggle')
  togglePlan(@Param('planId') planId: string) {
    return this.adminService.togglePlan(planId);
  }
}