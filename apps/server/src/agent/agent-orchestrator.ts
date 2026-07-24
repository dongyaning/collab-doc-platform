import { Injectable, Inject } from '@nestjs/common';
import { AgentRuntime, MockModelProvider } from '@wiseflow/mini-agent';
import type { AgentTool, AgentEvent, RunRequest } from '@wiseflow/mini-agent';
import { AgentService } from './agent.service.js';
import { ContextBuilder } from './context-builder.js';
import { createProposeDocumentPatchTool } from './tools/propose-document-patch.tool.js';

/**
 * SSE-flavored event emitted to the frontend.
 *
 * This extends the raw Runtime AgentEvent with extra fields that
 * the frontend needs (e.g. a proposal_ready event carrying the
 * full patch payload for diff rendering).
 */
export type SseAgentEvent =
  | AgentEvent
  | { type: 'preparing_context'; runId: string }
  | {
      type: 'proposal_ready';
      runId: string;
      proposalId: string;
      patch: unknown;
      nodeId: string;
      baseVersion: number;
    };

export interface ExecuteRunInput {
  conversationId: string;
  userId: string;
  kbId: string;
  nodeId?: string;
  nodeBaseVersion?: number;
  message: string;
  selection?: {
    from: number;
    to: number;
    text: string;
  };
}

@Injectable()
export class AgentOrchestrator {
  constructor(
    private readonly agentService: AgentService,
    @Inject(ContextBuilder) private readonly contextBuilder: ContextBuilder
  ) {}

  async *execute(input: ExecuteRunInput): AsyncIterable<SseAgentEvent> {
    // 1. Create the run record
    const run = await this.agentService.createRun({
      conversationId: input.conversationId,
      userId: input.userId,
      kbId: input.kbId,
      nodeId: input.nodeId,
      message: input.message,
      modelName: 'mock',
    });

    // 2. Build context
    yield { type: 'preparing_context', runId: run.id };

    let context;
    try {
      context = await this.contextBuilder.build({
        userId: input.userId,
        kbId: input.kbId,
        nodeId: input.nodeId,
        selection: input.selection,
      });

      if (
        input.nodeBaseVersion !== undefined &&
        input.nodeBaseVersion !== context.documentVersion
      ) {
        throw new Error('Document version changed before the Agent run started');
      }
      if (context.effectiveRole !== 'OWNER' && context.effectiveRole !== 'EDITOR') {
        throw new Error('Editor permission is required to modify document content');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Context preparation failed';
      await this.agentService.updateRun(run.id, {
        status: 'FAILED',
        error: message,
        completedAt: new Date(),
      });
      yield {
        type: 'run_completed',
        runId: run.id,
        reason: 'error',
        steps: 0,
        error: message,
      };
      return;
    }

    await this.agentService.updateRun(run.id, { status: 'PREPARING_CONTEXT' });

    // 3. Prepare tools
    const tools: AgentTool[] = [createProposeDocumentPatchTool(this.agentService)];

    // 4. Create Runtime with Mock provider
    const modelProvider = new MockModelProvider();
    const runtime = new AgentRuntime(modelProvider);

    const runRequest: RunRequest = {
      runId: run.id,
      conversationId: input.conversationId,
      userMessage: input.message,
      context,
      tools,
      budget: {
        maxSteps: 3,
      },
    };

    let finalAnswer = '';
    let steps = 0;
    let toolCalls = 0;

    await this.agentService.updateRun(run.id, { status: 'REASONING' });

    try {
      for await (const event of runtime.run(runRequest)) {
        if (event.type !== 'run_completed') {
          yield event;
        }

        if (event.type === 'final_answer') {
          finalAnswer = event.text;
          steps = event.steps;
        }
        if (event.type === 'tool_call_end') {
          toolCalls++;
        }
        if (event.type === 'run_completed') {
          steps = event.steps;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await this.agentService.updateRun(run.id, {
        status: 'FAILED',
        error: msg,
        completedAt: new Date(),
      });
      yield { type: 'run_completed', runId: run.id, reason: 'error', steps, error: msg };
      return;
    }

    // 5. After loop ends, check for pending proposals
    const updatedRun = await this.agentService.getRun(run.id);
    if (updatedRun && updatedRun.proposals.length > 0) {
      const proposal = updatedRun.proposals[updatedRun.proposals.length - 1];
      const patch = proposal.patch as Record<string, unknown>;

      await this.agentService.updateRun(run.id, {
        status: 'AWAITING_CONFIRMATION',
        finalAnswer,
        steps,
        toolCalls,
      });

      yield {
        type: 'proposal_ready',
        runId: run.id,
        proposalId: proposal.id,
        patch: {
          type: patch.type,
          from: patch.from,
          to: patch.to,
          newText: patch.newText,
        },
        nodeId: proposal.nodeId,
        baseVersion: proposal.baseVersion,
      };
    } else {
      await this.agentService.updateRun(run.id, {
        status: 'COMPLETED',
        finalAnswer,
        steps,
        toolCalls,
        completedAt: new Date(),
      });
      yield { type: 'run_completed', runId: run.id, reason: 'final_answer', steps };
    }
  }
}
