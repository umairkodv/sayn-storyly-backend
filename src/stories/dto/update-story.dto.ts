import { IsOptional, IsIn } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateStoryDto } from './create-story.dto';

export class UpdateStoryDto extends PartialType(CreateStoryDto) {
  /**
   * Allows reverting a published story back to draft.
   * Only "draft" is accepted — publishing goes through POST /stories/:id/publish.
   */
  @IsOptional()
  @IsIn(['draft'])
  status?: 'draft';
}
// All new fields (cover_image_url, logo_url, expires_at, category_id)
// are inherited as optional via PartialType — no changes needed here.