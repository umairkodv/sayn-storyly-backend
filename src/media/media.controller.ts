import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { MediaService } from './media.service';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/current-user.decorator';

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * POST /media/presigned-url
   *
   * Returns a signed upload URL for Supabase Storage.
   * Flow:
   *   1. Client calls this endpoint → gets { uploadUrl, publicUrl, path }
   *   2. Client PUTs the file directly to uploadUrl (no server proxy)
   *   3. Client saves publicUrl as the slide's url field
   *
   * Body: { fileName: string, fileType: string }
   */
  @Post('presigned-url')
  getPresignedUrl(
    @CurrentUser() user: RequestUser,
    @Body() dto: PresignedUrlDto,
  ) {
    return this.mediaService.getPresignedUrl(user.workspaceId, dto);
  }
}