import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { type Request, type Response } from 'express';
import { gunzipSync } from 'node:zlib';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service.js';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { AgentService } from './agent.service.js';
import { AgentWidgetService } from './widgets/agent-widget.service.js';

class CreateRunDto {
  @IsString()
  @MaxLength(5000)
  message!: string;

  @IsString()
  kbId!: string;

  @IsOptional()
  @IsString()
  nodeId?: string;

  @IsOptional()
  @IsInt()
  nodeBaseVersion?: number;

  @IsOptional()
  @IsObject()
  selection?: {
    fromRelPos: unknown;
    toRelPos: unknown;
    content: string;
  };
}

class CreateConversationDto {
  @IsString()
  kbId!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('agent')
export class AgentController {
  constructor(
    @Inject(AgentOrchestrator) private readonly orchestrator: AgentOrchestrator,
    @Inject(AgentService) private readonly agentService: AgentService,
    @Inject(AgentWidgetService) private readonly widgetService: AgentWidgetService,
    @Inject(KnowledgeBasesService) private readonly kbService: KnowledgeBasesService
  ) {}

  /**
   * 组件目录：知识库内 ACTIVE 组件（不含代码），供 Agent 复用决策与前端展示。
   */
  @Get('widgets')
  async listWidgets(@Query('kbId') kbId: string, @CurrentUser() user: AuthUser) {
    if (!kbId) {
      throw new BadRequestException('kbId is required');
    }
    const role = await this.kbService.getEffectiveRole(user.id, kbId);
    if (!role) {
      throw new NotFoundException('Knowledge base not found or no access');
    }
    return this.widgetService.listActive(kbId);
  }

