import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BillingModule } from '../billing/billing.module';
import { StoriesService } from './stories.service';
import { StoriesController } from './stories.controller';

@Module({
  imports: [ConfigModule, BillingModule],
  controllers: [StoriesController],
  providers: [StoriesService],
  exports: [StoriesService], // Export so Widget module can read published stories
})
export class StoriesModule {}