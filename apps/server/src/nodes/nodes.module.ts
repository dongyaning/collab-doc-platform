import { Module } from '@nestjs/common';
import { NodesController } from './nodes.controller.js';
import { NodesService } from './nodes.service.js';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module.js';
import { CollabModule } from '../collab/collab.module.js';

@Module({
  imports: [KnowledgeBasesModule, CollabModule],
  controllers: [NodesController],
  providers: [NodesService],
  exports: [NodesService],
})
export class NodesModule {}
