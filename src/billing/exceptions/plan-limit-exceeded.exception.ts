import { HttpException, HttpStatus } from '@nestjs/common';
import { PlanId } from '../plans.config';

export interface PlanLimitExceededBody {
  error: 'PLAN_LIMIT_EXCEEDED';
  limit_type: 'stories' | 'views';
  current: number;
  limit: number;
  plan: PlanId;
  upgrade_url: '/billing';
}

export class PlanLimitExceededException extends HttpException {
  constructor(options: {
    limit_type: 'stories' | 'views';
    current: number;
    limit: number;
    plan: PlanId;
  }) {
    const body: PlanLimitExceededBody = {
      error:       'PLAN_LIMIT_EXCEEDED',
      limit_type:  options.limit_type,
      current:     options.current,
      limit:       options.limit,
      plan:        options.plan,
      upgrade_url: '/billing',
    };

    // HTTP 402 Payment Required — distinct from 403 Forbidden
    super(body, HttpStatus.PAYMENT_REQUIRED);
  }
}