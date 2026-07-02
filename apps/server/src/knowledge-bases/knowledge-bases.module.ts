import { Module } from '@nestjs/common';
import { KnowledgeBasesController } from './knowledge-bases.controller.js';
import { KnowledgeBasesService } from './knowledge-bases.service.js';

@Module({
  controllers: [KnowledgeBasesController],
  providers: [KnowledgeBasesService],
  exports: [KnowledgeBasesService],
})
export class KnowledgeBasesModule {}
