import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { StoriesService } from './stories.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { UpdateStoryDto } from './dto/update-story.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/current-user.decorator';
import { PlanStoryGuard } from '../billing/plan.guard';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('stories')
@UseGuards(JwtAuthGuard)
@SkipThrottle() // JWT-authenticated — no throttle needed on dashboard routes
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  /**
   * POST /stories
   * Creates a new story in draft status.
   * Body may include category_id (UUID) to assign to a category.
   */
  @Post()
  @UseGuards(PlanStoryGuard)
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateStoryDto,
  ) {
    return this.storiesService.create(user.workspaceId, dto);
  }

  /**
   * GET /stories
   * Returns all stories for the current workspace (includes category_id).
   */
  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.storiesService.findAll(user.workspaceId);
  }

  /**
   * GET /stories/:id
   */
  @Get(':id')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.storiesService.findOne(user.workspaceId, id);
  }

  /**
   * PATCH /stories/:id
   * Accepts category_id in body to move story between categories.
   * Send category_id: null to remove from category.
   */
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoryDto,
  ) {
    return this.storiesService.update(user.workspaceId, id, dto);
  }

  /**
   * DELETE /stories/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.storiesService.remove(user.workspaceId, id);
  }

  /**
   * POST /stories/:id/publish
   */
  @Post(':id/publish')
  publish(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.storiesService.publish(user.workspaceId, id);
  }

  /**
   * POST /stories/:id/duplicate
   * Creates a copy of the story as a new draft.
   */
  @Post(':id/duplicate')
  @UseGuards(JwtAuthGuard)
  duplicate(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.storiesService.duplicate(user.workspaceId, id);
  }
}