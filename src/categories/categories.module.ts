import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';

@Module({
  imports: [ConfigModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  // Export so WidgetModule can call findBySlug()
  exports: [CategoriesService],
})
export class CategoriesModule {}