import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { StoriesModule } from './stories/stories.module';
import { WidgetModule } from './widget/widget.module';
import { CategoriesModule } from './categories/categories.module';
import { MediaModule } from './media/media.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BillingModule } from './billing/billing.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Single throttler config — applies to public/unauthenticated routes only.
    // All JWT-authenticated dashboard routes opt out via @SkipThrottle().
    // Widget and auth routes set their own limits via @Throttle() or @SkipThrottle().
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 300,
      },
    ]),
    AuthModule,
    ApiKeysModule,
    StoriesModule,
    CategoriesModule,
    WidgetModule,
    MediaModule,
    AnalyticsModule,
    BillingModule,
    WorkspacesModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global ThrottlerGuard — NestJS DI injects all required constructor args.
    // All routes get the default 'api' throttle unless overridden with @Throttle().
    // Webhook is exempt via @SkipThrottle() in billing.controller.ts.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}