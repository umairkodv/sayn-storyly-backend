import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CreateStoryDto } from './dto/create-story.dto';
import { UpdateStoryDto } from './dto/update-story.dto';

// EXTENDED: added cover_image_url, logo_url, expires_at, category_id
const STORY_SELECT = `
  id,
  workspace_id,
  category_id,
  title,
  status,
  slides,
  config,
  cover_image_url,
  logo_url,
  expires_at,
  thumbnail_url,
  published_at,
  created_at,
  updated_at
`;

@Injectable()
export class StoriesService {
  private readonly supabase: SupabaseClient;
  private readonly logger = new Logger(StoriesService.name);

  constructor(private readonly configService: ConfigService) {
    this.supabase = createClient(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
      this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  // ─────────────────────────────────────────────
  //  Create
  // ─────────────────────────────────────────────

  async create(workspaceId: string, dto: CreateStoryDto) {
    const { data, error } = await this.supabase
      .from('stories')
      .insert({
        workspace_id:    workspaceId,
        title:           dto.title,
        slides:          dto.slides ?? [],
        // NEW fields
        cover_image_url: dto.cover_image_url,
        logo_url:        dto.logo_url        ?? null,
        expires_at:      dto.expires_at      ?? null,
        // Existing optional fields
        thumbnail_url:   dto.thumbnail_url   ?? null,
        category_id:     dto.category_id     ?? null,
        status:          'draft',
      })
      .select(STORY_SELECT)
      .single();

    if (error) {
      this.logger.error('Failed to create story', error);
      throw new InternalServerErrorException('Could not create story.');
    }

    return data;
  }

  // ─────────────────────────────────────────────
  //  Find all (workspace-scoped)
  // ─────────────────────────────────────────────

  async findAll(workspaceId: string) {
    const { data, error } = await this.supabase
      .from('stories')
      .select(STORY_SELECT)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch stories', error);
      throw new InternalServerErrorException('Could not retrieve stories.');
    }

    return data;
  }

  // ─────────────────────────────────────────────
  //  Find one (workspace-scoped)
  // ─────────────────────────────────────────────

  async findOne(workspaceId: string, storyId: string) {
    return this.findAndVerifyOwnership(workspaceId, storyId);
  }

  // ─────────────────────────────────────────────
  //  Update
  // ─────────────────────────────────────────────

  async update(workspaceId: string, storyId: string, dto: UpdateStoryDto) {
    await this.findAndVerifyOwnership(workspaceId, storyId);

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    // Existing fields
    if (dto.title         !== undefined) updatePayload.title         = dto.title;
    if (dto.slides        !== undefined) updatePayload.slides        = dto.slides;
    if (dto.thumbnail_url !== undefined) updatePayload.thumbnail_url = dto.thumbnail_url;
    if (dto.category_id   !== undefined) updatePayload.category_id   = dto.category_id;

    // NEW fields — only patch if explicitly sent
    if (dto.cover_image_url !== undefined) updatePayload.cover_image_url = dto.cover_image_url;
    if (dto.logo_url        !== undefined) updatePayload.logo_url        = dto.logo_url;
    if (dto.expires_at      !== undefined) updatePayload.expires_at      = dto.expires_at;

    if (dto.status === 'draft') {
      updatePayload.status       = 'draft';
      updatePayload.published_at = null;
    }

    const { data, error } = await this.supabase
      .from('stories')
      .update(updatePayload)
      .eq('id', storyId)
      .select(STORY_SELECT)
      .single();

    if (error) {
      this.logger.error('Failed to update story', error);
      throw new InternalServerErrorException('Could not update story.');
    }

    return data;
  }

  // ─────────────────────────────────────────────
  //  Delete
  // ─────────────────────────────────────────────

  async remove(workspaceId: string, storyId: string) {
    await this.findAndVerifyOwnership(workspaceId, storyId);

    const { error } = await this.supabase
      .from('stories')
      .delete()
      .eq('id', storyId);

    if (error) {
      this.logger.error('Failed to delete story', error);
      throw new InternalServerErrorException('Could not delete story.');
    }

    return { message: 'Story deleted successfully.' };
  }

  // ─────────────────────────────────────────────
  //  Publish
  // ─────────────────────────────────────────────

  async publish(workspaceId: string, storyId: string) {
    const story = await this.findAndVerifyOwnership(workspaceId, storyId);

    if (!story.slides || story.slides.length === 0) {
      throw new BadRequestException(
        'A story must have at least one slide before it can be published.',
      );
    }

    if (story.status === 'published') {
      throw new BadRequestException('This story is already published.');
    }

    const { data, error } = await this.supabase
      .from('stories')
      .update({
        status:       'published',
        published_at: new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      })
      .eq('id', storyId)
      .select(STORY_SELECT)
      .single();

    if (error) {
      this.logger.error('Failed to publish story', error);
      throw new InternalServerErrorException('Could not publish story.');
    }

    return data;
  }

  // ─────────────────────────────────────────────
  //  Duplicate
  // ─────────────────────────────────────────────

  async duplicate(workspaceId: string, storyId: string) {
    const original = await this.findAndVerifyOwnership(workspaceId, storyId);

    const { data, error } = await this.supabase
      .from('stories')
      .insert({
        workspace_id:    workspaceId,
        title:           `${original.title} (Copy)`,
        status:          'draft',
        published_at:    null,
        slides:          original.slides,
        config:          original.config,
        cover_image_url: original.cover_image_url,
        logo_url:        original.logo_url,
        thumbnail_url:   original.thumbnail_url,
        expires_at:      original.expires_at,
        category_id:     original.category_id,
      })
      .select(STORY_SELECT)
      .single();

    if (error) {
      this.logger.error('Failed to duplicate story', error);
      throw new InternalServerErrorException('Could not duplicate story.');
    }

    return data;
  }

  // ─────────────────────────────────────────────
  //  Private helper — fetch + verify workspace ownership
  // ─────────────────────────────────────────────

  private async findAndVerifyOwnership(workspaceId: string, storyId: string) {
    const { data: story, error } = await this.supabase
      .from('stories')
      .select(STORY_SELECT)
      .eq('id', storyId)
      .maybeSingle();

    if (error) {
      this.logger.error('Failed to fetch story', error);
      throw new InternalServerErrorException('Could not retrieve story.');
    }

    if (!story) throw new NotFoundException('Story not found.');

    if (story.workspace_id !== workspaceId) {
      throw new ForbiddenException('You do not have access to this story.');
    }

    return story;
  }
}