import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RoomManager } from './room-manager.js';
import { CollabGateway } from './collab.gateway.js';

@Module({
  imports: [AuthModule, PrismaModule],
  providers: [RoomManager, CollabGateway],
  exports: [CollabGateway, RoomManager],
})
export class CollabModule {}
