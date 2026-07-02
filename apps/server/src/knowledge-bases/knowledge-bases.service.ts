import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import type { DocumentRole } from '@prisma/client';
import type { TreeNode } from '@collab/shared';

const ROLE_RANK: Record<DocumentRole, number> = {
  OWNER: 4,
  EDITOR: 3,
  COMMENTER: 2,
  VIEWER: 1,
};

export type EffectiveRole = DocumentRole;

@Injectable()
export class KnowledgeBasesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** KBs the user can see: owned + member. */
  async list(userId: string) {
    const rows = await this.prisma.knowledgeBase.findMany({
      where: {
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { nodes: true } },
      },
    });
    return rows.map((kb) => ({
      id: kb.id,
      title: kb.title,
      description: kb.description,
      owner: kb.owner,
      createdAt: kb.createdAt.toISOString(),
      updatedAt: kb.updatedAt.toISOString(),
      nodeCount: kb._count.nodes,
    }));
  }

  async create(userId: string, title?: string, description?: string) {
    const kb = await this.prisma.knowledgeBase.create({
      data: {
        ownerId: userId,
        title: title ?? 'Untitled Space',
        description,
      },
      include: { owner: { select: { id: true, name: true } } },
    });
    return {
      id: kb.id,
      title: kb.title,
      description: kb.description,
      owner: kb.owner,
      createdAt: kb.createdAt.toISOString(),
      updatedAt: kb.updatedAt.toISOString(),
      nodeCount: 0,
    };
  }

  async getTree(userId: string, kbId: string) {
    const role = await this.requireRole(userId, kbId, 'VIEWER');
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      include: { owner: { select: { id: true, name: true } } },
    });
    if (!kb) throw new NotFoundException();

    const nodes = await this.prisma.node.findMany({
      where: { kbId },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        parentId: true,
        type: true,
        title: true,
        sortOrder: true,
      },
    });

    const tree = this.buildTree(nodes as TreeNode[]);
    return {
      kb: {
        id: kb.id,
        title: kb.title,
        description: kb.description,
        owner: kb.owner,
        createdAt: kb.createdAt.toISOString(),
        updatedAt: kb.updatedAt.toISOString(),
        nodeCount: nodes.length,
        role,
      },
      nodes: tree,
    };
  }

  async remove(userId: string, kbId: string) {
    await this.requireRole(userId, kbId, 'OWNER');
    await this.prisma.knowledgeBase.delete({ where: { id: kbId } });
    return { ok: true };
  }

  // ---------- members ----------

  async listMembers(userId: string, kbId: string) {
    await this.requireRole(userId, kbId, 'VIEWER');
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      select: {
        ownerId: true,
        owner: { select: { id: true, email: true, name: true } },
        members: {
          select: {
            role: true,
            createdAt: true,
            user: { select: { id: true, email: true, name: true } },
          },
        },
      },
    });
    if (!kb) throw new NotFoundException();
    return {
      owner: kb.owner,
      members: kb.members.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        createdAt: m.createdAt,
      })),
    };
  }

  async addMember(userId: string, kbId: string, email: string, role: DocumentRole) {
    await this.requireRole(userId, kbId, 'OWNER');
    if (role === 'OWNER') {
      throw new ForbiddenException('cannot grant OWNER role');
    }
    const invitee = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });
    if (!invitee) throw new NotFoundException(`no user with email ${email}`);

    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      select: { ownerId: true },
    });
    if (kb?.ownerId === invitee.id) {
      throw new ForbiddenException('user is already the owner');
    }

    await this.prisma.kbMember.upsert({
      where: { kbId_userId: { kbId, userId: invitee.id } },
      update: { role },
      create: { kbId, userId: invitee.id, role },
    });
    return { userId: invitee.id, email: invitee.email, name: invitee.name, role };
  }

  async updateMemberRole(userId: string, kbId: string, targetUserId: string, role: DocumentRole) {
    await this.requireRole(userId, kbId, 'OWNER');
    if (role === 'OWNER') {
      throw new ForbiddenException('cannot grant OWNER role');
    }
    await this.prisma.kbMember.update({
      where: { kbId_userId: { kbId, userId: targetUserId } },
      data: { role },
    });
    return { ok: true };
  }

  async removeMember(userId: string, kbId: string, targetUserId: string) {
    await this.requireRole(userId, kbId, 'OWNER');
    if (userId === targetUserId) {
      throw new ForbiddenException('owner cannot remove themselves');
    }
    await this.prisma.kbMember.delete({
      where: { kbId_userId: { kbId, userId: targetUserId } },
    });
    return { ok: true };
  }

  // ---------- access helpers ----------

  async getEffectiveRole(userId: string, kbId: string): Promise<EffectiveRole | null> {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      select: {
        ownerId: true,
        members: { where: { userId }, select: { role: true }, take: 1 },
      },
    });
    if (!kb) return null;
    if (kb.ownerId === userId) return 'OWNER';
    return kb.members[0]?.role ?? null;
  }

  async requireRole(userId: string, kbId: string, min: DocumentRole): Promise<EffectiveRole> {
    const role = await this.getEffectiveRole(userId, kbId);
    if (!role) throw new NotFoundException();
    if (ROLE_RANK[role] < ROLE_RANK[min]) throw new ForbiddenException();
    return role;
  }

  // ---------- private ----------

  private buildTree(nodes: TreeNode[]): TreeNode[] {
    const map = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    for (const n of nodes) {
      map.set(n.id, { ...n, children: [] });
    }
    for (const n of map.values()) {
      if (n.parentId && map.has(n.parentId)) {
        map.get(n.parentId)!.children.push(n);
      } else {
        roots.push(n);
      }
    }
    return roots;
  }
}
