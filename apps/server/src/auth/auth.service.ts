import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DEFAULT_AVATAR_URL, DEFAULT_AVATARS } from '@wiseflow/shared';
import bcrypt from 'bcryptjs';
import * as Y from 'yjs';
import { PrismaService } from '../prisma/prisma.module.js';

export interface JwtPayload {
  sub: string;
  email: string;
}

type AuthResponseUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
};

function toAuthResponseUser(user: AuthResponseUser): AuthResponseUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

function resolveAvatarUrl(avatarUrl: string | undefined): string {
  const value = avatarUrl?.trim();
  if (!value) {
    return DEFAULT_AVATAR_URL;
  }
  const isDefaultAvatar = DEFAULT_AVATARS.some((avatar) => avatar.url === value);
  const isUploadedAvatar = value.startsWith('/uploads/');
  return isDefaultAvatar || isUploadedAvatar ? value : DEFAULT_AVATAR_URL;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('invalid credentials');
    return user;
  }

  async register(email: string, password: string, name: string, avatarUrl?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('email already registered');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: { email, name, passwordHash, avatarUrl: resolveAvatarUrl(avatarUrl) },
    });

    // Create default knowledge base with a root node
    const kb = await this.prisma.knowledgeBase.create({
      data: {
        title: `${name}'s Knowledge Base`,
        ownerId: user.id,
      },
    });
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
    await this.prisma.user.update({
      where: { id: user.id },
      data: { defaultKbId: kb.id },
    });

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwt.signAsync(payload);
    return {
      accessToken,
      user: toAuthResponseUser(user),
    };
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwt.signAsync(payload);
    return {
      accessToken,
      user: toAuthResponseUser(user),
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('invalid credentials');
    return toAuthResponseUser(user);
  }
}
