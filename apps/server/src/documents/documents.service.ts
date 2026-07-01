import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import type { Prisma, DocumentRole } from '@prisma/client';
import { RoomManager } from '../collab/room-manager.js';

/** Order from most to least privileged. Used for "at least" checks. */
const ROLE_RANK: Record<DocumentRole, number> = {
  OWNER: 4,
  EDITOR: 3,
  COMMENTER: 2,
  VIEWER: 1,
};

export type EffectiveRole = DocumentRole;

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RoomManager) private readonly rooms: RoomManager
  ) {}

  /** Documents the user can see: owned + any they're a member of. */
  async list(userId: string) {
    const rows = await this.prisma.document.findMany({
      where: {
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        createdAt: true,
        ownerId: true,
        owner: { select: { name: true, email: true } },
        members: {
          where: { userId },
          select: { role: true },
          take: 1,
        },
      },
    });
    return rows.map((d) => ({
      id: d.id,
      title: d.title,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      owner: { id: d.ownerId, name: d.owner.name, email: d.owner.email },
      role: (d.ownerId === userId ? 'OWNER' : (d.members[0]?.role ?? 'VIEWER')) as EffectiveRole,
    }));
  }

  async get(userId: string, id: string) {
    const role = await this.requireRole(userId, id, 'VIEWER');
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException();
    return { ...doc, role };
  }

  create(userId: string, title?: string) {
    return this.prisma.document.create({
      data: {
        ownerId: userId,
        title: title ?? 'Untitled',
        content: { type: 'doc', content: [] } as Prisma.InputJsonValue,
      },
    });
  }

  async update(
    userId: string,
    id: string,
    patch: { title?: string; content?: Prisma.InputJsonValue }
  ) {
    await this.requireRole(userId, id, 'EDITOR');
    return this.prisma.document.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.requireRole(userId, id, 'OWNER');
    await this.prisma.document.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- versions ----------

  async listVersions(userId: string, docId: string) {
    await this.requireRole(userId, docId, 'VIEWER');
    return this.prisma.documentVersion.findMany({
      where: { documentId: docId },
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

  async createVersion(userId: string, docId: string, label?: string) {
    await this.requireRole(userId, docId, 'EDITOR');
    return this.rooms.createManualSnapshot(docId, userId, label);
  }

  async getVersion(userId: string, docId: string, versionId: string) {
    await this.requireRole(userId, docId, 'VIEWER');
    return this.rooms.getVersionSnapshot(docId, versionId);
  }

  // ---------- members ----------

  async listMembers(userId: string, docId: string) {
    await this.requireRole(userId, docId, 'VIEWER');
    const doc = await this.prisma.document.findUnique({
      where: { id: docId },
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
    if (!doc) throw new NotFoundException();
    return {
      owner: doc.owner,
      members: doc.members.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        createdAt: m.createdAt,
      })),
    };
  }

  async addMember(userId: string, docId: string, email: string, role: DocumentRole) {
    await this.requireRole(userId, docId, 'OWNER');
    if (role === 'OWNER') {
      throw new ForbiddenException('cannot grant OWNER role; transfer ownership instead');
    }
    const invitee = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });
    if (!invitee) throw new NotFoundException(`no user with email ${email}`);
    const doc = await this.prisma.document.findUnique({
      where: { id: docId },
      select: { ownerId: true },
    });
    if (doc?.ownerId === invitee.id) {
      throw new ForbiddenException('user is already the owner');
    }
    await this.prisma.documentMember.upsert({
      where: { documentId_userId: { documentId: docId, userId: invitee.id } },
      update: { role },
      create: { documentId: docId, userId: invitee.id, role },
    });
    return { userId: invitee.id, email: invitee.email, name: invitee.name, role };
  }

  async updateMemberRole(userId: string, docId: string, targetUserId: string, role: DocumentRole) {
    await this.requireRole(userId, docId, 'OWNER');
    if (role === 'OWNER') {
      throw new ForbiddenException('cannot grant OWNER role; transfer ownership instead');
    }
    await this.prisma.documentMember.update({
      where: { documentId_userId: { documentId: docId, userId: targetUserId } },
      data: { role },
    });
    return { ok: true };
  }

  async removeMember(userId: string, docId: string, targetUserId: string) {
    await this.requireRole(userId, docId, 'OWNER');
    if (userId === targetUserId) {
      throw new ForbiddenException('owner cannot remove themselves');
    }
    await this.prisma.documentMember.delete({
      where: { documentId_userId: { documentId: docId, userId: targetUserId } },
    });
    return { ok: true };
  }

  // ---------- access helpers ----------

  /**
   * Resolve the user's effective role on a document, or null if no access.
   * Owner short-circuits to OWNER without a membership row.
   */
  async getEffectiveRole(userId: string, docId: string): Promise<EffectiveRole | null> {
    const doc = await this.prisma.document.findUnique({
      where: { id: docId },
      select: {
        ownerId: true,
        members: { where: { userId }, select: { role: true }, take: 1 },
      },
    });
    if (!doc) return null;
    if (doc.ownerId === userId) return 'OWNER';
    return doc.members[0]?.role ?? null;
  }

  private async requireRole(
    userId: string,
    docId: string,
    min: DocumentRole
  ): Promise<EffectiveRole> {
    const role = await this.getEffectiveRole(userId, docId);
    if (!role) throw new NotFoundException();
    if (ROLE_RANK[role] < ROLE_RANK[min]) throw new ForbiddenException();
    return role;
  }
}
