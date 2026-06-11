import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { PlanStoryGuard, PlanViewGuard } from './plan.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [BillingController],
  providers: [BillingService, PlanStoryGuard, PlanViewGuard],
  exports: [BillingService, PlanStoryGuard, PlanViewGuard],
})
export class BillingModule {}