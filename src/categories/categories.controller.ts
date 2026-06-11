import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateFontDto } from './dto/update-font.dto';
import { UpdateShapeDto } from './dto/update-shape.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/current-user.decorator';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SkipThrottle } from '@nestjs/throttler';

const ALLOWED_FONT_MIME_TYPES = new Set([
  'font/woff',
  'font/woff2',
  'font/ttf',
  'font/otf',
  'application/octet-stream',
]);

const ALLOWED_FONT_EXTENSIONS = /\.(woff2?|ttf|otf)$/i;
const MAX_FONT_SIZE = 2 * 1024 * 1024; // 2 MB
const FONT_BUCKET = 'category-fonts';

@Controller('categories')
@UseGuards(JwtAuthGuard)
@SkipThrottle() // JWT-authenticated — no throttle needed on dashboard routes
export class CategoriesController {
  private readonly supabase: SupabaseClient;
  private readonly logger = new Logger(CategoriesController.name);

  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly configService: ConfigService,
  ) {
    this.supabase = createClient(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
      this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  // ── POST /categories ──────────────────────────────────────
  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(user.workspaceId, dto);
  }

  // ── GET /categories ───────────────────────────────────────
  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.categoriesService.findAll(user.workspaceId);
  }

  // ── PATCH /categories/:id/font ────────────────────────────
  // Must be declared BEFORE :id to avoid NestJS matching
  // 'font' as the :id parameter value.
  @Patch(':id/font')
  updateFont(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFontDto,
  ) {
    return this.categoriesService.updateFont(
      user.workspaceId,
      id,
      dto.font_family   ?? null,
      dto.custom_font_url ?? null,
    );
  }

  // ── PATCH /categories/:id/shape ───────────────────────────
  // Must be declared BEFORE :id to avoid NestJS matching
  // 'shape' as the :id parameter value.
  @Patch(':id/shape')
  updateShape(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShapeDto,
  ) {
    return this.categoriesService.updateShape(
      user.workspaceId,
      id,
      dto.card_shape,
    );
  }

  // ── POST /categories/:id/font/upload ──────────────────────
  @Post(':id/font/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFont(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }

    // Validate MIME type + extension (browsers may send
    // application/octet-stream for font files, so check both)
    const mimeOk = ALLOWED_FONT_MIME_TYPES.has(file.mimetype);
    const extOk  = ALLOWED_FONT_EXTENSIONS.test(file.originalname);
    if (!mimeOk && !extOk) {
      throw new BadRequestException(
        'Invalid file type. Allowed: .woff, .woff2, .ttf, .otf',
      );
    }

    if (file.size > MAX_FONT_SIZE) {
      throw new BadRequestException('Font file must be 2 MB or smaller.');
    }

    // Verify category ownership before touching Storage
    // findAndVerifyOwnership is private, so we call a lightweight
    // read via findAll and check — or simply attempt updateFont
    // with no-op values; any ownership error bubbles up correctly.
    await this.categoriesService.updateFont(
      user.workspaceId,
      id,
      null,
      null,
    );

    // Build stable path inside the bucket
    const timestamp = Date.now();
    const safeName  = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `fonts/${user.workspaceId}/${id}/${timestamp}-${safeName}`;

    // Upload buffer to Supabase Storage
    const { error: uploadError } = await this.supabase.storage
      .from(FONT_BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      this.logger.error('Font upload to Supabase Storage failed', uploadError);
      throw new InternalServerErrorException('Could not upload font file.');
    }

    // Retrieve public URL (bucket must be public)
    const { data: urlData } = this.supabase.storage
      .from(FONT_BUCKET)
      .getPublicUrl(storagePath);

    const publicUrl = urlData.publicUrl;

    // Persist custom_font_url on the category
    const updatedCategory = await this.categoriesService.updateFont(
      user.workspaceId,
      id,
      null,      // keep existing font_family
      publicUrl, // set custom_font_url
    );

    return { url: publicUrl, category: updatedCategory };
  }

  // ── PATCH /categories/:id ─────────────────────────────────
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(user.workspaceId, id, dto);
  }

  // ── DELETE /categories/:id ────────────────────────────────
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.categoriesService.remove(user.workspaceId, id);
  }
}