import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export type EventType = 'story_view' | 'slide_view' | 'cta_click';

export class EventItemDto {
  @IsUUID()
  story_id: string;

  @IsString()
  session_id: string;

  @IsEnum(['story_view', 'slide_view', 'cta_click'])
  event_type: EventType;

  @IsOptional()
  @IsInt()
  @Min(0)
  slide_index?: number;

  @IsOptional()
  @IsString()
  referrer_url?: string;
}

export class CreateEventsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EventItemDto)
  events: EventItemDto[];
}