import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { KnowledgeBasesService } from './knowledge-bases.service.js';

class CreateKbDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('knowledge-bases')
export class KnowledgeBasesController {
  constructor(
    @Inject(KnowledgeBasesService)
    private readonly kbs: KnowledgeBasesService
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.kbs.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateKbDto) {
    return this.kbs.create(user.id, dto.title, dto.description);
  }

  @Get(':id/tree')
  getTree(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.kbs.getTree(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.kbs.remove(user.id, id);
  }
}
