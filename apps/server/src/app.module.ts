import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CollabModule } from './collab/collab.module.js';
import { KnowledgeBasesModule } from './knowledge-bases/knowledge-bases.module.js';
import { NodesModule } from './nodes/nodes.module.js';
import { FilesModule } from './files/files.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    CollabModule,
    KnowledgeBasesModule,
    NodesModule,
    FilesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