  /**
   * 组件详情：按 widgetType 返回 ACTIVE 组件（含 jsCode）。
   * 由 nodeId 定位所属知识库并校验访问权限（VIEWER 及以上）。
   * 同一版本代码不可变，配合 immutable 缓存前端只拉一次。
   */
  @Get('widgets/:widgetType')
  async getWidget(
    @Param('widgetType') widgetType: string,
    @Query('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response
  ) {
    if (!nodeId) {
      throw new BadRequestException('nodeId is required');
    }
    const role = await this.kbService.getNodeEffectiveRole(user.id, nodeId);
    if (!role) {
      throw new NotFoundException('Document not found or no access');
    }

    const component = await this.widgetService.getActive(widgetType);
    if (!component) {
      throw new NotFoundException('Agent widget not found or not active');
    }

    const jsCode = gunzipSync(component.jsCodeGzip).toString('utf8');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    return res.json({
      widgetType: component.widgetType,
      title: component.title,
      version: component.version,
      propsSchema: component.propsSchema,
      jsCode,
      status: component.status,
    });
  }

  /** List conversations of the current user, scoped to a knowledge base. */
  @Get('conversations')
  async listConversations(@Query('kbId') kbId: string, @CurrentUser() user: AuthUser) {
    return this.agentService.listConversations(user.id, kbId);
  }

  /** Create a conversation bound to the current knowledge base. */
  @Post('conversations')
  async createConversation(@Body() dto: CreateConversationDto, @CurrentUser() user: AuthUser) {
    const conversation = await this.agentService.createConversation(user.id, dto.kbId);
    return {
      id: conversation.id,
      title: conversation.title,
      lastMessageAt: conversation.lastMessageAt,
    };
  }

  /** History runs of a conversation, used to rebuild the message stream. */
  @Get('conversations/:conversationId/runs')
  async listRuns(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthUser) {
    await this.assertConversationOwner(conversationId, user.id);
    return this.agentService.listConversationRuns(conversationId);
  }

  /**
   * Create a new agent run and stream results via SSE.
   *
   * The conversation must belong to the current user and be bound to the
   * same knowledge base. The SSE stream emits token, tool_call,
   * proposal_ready, and final_answer events.
   */
  @Post('conversations/:conversationId/runs')
  async createRun(
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateRunDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const conversation = await this.assertConversationOwner(conversationId, user.id);
    if (conversation.kbId !== dto.kbId) {
      throw new BadRequestException('kbId does not match the conversation');
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const input = {
      conversationId,
      userId: user.id,
      kbId: dto.kbId,
      nodeId: dto.nodeId,
      nodeBaseVersion: dto.nodeBaseVersion,
      message: dto.message,
      selection: dto.selection,
    };

    req.on('close', () => {
      // Handle client disconnect — could cancel the run
    });

    try {
      for await (const event of this.orchestrator.execute(input)) {
        const data = JSON.stringify(event);
        res.write(`data: ${data}\n\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.write(
        `data: ${JSON.stringify({
          type: 'run_completed',
          runId: '',
          reason: 'error',
          error: msg,
        })}\n\n`
      );
    }

    res.end();
  }

  /**
   * Confirm a proposal, transitioning it to APPLYING status.
   * The frontend will then apply the patch and acknowledge the result.
   */
  @Post('proposals/:id/confirm')
  async confirmProposal(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const existing = await this.agentService.getProposal(id);
    this.assertProposalOwner(existing?.run.userId, user.id);

    const proposal = await this.agentService.confirmProposal(id, user.id);
    await this.agentService.updateRun(proposal.runId, { status: 'APPLYING' });

    // 提案含 widget edit 时激活组件（DRAFT → ACTIVE），复用模式为无害 no-op
    const patch = proposal.patch as { edits?: Array<{ kind?: string; widgetType?: string }> };
    for (const edit of patch.edits ?? []) {
      if (edit.kind === 'widget' && edit.widgetType) {
        await this.widgetService.activateComponent(edit.widgetType);
      }
    }

    return { ok: true, proposalId: id, status: 'APPLYING' };
  }

  /**
   * Frontend calls this after successfully applying the patch via TipTap/Yjs.
   * Marks the proposal as APPLIED and the run as COMPLETED.
   */
  @Post('proposals/:id/applied')
  async proposalApplied(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const existing = await this.agentService.getProposal(id);
    this.assertProposalOwner(existing?.run.userId, user.id);

    const proposal = await this.agentService.markProposalApplied(id);
    await this.agentService.updateRun(proposal.runId, {
      status: 'COMPLETED',
      completedAt: new Date(),
    });
    return { proposalId: id, status: 'APPLIED', runStatus: 'COMPLETED' };
  }

  /**
   * Mark a proposal stale after the frontend detects a version or selection conflict.
   */
  @Post('proposals/:id/stale')
  async staleProposal(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const existing = await this.agentService.getProposal(id);
    this.assertProposalOwner(existing?.run.userId, user.id);

    const proposal = await this.agentService.markProposalStale(id);
    await this.agentService.updateRun(proposal.runId, {
      status: 'FAILED',
      error: 'Document changed before the Agent proposal was applied',
      completedAt: new Date(),
    });
    return { ok: true, proposalId: id, status: 'STALE' };
  }

  /**
   * Reject a proposal.
   */
  @Post('proposals/:id/reject')
  async rejectProposal(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const existing = await this.agentService.getProposal(id);
    this.assertProposalOwner(existing?.run.userId, user.id);

    const proposal = await this.agentService.rejectProposal(id);
    await this.agentService.updateRun(proposal.runId, {
      status: 'COMPLETED',
      completedAt: new Date(),
    });
    return { ok: true, proposalId: id, status: 'REJECTED' };
  }

  /**
   * Cancel an in-progress run.
   */
  @Post('runs/:id/cancel')
  async cancelRun(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const run = await this.agentService.getRun(id);
    if (!run || run.userId !== user.id) {
      throw new NotFoundException('Agent run not found');
    }

    await this.agentService.updateRun(id, {
      status: 'CANCELLED',
      completedAt: new Date(),
    });
    return { ok: true, runId: id, status: 'CANCELLED' };
  }

  private async assertConversationOwner(conversationId: string, userId: string) {
    const conversation = await this.agentService.getConversation(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundException('Agent conversation not found');
    }
    return conversation;
  }

  private assertProposalOwner(ownerId: string | undefined, userId: string) {
    if (!ownerId || ownerId !== userId) {
      throw new NotFoundException('Agent proposal not found');
    }
  }
}
