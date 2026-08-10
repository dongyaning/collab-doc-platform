import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import type { AgentRunStatus } from '@prisma/client';

export interface CreateRunInput {
  conversationId: string;
  userId: string;
  kbId: string;
  nodeId?: string;
  message: string;
  modelName?: string;
}

export interface CreateProposalInput {
  runId: string;
  nodeId: string;
  baseVersion: number;
  patch: unknown;
  affectedRange?: unknown;
}

export interface UpdateRunInput {
  status?: AgentRunStatus;
  finalAnswer?: string;
  steps?: number;
  toolCalls?: number;
  error?: string;
  completedAt?: Date;
}

@Injectable()
export class AgentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createRun(input: CreateRunInput) {
    return this.prisma.agentRun.create({
      data: {
        conversationId: input.conversationId,
        userId: input.userId,
        kbId: input.kbId,
        nodeId: input.nodeId ?? null,
        message: input.message,
        modelName: input.modelName ?? 'mock',
        status: 'QUEUED',
      },
    });
  }

  async createConversation(userId: string, kbId: string) {
    return this.prisma.agentConversation.create({
      data: { userId, kbId },
    });
  }

  async listConversations(userId: string, kbId: string) {
    return this.prisma.agentConversation.findMany({
      where: { userId, kbId },
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    });
  }

  async getConversation(conversationId: string) {
    return this.prisma.agentConversation.findUnique({
      where: { id: conversationId },
    });
  }

  async listConversationRuns(conversationId: string) {
    return this.prisma.agentRun.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: { proposals: true },
    });
  }

  /** Bump lastMessageAt so the conversation list sorts by recency. */
  async touchConversation(conversationId: string) {
    return this.prisma.agentConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });
  }

  /** Persist the rolling summary and the run id it covers. */
  async updateConversationSummary(
    conversationId: string,
    summary: string,
    summarizedThroughRunId: string
  ) {
    return this.prisma.agentConversation.update({
      where: { id: conversationId },
      data: { summary, summarizedThroughRunId },
    });
  }

  /** Idempotent: name the conversation with the first message when it is still untitled. */
  async updateTitleIfDefault(conversationId: string, message: string) {
    return this.prisma.agentConversation.updateMany({
      where: { id: conversationId, title: '新会话' },
      data: { title: message.slice(0, 20) },
    });
  }

  async updateRun(runId: string, input: UpdateRunInput) {
    return this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        ...input,
      },
    });
  }

  async createProposal(input: CreateProposalInput) {
    return this.prisma.agentProposal.create({
      data: {
        runId: input.runId,
        nodeId: input.nodeId,
        baseVersion: input.baseVersion,
        patch: input.patch as object,
        affectedRange: input.affectedRange as object | undefined,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min
      },
    });
  }

  /**
   * Confirm a proposal with an atomic status transition.
   *
   * Only PENDING proposals that have not expired can be confirmed.
   * Node.version is no longer the primary conflict check; it is kept
   * for audit only (the frontend performs write-time content validation).
   */
  async confirmProposal(proposalId: string, userId: string) {
    const result = await this.prisma.agentProposal.updateMany({
      where: { id: proposalId, status: 'PENDING', expiresAt: { gt: new Date() } },
      data: {
        status: 'APPLYING',
        confirmedBy: userId,
        confirmedAt: new Date(),
      },
    });

    if (result.count === 0) {
      const existing = await this.getProposal(proposalId);
      if (!existing) {
        throw new NotFoundException('Agent proposal not found');
      }
      if (existing.status === 'EXPIRED') {
        throw new ConflictException('The proposal has expired. Generate a new proposal.');
      }
      throw new ConflictException('The proposal is not pending or has already been confirmed.');
    }

    const updated = await this.getProposal(proposalId);
    return updated!;
  }

  /** Mark APPLYING proposal as APPLIED (idempotent). */
  async markProposalApplied(proposalId: string) {
    await this.prisma.agentProposal.updateMany({
      where: { id: proposalId, status: 'APPLYING' },
      data: {
        status: 'APPLIED',
        appliedAt: new Date(),
      },
    });
    return (await this.getProposal(proposalId))!;
  }

  /** Mark PENDING/APPLYING proposal as STALE (idempotent). */
  async markProposalStale(proposalId: string) {
    await this.prisma.agentProposal.updateMany({
      where: { id: proposalId, status: { in: ['PENDING', 'APPLYING'] } },
      data: {
        status: 'STALE',
      },
    });
    return (await this.getProposal(proposalId))!;
  }

  /** Reject PENDING/APPLYING proposal (idempotent). */
  async rejectProposal(proposalId: string) {
    await this.prisma.agentProposal.updateMany({
      where: { id: proposalId, status: { in: ['PENDING', 'APPLYING'] } },
      data: {
        status: 'REJECTED',
      },
    });
    return (await this.getProposal(proposalId))!;
  }

  async getRun(runId: string) {
    return this.prisma.agentRun.findUnique({
      where: { id: runId },
      include: { proposals: true },
    });
  }

  async getProposal(proposalId: string) {
    return this.prisma.agentProposal.findUnique({
      where: { id: proposalId },
      include: { run: true },
    });
  }
}
