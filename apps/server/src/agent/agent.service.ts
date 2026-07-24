import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

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

  async confirmProposal(proposalId: string, userId: string) {
    const proposal = await this.prisma.agentProposal.findUnique({
      where: { id: proposalId },
    });
    if (!proposal) {
      throw new NotFoundException('Agent proposal not found');
    }

    const node = await this.prisma.node.findUnique({
      where: { id: proposal.nodeId },
      select: { version: true },
    });
    if (!node || node.version !== proposal.baseVersion) {
      await this.markProposalStale(proposalId);
      throw new ConflictException('The document changed. Generate a new proposal.');
    }

    return this.prisma.agentProposal.update({
      where: { id: proposalId },
      data: {
        status: 'APPLYING',
        confirmedBy: userId,
        confirmedAt: new Date(),
      },
    });
  }

  async markProposalApplied(proposalId: string) {
    return this.prisma.agentProposal.update({
      where: { id: proposalId },
      data: {
        status: 'APPLIED',
        appliedAt: new Date(),
      },
    });
  }

  async markProposalStale(proposalId: string) {
    return this.prisma.agentProposal.update({
      where: { id: proposalId },
      data: {
        status: 'STALE',
      },
    });
  }

  async rejectProposal(proposalId: string) {
    return this.prisma.agentProposal.update({
      where: { id: proposalId },
      data: {
        status: 'REJECTED',
      },
    });
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
