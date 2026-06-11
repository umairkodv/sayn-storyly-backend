import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/current-user.decorator';

@Controller('api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.create(user.workspaceId, dto);
  }

  @Post('rotate')
  rotate(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.rotate(user.workspaceId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.apiKeysService.findAll(user.workspaceId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.apiKeysService.remove(user.workspaceId, id);
  }
}