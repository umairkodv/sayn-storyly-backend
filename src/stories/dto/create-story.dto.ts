import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsArray,
  IsNumber,
  IsIn,
  IsDateString,
  IsUUID,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─────────────────────────────────────────────
//  CTA (nested inside slide)
// ─────────────────────────────────────────────

export class SlideCtaDto {
  @IsString()
  @MinLength(1)
  label: string;

  @IsString()
  @MinLength(1)
  url: string;
}

// ─────────────────────────────────────────────
//  Single slide
// ─────────────────────────────────────────────

export class SlideDto {
  // EXTENDED: removed 'html' — widget only renders image/video
  @IsIn(['image', 'video'])
  type: 'image' | 'video';

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsNumber()
  @Min(500)
  duration?: number; // milliseconds, e.g. 5000

  @IsOptional()
  @ValidateNested()
  @Type(() => SlideCtaDto)
  cta?: SlideCtaDto;
}

// ─────────────────────────────────────────────
//  Story
// ─────────────────────────────────────────────

export class CreateStoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  // NEW: required cover image shown in widget tray bubble
  @IsString()
  @MinLength(1)
  cover_image_url: string;

  // NEW: optional workspace/brand logo shown in viewer header
  @IsOptional()
  @IsString()
  logo_url?: string;

  // NEW: optional ISO date after which widget hides this story
  @IsOptional()
  @IsDateString()
  expires_at?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SlideDto)
  slides?: SlideDto[];

  // Kept for backward compat — cover_image_url is the preferred field
  @IsOptional()
  @IsString()
  thumbnail_url?: string;

  // Optional category assignment
  @IsOptional()
  @IsUUID()
  category_id?: string;
}