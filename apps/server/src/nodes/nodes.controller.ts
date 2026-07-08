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
import { IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { NodesService } from './nodes.service.js';
import type { NodeType, NodeRole } from '@prisma/client';

class CreateNodeDto {
  @IsString()
  kbId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @IsIn(['DOC', 'FOLDER'])
  type?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}

class UpdateNodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

class MoveNodeDto {
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsInt()
  index!: number;
}

class CreateNodeVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

const MEMBER_ROLES: NodeRole[] = ['EDITOR', 'COMMENTER', 'VIEWER'];

class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(MEMBER_ROLES)
  role!: NodeRole;

  @IsOptional()
  includeChildren?: boolean;
}

class UpdateMemberDto {
  @IsIn(MEMBER_ROLES)
  role!: NodeRole;

  @IsOptional()
  includeChildren?: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('nodes')
export class NodesController {
  constructor(@Inject(NodesService) private readonly nodes: NodesService) {}

  @Get('shared')
  listShared(@CurrentUser() user: AuthUser) {
    return this.nodes.listShared(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodes.get(user.id, id);
  }

  @Get(':id/content')
  getContent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodes.getContent(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNodeDto) {
    return this.nodes.create(user.id, dto.kbId, {
      title: dto.title,
      type: dto.type as NodeType | undefined,
      parentId: dto.parentId,
    });
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateNodeDto) {
    return this.nodes.update(user.id, id, {
      title: dto.title,
    });
  }

  @Patch(':id/move')
  move(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MoveNodeDto) {
    return this.nodes.move(user.id, id, {
      parentId: dto.parentId ?? null,
      index: dto.index,
    });
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodes.remove(user.id, id);
  }

  // ---------- versions ----------

  @Get(':id/versions')
  listVersions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodes.listVersions(user.id, id);
  }

  @Post(':id/versions')
  createVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateNodeVersionDto
  ) {
    return this.nodes.createVersion(user.id, id, dto.label);
  }

  @Get(':id/versions/:versionId')
  getVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('versionId') versionId: string
  ) {
    return this.nodes.getVersion(user.id, id, versionId);
  }

  // ---------- node-level members ----------

  @Get(':id/members')
  listMembers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodes.listNodeMembers(user.id, id);
  }

  @Post(':id/members')
  addMember(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.nodes.addNodeMember(user.id, id, dto.email, dto.role, dto.includeChildren);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberDto
  ) {
    return this.nodes.updateNodeMember(user.id, id, targetUserId, dto.role, dto.includeChildren);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string
  ) {
    return this.nodes.removeNodeMember(user.id, id, targetUserId);
  }
}
