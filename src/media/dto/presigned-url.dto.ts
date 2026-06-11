import { IsString, MinLength } from 'class-validator';

export class PresignedUrlDto {
  @IsString()
  @MinLength(1)
  fileName: string;

  @IsString()
  @MinLength(1)
  fileType: string; // e.g. "image/jpeg", "video/mp4"
}