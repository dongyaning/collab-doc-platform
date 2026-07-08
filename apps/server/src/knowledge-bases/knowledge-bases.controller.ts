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
import { IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AccessRequestScope, AccessRequestStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { KnowledgeBasesService } from './knowledge-bases.service.js';
import type { NodeRole } from '@prisma/client';

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

const MEMBER_ROLES: NodeRole[] = ['EDITOR', 'COMMENTER', 'VIEWER'];

class AddKbMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(MEMBER_ROLES)
  role!: NodeRole;
}

class UpdateKbMemberDto {
  @IsIn(MEMBER_ROLES)
  role!: NodeRole;
}

class CreateAccessRequestDto {
  @IsEnum(AccessRequestScope)
  scope!: AccessRequestScope;

  @IsOptional()
  @IsString()
  nodeId?: string;

  @IsOptional()
  @IsIn(MEMBER_ROLES)
  requestedRole?: NodeRole;

  @IsOptional()
  @IsBoolean()
  includeChildren?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

class ReviewAccessRequestDto {
  @IsEnum(AccessRequestStatus)
  status!: AccessRequestStatus;

  @IsOptional()
  @IsIn(MEMBER_ROLES)
  role?: NodeRole;

  @IsOptional()
  @IsEnum(AccessRequestScope)
  scope?: AccessRequestScope;

  @IsOptional()
  @IsString()
  nodeId?: string;

  @IsOptional()
  @IsBoolean()
  includeChildren?: boolean;
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

  // ---------- access requests ----------

  @Post(':id/access-requests')
  createAccessRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateAccessRequestDto
  ) {
    return this.kbs.createAccessRequest(user.id, id, dto);
  }

  @Get(':id/access-requests/my')
  getMyAccessRequest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.kbs.getMyAccessRequest(user.id, id);
  }

  @Get(':id/access-requests')
  listAccessRequests(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.kbs.listAccessRequests(user.id, id);
  }

  @Patch(':id/access-requests/:requestId')
  reviewAccessRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: ReviewAccessRequestDto
  ) {
    return this.kbs.reviewAccessRequest(user.id, id, requestId, dto);
  }

  // ---------- members ----------

  @Get(':id/members')
  listMembers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.kbs.listMembers(user.id, id);
  }

  @Post(':id/members')
  addMember(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddKbMemberDto) {
    return this.kbs.addMember(user.id, id, dto.email, dto.role);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateKbMemberDto
  ) {
    return this.kbs.updateMemberRole(user.id, id, targetUserId, dto.role);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string
  ) {
    return this.kbs.removeMember(user.id, id, targetUserId);
  }
}
