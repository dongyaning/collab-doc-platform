import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module.js';
import { NodesModule } from '../nodes/nodes.module.js';
import { CollabModule } from '../collab/collab.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AgentController } from './agent.controller.js';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { AgentService } from './agent.service.js';
import { ContextBuilder } from './context-builder.js';
import { ModelProviderFactory } from './model-provider.factory.js';

@Module({
  imports: [PrismaModule, KnowledgeBasesModule, NodesModule, CollabModule, AuthModule],
  controllers: [AgentController],
  providers: [AgentOrchestrator, AgentService, ContextBuilder, ModelProviderFactory],
})
export class AgentModule {}
