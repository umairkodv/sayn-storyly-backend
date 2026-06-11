import { IsString, IsOptional, MinLength, MaxLength, IsIn } from 'class-validator';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  font_family?: string;

  @IsOptional()
  @IsString()
  custom_font_url?: string;

  @IsOptional()
  @IsString()
  @IsIn(['circle', 'rounded', 'square', 'portrait'])
  card_shape?: string;
}