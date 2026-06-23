import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import type { Prisma } from '@prisma/client';

@Injectable()
export class DocumentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.document.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true, createdAt: true },
    });
  }

  async get(userId: string, id: string) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException();
    if (doc.ownerId !== userId) throw new ForbiddenException();
    return doc;
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
    await this.assertOwner(userId, id);
    return this.prisma.document.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.assertOwner(userId, id);
    await this.prisma.document.delete({ where: { id } });
    return { ok: true };
  }

  private async assertOwner(userId: string, id: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { ownerId: true },
    });
    if (!doc) throw new NotFoundException();
    if (doc.ownerId !== userId) throw new ForbiddenException();
  }
}
