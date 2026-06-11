import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiKeysService } from './api-keys.service';
// import { ApiKeysController } from './api-keys.controller';
import { ApiKeysController } from './api-keys.controller';

import { ApiKeyGuard } from './api-key.guard';

@Module({
  imports: [ConfigModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyGuard],
  // Export so Widget module can use ApiKeyGuard and ApiKeysService
  exports: [ApiKeysService, ApiKeyGuard],
})
export class ApiKeysModule {}