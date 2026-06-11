import { IsOptional, IsString } from 'class-validator';

export class UpdateFontDto {
  @IsOptional()
  @IsString()
  font_family?: string;

  @IsOptional()
  @IsString()
  custom_font_url?: string;
}