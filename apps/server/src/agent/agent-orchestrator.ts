import { Injectable, Inject } from '@nestjs/common';
import { AgentRuntime } from '@wiseflow/mini-agent';
import type {
  AgentTool,
  AgentEvent,
  Message,
  ModelProvider,
  RunRequest,
} from '@wiseflow/mini-agent';
import type { AgentRunStatus } from '@prisma/client';
import { AgentService } from './agent.service.js';
import { ContextBuilder } from './context-builder.js';
import { createProposeDocumentPatchTool } from './tools/propose-document-patch.tool.js';
import { createProposeWidgetTool } from './tools/propose-widget.tool.js';
import { AgentWidgetService } from './widgets/agent-widget.service.js';
import { ModelProviderFactory } from './model-provider.factory.js';

/** 历史轮次超过该值时，早期轮次压缩为滚动摘要，最近 MAX_HISTORY_TURNS 轮保留原文。 */
const MAX_HISTORY_TURNS = 20;

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
  | { type: 'summarizing'; runId: string }
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
    fromRelPos?: unknown;
    toRelPos?: unknown;
    content: string;
  };
}

@Injectable()
export class AgentOrchestrator {
  constructor(
    @Inject(AgentService) private readonly agentService: AgentService,
    @Inject(ContextBuilder) private readonly contextBuilder: ContextBuilder,
    @Inject(AgentWidgetService) private readonly widgetService: AgentWidgetService,
    @Inject(ModelProviderFactory) private readonly modelProviderFactory: ModelProviderFactory
  ) {}

