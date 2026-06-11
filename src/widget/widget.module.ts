import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WidgetService } from './widget.service';
import { WidgetController } from './widget.controller';
import { WidgetServeController } from './widget-serve.controller';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CategoriesModule } from '../categories/categories.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    ConfigModule,
    ApiKeysModule,
    CategoriesModule,
    BillingModule,
    // ThrottlerModule is registered globally in AppModule.
    // @Throttle({ widget: ... }) decorators in WidgetController still work
    // because the global ThrottlerModule exposes all named configs.
  ],
  controllers: [
    WidgetServeController, // GET /widget/v1/widget.js (public, no auth)
    WidgetController,      // GET/POST /widget/stories|events (api-key auth)
  ],
  providers: [
    WidgetService,
    // ThrottlerGuard is registered globally in AppModule — no duplicate here.
  ],
})
export class WidgetModule {}