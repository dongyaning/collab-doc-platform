import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import type { NodeRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import * as Y from 'yjs';
import type { TreeNode } from '@wiseflow/shared';

const ROLE_RANK: Record<NodeRole, number> = {
  OWNER: 4,
  EDITOR: 3,
  COMMENTER: 2,
  VIEWER: 1,
};

export type EffectiveRole = NodeRole;

type KbWithOwnerAndCount = Prisma.KnowledgeBaseGetPayload<{
  include: { owner: { select: { id: true; name: true } }; _count: { select: { nodes: true } } };
}>;

@Injectable()
export class KnowledgeBasesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** KBs the user can see: owned + member (via root node membership). */
  async list(userId: string) {
    const rows = await this.prisma.knowledgeBase.findMany({
      where: {
        OR: [{ ownerId: userId }, { rootNode: { members: { some: { userId } } } }],
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { nodes: true } },
      },
    });
    return rows.map((kb: KbWithOwnerAndCount) => ({
      id: kb.id,
      title: kb.title,
      description: kb.description,
      owner: kb.owner,
      createdAt: kb.createdAt.toISOString(),
      updatedAt: kb.updatedAt.toISOString(),
      nodeCount: kb._count.nodes,
      role: kb.ownerId === userId ? ('OWNER' as const) : ('VIEWER' as const),
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
    // Create a root node for the KB
    const rootNode = await this.prisma.node.create({
      data: {
        kbId: kb.id,
        type: 'FOLDER',
        title: kb.title,
        yjsState: Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())),
      },
    });
    await this.prisma.knowledgeBase.update({
      where: { id: kb.id },
      data: { rootNodeId: rootNode.id },
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
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      include: { owner: { select: { id: true, name: true } } },
    });
    if (!kb) throw new NotFoundException();

    // Check if user has KB-level access (owner or rootNode member)
    const kbRole = await this.getEffectiveRole(userId, kbId);
    const hasKbAccess = kbRole !== null;

    let role: EffectiveRole;
    let allNodes: Array<{
      id: string;
      parentId: string | null;
      type: string;
      title: string;
      sortOrder: number;
    }>;

    if (hasKbAccess) {
      // User has KB-level access — full tree + require at least VIEWER
      role = await this.requireRole(userId, kbId, 'VIEWER');
      allNodes = await this.prisma.node.findMany({
        where: { kbId, id: { not: kb.rootNodeId ?? undefined } },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, parentId: true, type: true, title: true, sortOrder: true },
      });
    } else {
      // No KB-level access — check if user has any NodeMember in this KB
      const memberCount = await this.prisma.nodeMember.count({
        where: { userId, node: { kbId } },
      });
      if (memberCount === 0) throw new NotFoundException();

      // Resolve effective role from all accessible nodes
      role = (await this.getNodeEffectiveRole(userId, kb.rootNodeId ?? '')) ?? 'VIEWER';

      // Only nodes where user has a direct NodeMember, plus their
      // ancestors and (if includeChildren) descendants.
      const memberNodes = await this.prisma.nodeMember.findMany({
        where: { userId, node: { kbId } },
        select: { node: { select: { id: true, parentId: true } }, includeChildren: true },
      });

      const accessibleIds = new Set<string>();
      // Collect ancestor chain for each member node
      for (const m of memberNodes) {
        let curId: string | null = m.node.id;
        for (;;) {
          if (!curId) break;
          accessibleIds.add(curId);
          const rec: { parentId: string | null } | null = await this.prisma.node.findUnique({
            where: { id: curId },
            select: { parentId: true },
          });
          curId = rec?.parentId ?? null;
        }
      }
      // Collect descendants for nodes with includeChildren=true
      const descendantIds = new Set<string>();
      for (const m of memberNodes) {
        if (!m.includeChildren) continue;
        // BFS descendants of this node
        const queue = [m.node.id];
        while (queue.length > 0) {
          const pid = queue.shift()!;
          const children = await this.prisma.node.findMany({
            where: { kbId, parentId: pid },
            select: { id: true },
          });
          for (const child of children) {
            descendantIds.add(child.id);
            queue.push(child.id);
          }
        }
      }
      for (const id of descendantIds) {
        accessibleIds.add(id);
      }

      allNodes = await this.prisma.node.findMany({
        where: { kbId, id: { in: Array.from(accessibleIds), not: kb.rootNodeId ?? undefined } },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, parentId: true, type: true, title: true, sortOrder: true },
      });
    }

    const tree = this.buildTree(allNodes as TreeNode[]);
    return {
      kb: {
        id: kb.id,
        title: kb.title,
        description: kb.description,
        owner: kb.owner,
        createdAt: kb.createdAt.toISOString(),
        updatedAt: kb.updatedAt.toISOString(),
        nodeCount: allNodes.length,
        role,
      },
      nodes: tree,
    };
  }

  async remove(userId: string, kbId: string) {
    // Only allow deleting non-default KBs
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { defaultKbId: true },
    });
    if (user?.defaultKbId === kbId) {
      throw new ForbiddenException('cannot delete your default knowledge base');
    }
    await this.requireRole(userId, kbId, 'OWNER');
    await this.prisma.knowledgeBase.delete({ where: { id: kbId } });
    return { ok: true };
  }

  // ---------- members (via root node) ----------

  async listMembers(userId: string, kbId: string) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      select: { rootNodeId: true, ownerId: true },
    });
    if (!kb) throw new NotFoundException();
    await this.requireRole(userId, kbId, 'VIEWER');

    const members = await this.prisma.nodeMember.findMany({
      where: { nodeId: kb.rootNodeId! },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });

    const owner = await this.prisma.user.findUnique({
      where: { id: kb.ownerId },
      select: { id: true, email: true, name: true },
    });

    return {
      owner,
      members: members.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        createdAt: m.createdAt,
      })),
    };
  }

  async addMember(userId: string, kbId: string, email: string, role: NodeRole) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      select: { rootNodeId: true, ownerId: true },
    });
    if (!kb) throw new NotFoundException();
    await this.requireRole(userId, kbId, 'OWNER');
    if (role === 'OWNER') {
      throw new ForbiddenException('cannot grant OWNER role');
    }

    const invitee = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });
    if (!invitee) throw new NotFoundException(`no user with email ${email}`);
    if (kb.ownerId === invitee.id) {
      throw new ForbiddenException('user is already the owner');
    }

    await this.prisma.nodeMember.upsert({
      where: { nodeId_userId: { nodeId: kb.rootNodeId!, userId: invitee.id } },
      update: { role },
      create: { nodeId: kb.rootNodeId!, userId: invitee.id, role },
    });
    return { userId: invitee.id, email: invitee.email, name: invitee.name, role };
  }

  async updateMemberRole(userId: string, kbId: string, targetUserId: string, role: NodeRole) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      select: { rootNodeId: true },
    });
    if (!kb) throw new NotFoundException();
    await this.requireRole(userId, kbId, 'OWNER');
    if (role === 'OWNER') {
      throw new ForbiddenException('cannot grant OWNER role');
    }
    await this.prisma.nodeMember.update({
      where: { nodeId_userId: { nodeId: kb.rootNodeId!, userId: targetUserId } },
      data: { role },
    });
    return { ok: true };
  }

  async removeMember(userId: string, kbId: string, targetUserId: string) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      select: { rootNodeId: true },
    });
    if (!kb) throw new NotFoundException();
    await this.requireRole(userId, kbId, 'OWNER');
    if (userId === targetUserId) {
      throw new ForbiddenException('owner cannot remove themselves');
    }
    await this.prisma.nodeMember.delete({
      where: { nodeId_userId: { nodeId: kb.rootNodeId!, userId: targetUserId } },
    });
    return { ok: true };
  }

  // ---------- access helpers ----------

  async getEffectiveRole(userId: string, kbId: string): Promise<EffectiveRole | null> {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      select: { ownerId: true, rootNodeId: true },
    });
    if (!kb) return null;
    if (kb.ownerId === userId) return 'OWNER';
    if (!kb.rootNodeId) return null;

    const member = await this.prisma.nodeMember.findUnique({
      where: { nodeId_userId: { nodeId: kb.rootNodeId, userId } },
      select: { role: true },
    });
    return member?.role ?? null;
  }

  async requireRole(userId: string, kbId: string, min: NodeRole): Promise<EffectiveRole> {
    const role = await this.getEffectiveRole(userId, kbId);
    if (!role) throw new NotFoundException();
    if (ROLE_RANK[role] < ROLE_RANK[min]) throw new ForbiddenException();
    return role;
  }

  /** Resolve effective role for any node by walking the parent chain. */
  async getNodeEffectiveRole(userId: string, nodeId: string): Promise<EffectiveRole | null> {
    let currentId: string | null = nodeId;
    let best: EffectiveRole | null = null;

    while (currentId) {
      const member = await this.prisma.nodeMember.findUnique({
        where: { nodeId_userId: { nodeId: currentId, userId } },
        select: { role: true, includeChildren: true },
      });
      if (member) {
        // If the current node has a direct membership, it always applies.
        if (currentId === nodeId) {
          if (!best || ROLE_RANK[member.role] > ROLE_RANK[best]) {
            best = member.role;
            if (best === 'OWNER') return best;
          }
        } else if (member.includeChildren) {
          // Ancestor with includeChildren: true applies to descendants.
          if (!best || ROLE_RANK[member.role] > ROLE_RANK[best]) {
            best = member.role;
            if (best === 'OWNER') return best;
          }
        }
      }
      const parentInfo = (await this.prisma.node.findUnique({
        where: { id: currentId },
        select: { parentId: true, kb: { select: { ownerId: true } } },
      })) as { parentId: string | null; kb: { ownerId: string } } | null;
      if (!parentInfo) break;
      if (parentInfo.kb.ownerId === userId) return 'OWNER';
      currentId = parentInfo.parentId;
    }
    return best;
  }

  async requireNodeRole(userId: string, nodeId: string, min: NodeRole): Promise<EffectiveRole> {
    const role = await this.getNodeEffectiveRole(userId, nodeId);
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