  async *execute(input: ExecuteRunInput): AsyncIterable<SseAgentEvent> {
    const { provider, modelName } = this.modelProviderFactory.create();

    // 1. Create the run record
    const run = await this.agentService.createRun({
      conversationId: input.conversationId,
      userId: input.userId,
      kbId: input.kbId,
      nodeId: input.nodeId,
      message: input.message,
      modelName,
    });

    // Keep the conversation list sorted by recency.
    // The conversationId is validated by the controller, so this cannot fail.
    await this.agentService.touchConversation(input.conversationId);

    yield { type: 'run_started', runId: run.id };

    // 2. Build context
    yield { type: 'preparing_context', runId: run.id };

    let context;
    try {
      context = await this.contextBuilder.build({
        userId: input.userId,
        kbId: input.kbId,
        nodeId: input.nodeId,
        selection: input.selection,
        conversationId: input.conversationId,
      });

      // A run that carries a selection intends to rewrite the document,
      // so it needs edit permission. Plain Q&A (no selection) is open to
      // any knowledge-base member; read access is enforced by NodesService.
      if (input.selection) {
        const canWrite = context.effectiveRole === 'OWNER' || context.effectiveRole === 'EDITOR';
        if (!canWrite) {
          throw new Error('Editor permission is required to modify document content');
        }
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
    const tools: AgentTool[] = [
      createProposeDocumentPatchTool(this.agentService),
      createProposeWidgetTool(this.agentService, this.widgetService),
    ];

    // 4. Build conversation history: replay past turns, and when the turn
    //    count exceeds MAX_HISTORY_TURNS, compress early turns into a rolling
    //    summary persisted on the conversation. Failure must not block the
    //    run, so degrade to no history.
    let history: Message[] = [];
    try {
      const conversation = await this.agentService.getConversation(input.conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      const runs = await this.agentService.listConversationRuns(input.conversationId);
      const pastRuns = runs.filter((r) => r.id !== run.id);
      if (this.buildTurns(pastRuns).length > MAX_HISTORY_TURNS) {
        yield { type: 'summarizing', runId: run.id };
      }
      history = await this.buildHistory(pastRuns, conversation, provider);
    } catch {
      history = [];
    }

    // 5. Create Runtime with the configured provider
    const runtime = new AgentRuntime(provider);

    const runRequest: RunRequest = {
      runId: run.id,
      conversationId: input.conversationId,
      userMessage: input.message,
      context,
      tools,
      budget: {
        maxSteps: 3,
      },
      history,
      systemPromptAppend: await this.buildSystemPromptAppend(input.kbId),
    };

    let finalAnswer = '';
    let steps = 0;
    let toolCalls = 0;

    await this.agentService.updateRun(run.id, { status: 'REASONING' });

    try {
      for await (const event of runtime.run(runRequest)) {
        if (event.type !== 'run_started' && event.type !== 'run_completed') {
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
          if (event.reason !== 'final_answer') {
            await this.agentService.updateRun(run.id, {
              status: this.runStatusFor(event.reason),
              error: event.error,
              steps,
              toolCalls,
              completedAt: new Date(),
            });
            yield event;
            return;
          }
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

      await this.agentService.updateRun(run.id, {
        status: 'AWAITING_CONFIRMATION',
        finalAnswer,
        steps,
        toolCalls,
      });
      await this.agentService.updateTitleIfDefault(input.conversationId, input.message);

      yield {
        type: 'proposal_ready',
        runId: run.id,
        proposalId: proposal.id,
        patch: proposal.patch as unknown,
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
      await this.agentService.updateTitleIfDefault(input.conversationId, input.message);
      yield { type: 'run_completed', runId: run.id, reason: 'final_answer', steps };
    }
  }

  private runStatusFor(reason: 'error' | 'budget_exhausted' | 'cancelled'): AgentRunStatus {
    if (reason === 'error') {
      return 'FAILED';
    }
    if (reason === 'budget_exhausted') {
      return 'BUDGET_EXHAUSTED';
    }
    return 'CANCELLED';
  }

  /** 组装注入系统提示词末尾的组件生成规范与组件目录（复用决策）。 */
  private async buildSystemPromptAppend(kbId: string): Promise<string> {
    let catalogText = '';
    try {
      const widgets = await this.widgetService.listActive(kbId);
      if (widgets.length > 0) {
        catalogText =
          '\n\n当前知识库已有以下自定义组件，插入组件时优先复用（propose_widget 复用模式不提供 sourceCode，只填 props）：\n' +
          widgets.map((w) => `- ${w.widgetType}: ${w.title}`).join('\n');
      }
    } catch {
      catalogText = '';
    }

    return (
      '当用户要求插入自定义组件时，使用 propose_widget 工具。生成新组件必须符合规范：\n' +
      '- 单文件 TSX，默认导出组件\n' +
      '- 可以使用 JSX 语法，也可以 import react（如 import { useState } from "react"），' +
      'React 由编译期自动打包，不属于第三方库\n' +
      '- 禁止 import 除 react / react-dom 之外的任何第三方库\n' +
      '- 组件接收 { props, updateProps, mode, editable }，跨端协同的状态必须通过 ' +
      'props.updateProps 回写（props 是 JSON，函数、Date 等不可序列化）；组件内部 useState ' +
      '仅作本地 UI 状态，不会同步到协作者\n' +
      '- props 必须 JSON 可序列化：string / number / boolean / null / array / object\n' +
      '- 组件应自适应容器宽度，禁止外部网络请求与弹窗\n' +
      '- 生成的新组件必须经用户确认后才会生效' +
      catalogText
    );
  }

  /** Convert runs into user/assistant turn pairs, skipping failed turns (no finalAnswer). */
  private buildTurns(
    runs: { id: string; message: string; finalAnswer: string | null }[]
  ): { runId: string; user: string; assistant: string }[] {
    const turns: { runId: string; user: string; assistant: string }[] = [];
    for (const run of runs) {
      if (!run.finalAnswer) {
        continue;
      }
      turns.push({ runId: run.id, user: run.message, assistant: run.finalAnswer });
    }
    return turns;
  }

  /**
   * Build the history message list injected into the LLM context.
   *
   * When the turn count exceeds MAX_HISTORY_TURNS, turns before the recent
   * window are compressed into a rolling summary. Unsummarized early turns
   * (after summarizedThroughRunId) are merged with the old summary via a
   * non-streaming model call; on failure, early turns are dropped and only
   * the recent window is replayed.
   */
  private async buildHistory(
    runs: { id: string; message: string; finalAnswer: string | null }[],
    conversation: { id: string; summary: string | null; summarizedThroughRunId: string | null },
    provider: ModelProvider
  ): Promise<Message[]> {
    const turns = this.buildTurns(runs);

    if (turns.length <= MAX_HISTORY_TURNS) {
      return this.turnsToMessages(turns);
    }

    const overflow = turns.slice(0, turns.length - MAX_HISTORY_TURNS);
    const recent = turns.slice(turns.length - MAX_HISTORY_TURNS);

    const summarizedIndex = conversation.summarizedThroughRunId
      ? overflow.findIndex((t) => t.runId === conversation.summarizedThroughRunId)
      : -1;
    const unsummarized = overflow.slice(summarizedIndex + 1);

    let summary = conversation.summary ?? '';
    if (unsummarized.length > 0) {
      try {
        const newText = unsummarized
          .map((t) => `用户：${t.user}\n助手：${t.assistant}`)
          .join('\n\n');
        summary = await this.summarizeHistory(provider, summary, newText);
        await this.agentService.updateConversationSummary(
          conversation.id,
          summary,
          unsummarized[unsummarized.length - 1].runId
        );
      } catch {
        // Summarization failure: drop early turns, replay only the recent window.
        summary = conversation.summary ?? '';
      }
    }

    const history: Message[] = [];
    if (summary) {
      history.push({
        role: 'system',
        content: `以下是本会话更早轮次的对话摘要：\n${summary}`,
        internal: true,
      });
    }
    for (const t of recent) {
      history.push({ role: 'user', content: t.user });
      history.push({ role: 'assistant', content: t.assistant });
    }
    return history;
  }

  private turnsToMessages(turns: { user: string; assistant: string }[]): Message[] {
    const messages: Message[] = [];
    for (const t of turns) {
      messages.push({ role: 'user', content: t.user });
      messages.push({ role: 'assistant', content: t.assistant });
    }
    return messages;
  }

  private async summarizeHistory(
    provider: ModelProvider,
    oldSummary: string,
    newText: string
  ): Promise<string> {
    if (!provider.complete) {
      throw new Error('Model provider does not support non-streaming completion');
    }
    const prompt =
      '你是对话摘要助手。请把以下对话内容压缩成一段简洁的中文摘要，' +
      '保留关键主题、用户意图、已完成的决策，不要编造新内容。' +
      '摘要供后续对话参考。';
    const content = oldSummary
      ? `已有摘要：\n${oldSummary}\n\n新增对话：\n${newText}`
      : `对话内容：\n${newText}`;
    return provider.complete({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content },
      ],
      maxTokens: 2000,
    });
  }
}
