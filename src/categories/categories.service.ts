import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

const CATEGORY_SELECT =
  'id, workspace_id, name, slug, font_family, custom_font_url, card_shape, created_at';

@Injectable()
export class CategoriesService {
  private readonly supabase: SupabaseClient;
  private readonly logger = new Logger(CategoriesService.name);

  constructor(private readonly configService: ConfigService) {
    this.supabase = createClient(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
      this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  // ─────────────────────────────────────────────
  //  Create
  // ─────────────────────────────────────────────

  async create(workspaceId: string, dto: CreateCategoryDto) {
    const slug = await this.uniqueSlug(workspaceId, this.slugify(dto.name));

    const insertPayload: Record<string, unknown> = {
      workspace_id: workspaceId,
      name: dto.name,
      slug,
    };

    if (dto.font_family !== undefined) {
      insertPayload.font_family = dto.font_family;
    }

    if (dto.card_shape !== undefined) {
      insertPayload.card_shape = dto.card_shape;
    }

    const { data, error } = await this.supabase
      .from('categories')
      .insert(insertPayload)
      .select(CATEGORY_SELECT)
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('A category with this name already exists.');
      }
      this.logger.error('Failed to create category', error);
      throw new InternalServerErrorException('Could not create category.');
    }

    return data;
  }

  // ─────────────────────────────────────────────
  //  Find all (workspace-scoped)
  // ─────────────────────────────────────────────

  async findAll(workspaceId: string) {
    const { data, error } = await this.supabase
      .from('categories')
      .select(CATEGORY_SELECT)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to fetch categories', error);
      throw new InternalServerErrorException('Could not retrieve categories.');
    }

    return data;
  }

  // ─────────────────────────────────────────────
  //  Update
  // ─────────────────────────────────────────────

  async update(workspaceId: string, categoryId: string, dto: UpdateCategoryDto) {
    await this.findAndVerifyOwnership(workspaceId, categoryId);

    const updatePayload: Record<string, unknown> = {};

    if (dto.name !== undefined) {
      updatePayload.name = dto.name;
      updatePayload.slug = await this.uniqueSlug(
        workspaceId,
        this.slugify(dto.name),
        categoryId,
      );
    }

    if (dto.font_family !== undefined) {
      updatePayload.font_family = dto.font_family;
    }

    if (dto.custom_font_url !== undefined) {
      updatePayload.custom_font_url = dto.custom_font_url;
    }

    if (dto.card_shape !== undefined) {
      updatePayload.card_shape = dto.card_shape;
    }

    if (Object.keys(updatePayload).length === 0) {
      return this.findAndVerifyOwnership(workspaceId, categoryId);
    }

    const { data, error } = await this.supabase
      .from('categories')
      .update(updatePayload)
      .eq('id', categoryId)
      .select(CATEGORY_SELECT)
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('A category with this name already exists.');
      }
      this.logger.error('Failed to update category', error);
      throw new InternalServerErrorException('Could not update category.');
    }

    return data;
  }

  // ─────────────────────────────────────────────
  //  Update font settings
  // ─────────────────────────────────────────────

  async updateFont(
    workspaceId: string,
    categoryId: string,
    fontFamily: string | null,
    customFontUrl: string | null,
  ) {
    await this.findAndVerifyOwnership(workspaceId, categoryId);

    const updatePayload: Record<string, unknown> = {};

    if (fontFamily !== null) {
      updatePayload.font_family = fontFamily;
    }

    if (customFontUrl !== null) {
      updatePayload.custom_font_url = customFontUrl;
    } else if (customFontUrl === null && fontFamily !== null) {
      // Explicitly clearing custom font when switching back to a Google Font
      updatePayload.custom_font_url = null;
    }

    if (Object.keys(updatePayload).length === 0) {
      return this.findAndVerifyOwnership(workspaceId, categoryId);
    }

    const { data, error } = await this.supabase
      .from('categories')
      .update(updatePayload)
      .eq('id', categoryId)
      .select(CATEGORY_SELECT)
      .single();

    if (error) {
      this.logger.error('Failed to update category font', error);
      throw new InternalServerErrorException('Could not update category font.');
    }

    return data;
  }

  // ─────────────────────────────────────────────
  //  Update card shape
  // ─────────────────────────────────────────────

  async updateShape(
    workspaceId: string,
    categoryId: string,
    cardShape: string,
  ) {
    await this.findAndVerifyOwnership(workspaceId, categoryId);

    const { data, error } = await this.supabase
      .from('categories')
      .update({ card_shape: cardShape })
      .eq('id', categoryId)
      .select(CATEGORY_SELECT)
      .single();

    if (error) {
      this.logger.error('Failed to update category shape', error);
      throw new InternalServerErrorException('Could not update category shape.');
    }

    return data;
  }

  // ─────────────────────────────────────────────
  //  Delete
  // ─────────────────────────────────────────────

  async remove(workspaceId: string, categoryId: string) {
    await this.findAndVerifyOwnership(workspaceId, categoryId);

    const { error } = await this.supabase
      .from('categories')
      .delete()
      .eq('id', categoryId);

    if (error) {
      this.logger.error('Failed to delete category', error);
      throw new InternalServerErrorException('Could not delete category.');
    }

    return { message: 'Category deleted successfully.' };
  }

  // ─────────────────────────────────────────────
  //  Find by slug (used by widget service)
  // ─────────────────────────────────────────────

  async findBySlug(workspaceId: string, slug: string) {
    const { data, error } = await this.supabase
      .from('categories')
      .select(CATEGORY_SELECT)
      .eq('workspace_id', workspaceId)
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      this.logger.error('Failed to fetch category by slug', error);
      throw new InternalServerErrorException('Could not retrieve category.');
    }

    return data; // null if not found — caller decides how to handle
  }

  // ─────────────────────────────────────────────
  //  Private helpers
  // ─────────────────────────────────────────────

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private async uniqueSlug(
    workspaceId: string,
    base: string,
    excludeId?: string,
  ): Promise<string> {
    let slug = base;
    let attempt = 0;

    while (true) {
      let query = this.supabase
        .from('categories')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('slug', slug);

      if (excludeId) {
        query = query.neq('id', excludeId);
      }

      const { data } = await query.maybeSingle();

      if (!data) return slug;

      attempt++;
      slug = `${base}-${attempt}`;
    }
  }

  private async findAndVerifyOwnership(workspaceId: string, categoryId: string) {
    const { data: category, error } = await this.supabase
      .from('categories')
      .select(CATEGORY_SELECT)
      .eq('id', categoryId)
      .maybeSingle();

    if (error) {
      this.logger.error('Failed to fetch category', error);
      throw new InternalServerErrorException('Could not retrieve category.');
    }

    if (!category) {
      throw new NotFoundException('Category not found.');
    }

    if (category.workspace_id !== workspaceId) {
      throw new ForbiddenException('You do not have access to this category.');
    }

    return category;
  }
}