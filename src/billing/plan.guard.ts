import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { BillingService } from './billing.service';

/**
 * PlanStoryGuard
 * Blocks POST /stories when the workspace has reached its story limit.
 *
 * Usage:
 *   @Post()
 *   @UseGuards(JwtAuthGuard, PlanStoryGuard)
 *   create(...) {}
 */
@Injectable()
export class PlanStoryGuard implements CanActivate {
  constructor(private readonly billingService: BillingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    await this.billingService.checkStoryLimit(req.user?.workspaceId);
    return true;
  }
}

/**
 * PlanViewGuard
 * Blocks POST /widget/events when the monthly view limit is reached.
 *
 * Usage:
 *   @Post('events')
 *   @UseGuards(ApiKeyGuard, PlanViewGuard)
 *   trackEvents(...) {}
 */
@Injectable()
export class PlanViewGuard implements CanActivate {
  constructor(private readonly billingService: BillingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const workspaceId = req.workspace?.workspaceId ?? req.user?.workspaceId;
    await this.billingService.checkViewLimit(workspaceId);
    return true;
  }
}
