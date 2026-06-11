import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PresignedUrlDto } from './dto/presigned-url.dto';

const BUCKET = 'story-media';
// Signed upload URL expires after 5 minutes — enough time to complete the upload
const SIGNED_URL_EXPIRY_SECONDS = 300;

@Injectable()
export class MediaService {
  private readonly supabase: SupabaseClient;
  private readonly supabaseUrl: string;
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly configService: ConfigService) {
    this.supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');

    this.supabase = createClient(
      this.supabaseUrl,
      this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  async getPresignedUrl(workspaceId: string, dto: PresignedUrlDto) {
    // Sanitise filename — strip path separators and problematic chars
    const safeName = dto.fileName
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')
      .replace(/_{2,}/g, '_');

    // Unique path per upload — prevents collisions across workspaces and time
    const path = `uploads/${workspaceId}/${Date.now()}-${safeName}`;

    // Ask Supabase for a signed URL the client can PUT to directly
    const { data, error } = await this.supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);

    if (error || !data?.signedUrl) {
      this.logger.error('Failed to create signed upload URL', error);
      throw new InternalServerErrorException(
        'Could not generate upload URL. Ensure the "story-media" bucket exists in Supabase Storage.',
      );
    }

    // Public URL is predictable once the file is uploaded
    const publicUrl = `${this.supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;

    return {
      uploadUrl: data.signedUrl,
      publicUrl,
      path,
    };
  }
}