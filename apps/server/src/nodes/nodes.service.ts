import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service.js';
import type { Prisma, NodeType, NodeRole } from '@prisma/client';
import { RoomManager } from '../collab/room-manager.js';

@Injectable()
export class NodesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeBasesService)
    private readonly kbs: KnowledgeBasesService,
    @Inject(RoomManager) private readonly rooms: RoomManager
  ) {}

  async get(userId: string, nodeId: string) {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });
    if (!node) throw new NotFoundException();
    // access check via hierarchical node permissions
    await this.kbs.requireNodeRole(userId, nodeId, 'VIEWER');
    return node;
  }

  async create(
    userId: string,
    kbId: string,
    data: {
      title?: string;
      type?: NodeType;
      parentId?: string | null;
      content?: Prisma.InputJsonValue;
    }
  ) {
    await this.kbs.requireRole(userId, kbId, 'EDITOR');

    // get the max sortOrder among siblings
    const siblings = await this.prisma.node.findMany({
      where: { kbId, parentId: data.parentId ?? null },
      orderBy: { sortOrder: 'desc' },
      take: 1,
      select: { sortOrder: true },
    });
    const nextOrder = (siblings[0]?.sortOrder ?? -1) + 1;

    const node = await this.prisma.node.create({
      data: {
        kbId,
        parentId: data.parentId ?? null,
        type: data.type ?? 'DOC',
        title: data.title ?? 'Untitled',
        sortOrder: nextOrder,
        content: data.content ?? ({ type: 'doc', content: [] } as Prisma.InputJsonValue),
      },
    });
    return node;
  }

  async update(
    userId: string,
    nodeId: string,
    patch: {
      title?: string;
      content?: Prisma.InputJsonValue;
      type?: NodeType;
    }
  ) {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });
    if (!node) throw new NotFoundException();
    await this.kbs.requireNodeRole(userId, nodeId, 'EDITOR');

    return this.prisma.node.update({
      where: { id: nodeId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
      },
    });
  }

  async move(userId: string, nodeId: string, data: { parentId: string | null; index: number }) {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });
    if (!node) throw new NotFoundException();
    await this.kbs.requireNodeRole(userId, nodeId, 'EDITOR');

    const kbId = node.kbId;
    const newParentId = data.parentId;

    // prevent dropping a node into itself or its own descendant
    if (newParentId === nodeId) {
      throw new ForbiddenException('cannot move a node into itself');
    }
    if (newParentId) {
      let cursor: string | null = newParentId;
      while (cursor) {
        const ancestor: { id: string; parentId: string | null } | null =
          await this.prisma.node.findUnique({
            where: { id: cursor },
            select: { id: true, parentId: true },
          });
        if (!ancestor) break;
        if (ancestor.id === nodeId) {
          throw new ForbiddenException('cannot move a node into its own descendant');
        }
        cursor = ancestor.parentId;
      }
    }

    // fetch destination siblings (excluding the moved node)
    const siblings = await this.prisma.node.findMany({
      where: { kbId, parentId: newParentId, id: { not: nodeId } },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });

    const clampedIndex = Math.max(0, Math.min(data.index, siblings.length));
    const orderedIds = [
      ...siblings.slice(0, clampedIndex).map((s) => s.id),
      nodeId,
      ...siblings.slice(clampedIndex).map((s) => s.id),
    ];

    // reassign sortOrder for all siblings atomically
    await this.prisma.$transaction(
      orderedIds.map((id, i) =>
        this.prisma.node.update({
          where: { id },
          data: { sortOrder: i, parentId: newParentId },
        })
      )
    );

    return this.prisma.node.findUnique({ where: { id: nodeId } });
  }

  async remove(userId: string, nodeId: string) {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });
    if (!node) throw new NotFoundException();
    await this.kbs.requireNodeRole(userId, nodeId, 'OWNER');

    await this.prisma.node.delete({ where: { id: nodeId } });
    return { ok: true };
  }

  // ---------- versions ----------

  async listVersions(userId: string, nodeId: string) {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });
    if (!node) throw new NotFoundException();
    await this.kbs.requireNodeRole(userId, nodeId, 'VIEWER');

    return this.prisma.nodeVersion.findMany({
      where: { nodeId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        version: true,
        label: true,
        createdById: true,
        createdAt: true,
      },
    });
  }

  async createVersion(userId: string, nodeId: string, label?: string) {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });
    if (!node) throw new NotFoundException();
    await this.kbs.requireNodeRole(userId, nodeId, 'EDITOR');

    return this.rooms.createManualSnapshot(nodeId, userId, label);
  }

  async getVersion(userId: string, nodeId: string, versionId: string) {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });
    if (!node) throw new NotFoundException();
    await this.kbs.requireNodeRole(userId, nodeId, 'VIEWER');

    return this.rooms.getVersionSnapshot(nodeId, versionId);
  }

  // ---------- node-level members ----------

  /** List nodes shared with the user (where they have a direct NodeMember). */
  async listShared(userId: string) {
    // Find all NodeMember rows for this user, grouped by KB.
    // Exclude rootNode memberships (those are KB-level shares).
    const memberships = await this.prisma.nodeMember.findMany({
      where: { userId },
      select: {
        role: true,
        node: {
          select: {
            id: true,
            kbId: true,
            type: true,
            title: true,
            parentId: true,
            sortOrder: true,
            kb: { select: { id: true, title: true, rootNodeId: true } },
          },
        },
      },
    });

    // Filter out rootNode memberships and group by KB
    const seenKbIds = new Set<string>();
    const result: Array<{
      node: { id: string; kbId: string; type: string; title: string; parentId: string | null };
      kb: { id: string; title: string };
      role: NodeRole;
    }> = [];

    for (const m of memberships) {
      if (m.node.kb.rootNodeId === m.node.id) continue; // KB-level share
      seenKbIds.add(m.node.kbId);
      result.push({
        node: {
          id: m.node.id,
          kbId: m.node.kbId,
          type: m.node.type,
          title: m.node.title,
          parentId: m.node.parentId,
        },
        kb: { id: m.node.kb.id, title: m.node.kb.title },
        role: m.role,
      });
    }

    return result;
  }

  async listNodeMembers(userId: string, nodeId: string) {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });
    if (!node) throw new NotFoundException();
    await this.kbs.requireNodeRole(userId, nodeId, 'VIEWER');

    const members = await this.prisma.nodeMember.findMany({
      where: { nodeId },
      select: {
        role: true,
        includeChildren: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });

    // Resolve the node's KB owner
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: node.kbId },
      select: { ownerId: true, owner: { select: { id: true, email: true, name: true } } },
    });

    return {
      owner: kb!.owner,
      members: members.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        includeChildren: m.includeChildren,
        createdAt: m.createdAt,
      })),
    };
  }

  async addNodeMember(
    userId: string, nodeId: string, email: string, role: NodeRole,
    includeChildren = false,
  ) {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });
    if (!node) throw new NotFoundException();
    await this.kbs.requireNodeRole(userId, nodeId, 'OWNER');
    if (role === 'OWNER') {
      throw new ForbiddenException('cannot grant OWNER role');
    }

    const invitee = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });
    if (!invitee) throw new NotFoundException(`no user with email ${email}`);

    await this.prisma.nodeMember.upsert({
      where: { nodeId_userId: { nodeId, userId: invitee.id } },
      update: { role, includeChildren },
      create: { nodeId, userId: invitee.id, role, includeChildren },
    });
    return { userId: invitee.id, email: invitee.email, name: invitee.name, role };
  }

  async updateNodeMember(
    userId: string, nodeId: string, targetUserId: string, role: NodeRole,
    includeChildren?: boolean,
  ) {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });
    if (!node) throw new NotFoundException();
    await this.kbs.requireNodeRole(userId, nodeId, 'OWNER');
    if (role === 'OWNER') {
      throw new ForbiddenException('cannot grant OWNER role');
    }

    await this.prisma.nodeMember.update({
      where: { nodeId_userId: { nodeId, userId: targetUserId } },
      data: { role, ...(includeChildren !== undefined ? { includeChildren } : {}) },
    });
    return { ok: true };
  }

  async removeNodeMember(userId: string, nodeId: string, targetUserId: string) {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });
    if (!node) throw new NotFoundException();
    await this.kbs.requireNodeRole(userId, nodeId, 'OWNER');
    if (userId === targetUserId) {
      throw new NotFoundException('cannot remove yourself');
    }

    await this.prisma.nodeMember.delete({
      where: { nodeId_userId: { nodeId, userId: targetUserId } },
    });
    return { ok: true };
  }
}
