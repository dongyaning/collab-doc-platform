import { Body, Controller, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { type Request, type Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { AgentService } from './agent.service.js';

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
    from: number;
    to: number;
    text: string;
  };
}

@UseGuards(JwtAuthGuard)
@Controller('agent')
export class AgentController {
  constructor(
    @Inject(AgentOrchestrator) private readonly orchestrator: AgentOrchestrator,
    @Inject(AgentService) private readonly agentService: AgentService
  ) {}

  /**
   * Create a new agent run and stream results via SSE.
   *
   * The conversation ID is derived from the authenticated user + kbId.
   * The SSE stream emits token, tool_call, proposal_ready, and final_answer events.
   */
  @Post('conversations/:conversationId/runs')
  async createRun(
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateRunDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response
  ) {
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
      throw new Error('Agent run not found');
    }

    await this.agentService.updateRun(id, {
      status: 'CANCELLED',
      completedAt: new Date(),
    });
    return { ok: true, runId: id, status: 'CANCELLED' };
  }

  private assertProposalOwner(ownerId: string | undefined, userId: string) {
    if (!ownerId || ownerId !== userId) {
      throw new Error('Agent proposal not found');
    }
  }
}
