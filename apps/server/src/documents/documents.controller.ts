import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsEmail, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { DocumentsService } from './documents.service.js';
import type { Prisma, DocumentRole } from '@prisma/client';

class CreateDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsObject()
  content?: Prisma.InputJsonValue;
}

class CreateVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

const MEMBER_ROLES: DocumentRole[] = ['EDITOR', 'COMMENTER', 'VIEWER'];

class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(MEMBER_ROLES)
  role!: DocumentRole;
}

class UpdateMemberDto {
  @IsIn(MEMBER_ROLES)
  role!: DocumentRole;
}

@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly docs: DocumentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.docs.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDocumentDto) {
    return this.docs.create(user.id, dto.title);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.docs.get(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateDocumentDto) {
    return this.docs.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.docs.remove(user.id, id);
  }

  // ---------- versions ----------

  @Get(':id/versions')
  listVersions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.docs.listVersions(user.id, id);
  }

  @Post(':id/versions')
  createVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateVersionDto
  ) {
    return this.docs.createVersion(user.id, id, dto.label);
  }

  @Get(':id/versions/:versionId')
  getVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('versionId') versionId: string
  ) {
    return this.docs.getVersion(user.id, id, versionId);
  }

  // ---------- members ----------

  @Get(':id/members')
  listMembers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.docs.listMembers(user.id, id);
  }

  @Post(':id/members')
  addMember(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.docs.addMember(user.id, id, dto.email, dto.role);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberDto
  ) {
    return this.docs.updateMemberRole(user.id, id, targetUserId, dto.role);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string
  ) {
    return this.docs.removeMember(user.id, id, targetUserId);
  }
}
