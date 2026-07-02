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
