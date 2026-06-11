import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { ConfirmPaymentMethodDto } from './dto/confirm-payment-method.dto';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('create-checkout-session')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  createCheckoutSession(
    @Req() req: Request & { user: { workspaceId: string } },
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    const workspaceId = req.user?.workspaceId;

    if (!workspaceId) {
      throw new UnauthorizedException(
        'Your session is missing workspace context. Please log out and log in again.',
      );
    }

    return this.billingService.createCheckoutSession(workspaceId, dto.plan);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  getStatus(@Req() req: Request & { user: { workspaceId: string } }) {
    const workspaceId = req.user?.workspaceId;

    if (!workspaceId) {
      throw new UnauthorizedException(
        'Your session is missing workspace context. Please log out and log in again.',
      );
    }

    return this.billingService.getStatus(workspaceId);
  }

  @Post('portal-session')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  createPortalSession(@Req() req: Request & { user: { workspaceId: string } }) {
    const workspaceId = req.user?.workspaceId;

    if (!workspaceId) {
      throw new UnauthorizedException(
        'Your session is missing workspace context. Please log out and log in again.',
      );
    }

    return this.billingService.createPortalSession(workspaceId);
  }

  // Public — no auth guard, no throttle — safe for the pricing marketing page
  @Get('plans')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  getPublicPlans() {
    return this.billingService.getPublicPlans();
  }

  // Stripe must always reach this endpoint — never rate limit it.
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  handleWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.billingService.handleWebhook(req.body, signature);
  }

  @Post('change-plan')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  changePlan(
    @Req() req: Request & { user: { workspaceId: string } },
    @Body() dto: ChangePlanDto,
  ) {
    const workspaceId = req.user?.workspaceId;

    if (!workspaceId) {
      throw new UnauthorizedException(
        'Your session is missing workspace context. Please log out and log in again.',
      );
    }

    return this.billingService.changePlan(workspaceId, dto.plan);
  }

  @Post('cancel')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  cancelSubscription(@Req() req: Request & { user: { workspaceId: string } }) {
    const workspaceId = req.user?.workspaceId;

    if (!workspaceId) {
      throw new UnauthorizedException(
        'Your session is missing workspace context. Please log out and log in again.',
      );
    }

    return this.billingService.cancelSubscription(workspaceId);
  }

  @Post('reactivate')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  reactivateSubscription(@Req() req: Request & { user: { workspaceId: string } }) {
    const workspaceId = req.user?.workspaceId;

    if (!workspaceId) {
      throw new UnauthorizedException(
        'Your session is missing workspace context. Please log out and log in again.',
      );
    }

    return this.billingService.reactivateSubscription(workspaceId);
  }

  @Get('payment-method')
  @UseGuards(JwtAuthGuard)
  getPaymentMethod(@Req() req: Request & { user: { workspaceId: string } }) {
    const workspaceId = req.user?.workspaceId;

    if (!workspaceId) {
      throw new UnauthorizedException(
        'Your session is missing workspace context. Please log out and log in again.',
      );
    }

    return this.billingService.getPaymentMethod(workspaceId);
  }

  @Post('setup-intent')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  createSetupIntent(@Req() req: Request & { user: { workspaceId: string } }) {
    const workspaceId = req.user?.workspaceId;

    if (!workspaceId) {
      throw new UnauthorizedException(
        'Your session is missing workspace context. Please log out and log in again.',
      );
    }

    return this.billingService.createSetupIntent(workspaceId);
  }

  @Post('confirm-payment-method')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  confirmPaymentMethod(
    @Req() req: Request & { user: { workspaceId: string } },
    @Body() dto: ConfirmPaymentMethodDto,
  ) {
    const workspaceId = req.user?.workspaceId;

    if (!workspaceId) {
      throw new UnauthorizedException(
        'Your session is missing workspace context. Please log out and log in again.',
      );
    }

    return this.billingService.confirmPaymentMethod(workspaceId, dto.payment_method_id);
  }
}