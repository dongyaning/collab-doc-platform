import { describe, expect, it, vi } from 'vitest';
import type { ModelEvent, ModelProvider } from '@wiseflow/mini-agent';
import { AgentOrchestrator } from './agent-orchestrator.js';
import type { SseAgentEvent } from './agent-orchestrator.js';
import { AgentService } from './agent.service.js';
import { ContextBuilder } from './context-builder.js';
import { AgentWidgetService } from './widgets/agent-widget.service.js';
import { ModelProviderFactory } from './model-provider.factory.js';

vi.mock('./agent.service.js', () => ({
  AgentService: class {
    createRun = vi.fn();
    touchConversation = vi.fn();
    updateRun = vi.fn();
    getRun = vi.fn();
    updateTitleIfDefault = vi.fn();
    getConversation = vi.fn();
    listConversationRuns = vi.fn();
    updateConversationSummary = vi.fn();
  },
}));

vi.mock('./context-builder.js', () => ({
  ContextBuilder: class {
    build = vi.fn();
  },
}));

vi.mock('./model-provider.factory.js', () => ({
  ModelProviderFactory: class {
    create = vi.fn();
  },
}));

vi.mock('./widgets/agent-widget.service.js', () => ({
  AgentWidgetService: class {
    listActive = vi.fn();
  },
}));

function failingProvider(): ModelProvider {
  return {
    stream: async function* (): AsyncIterable<ModelEvent> {
      yield { type: 'error', message: 'model exploded' };
    },
  };
}

async function runOrchestrator(
  provider: ModelProvider,
  setup?: (agentService: AgentService) => void
): Promise<{ events: SseAgentEvent[]; agentService: AgentService }> {
  const agentService = new AgentService({} as never);
  const contextBuilder = new ContextBuilder({} as never, {} as never);
  const widgetService = new AgentWidgetService({} as never);
  const factory = new ModelProviderFactory({} as never);
  (factory.create as ReturnType<typeof vi.fn>).mockReturnValue({
    provider,
    modelName: 'test-model',
  });
  (agentService.createRun as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'run-1' });
  (agentService.touchConversation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (agentService.updateRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (contextBuilder.build as ReturnType<typeof vi.fn>).mockResolvedValue({ effectiveRole: 'OWNER' });
  setup?.(agentService);

  const orchestrator = new AgentOrchestrator(
    agentService as unknown as AgentService,
    contextBuilder as unknown as ContextBuilder,
    widgetService as unknown as AgentWidgetService,
    factory as unknown as ModelProviderFactory
  );

  const events: SseAgentEvent[] = [];
  for await (const event of orchestrator.execute({
    conversationId: 'conv-1',
    userId: 'u-1',
    kbId: 'kb-1',
    message: 'hi',
  })) {
    events.push(event);
  }
  return { events, agentService };
}

describe('AgentOrchestrator', () => {
  it('marks the run as FAILED when the model errors mid-run', async () => {
    const { events, agentService } = await runOrchestrator(failingProvider());

    expect(agentService.updateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED', error: 'model exploded' })
    );
    expect(events.at(-1)).toEqual({
      type: 'run_completed',
      runId: 'run-1',
      reason: 'error',
      steps: 0,
      error: 'model exploded',
    });
    expect(agentService.getRun).not.toHaveBeenCalled();
    expect(agentService.updateTitleIfDefault).not.toHaveBeenCalled();
  });

  it('still completes normally when the model returns a final answer', async () => {
    const provider: ModelProvider = {
      stream: async function* (): AsyncIterable<ModelEvent> {
        yield { type: 'final_answer', text: 'ok' };
      },
    };
    const { events, agentService } = await runOrchestrator(provider, (svc) => {
      (svc.getRun as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'run-1', proposals: [] });
    });

    expect(agentService.updateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'COMPLETED', finalAnswer: 'ok' })
    );
    expect(events.at(-1)).toEqual({
      type: 'run_completed',
      runId: 'run-1',
      reason: 'final_answer',
      steps: 0,
    });
  });

  it('injects past turns into the model context when within the turn limit', async () => {
    let streamMessages: { role: string; content?: string; internal?: boolean }[] = [];
    const provider: ModelProvider = {
      stream: async function* (request): AsyncIterable<ModelEvent> {
        streamMessages = request.messages;
        yield { type: 'final_answer', text: 'ok' };
      },
    };
    const runs = [
      { id: 'r1', message: 'm1', finalAnswer: 'a1' },
      { id: 'r2', message: 'm2', finalAnswer: 'a2' },
    ];
    const { events, agentService } = await runOrchestrator(provider, (svc) => {
      (svc.getConversation as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'conv-1',
        summary: null,
        summarizedThroughRunId: null,
      });
      (svc.listConversationRuns as ReturnType<typeof vi.fn>).mockResolvedValue(runs);
    });

    expect(agentService.updateConversationSummary).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'summarizing')).toBe(false);
    // system + 2 turns (user/assistant) + current user message
    expect(streamMessages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(streamMessages[1]).toMatchObject({ role: 'user', content: 'm1' });
    expect(streamMessages[2]).toMatchObject({ role: 'assistant', content: 'a1' });
  });

  it('emits a summarizing event and persists the rolling summary past the turn limit', async () => {
    let streamMessages: { role: string; content?: string; internal?: boolean }[] = [];
    const provider: ModelProvider = {
      stream: async function* (request): AsyncIterable<ModelEvent> {
        streamMessages = request.messages;
        yield { type: 'final_answer', text: 'ok' };
      },
      complete: async () => 'summary-text',
    };
    const runs = Array.from({ length: 21 }, (_, i) => ({
      id: `r${i}`,
      message: `m${i}`,
      finalAnswer: `a${i}`,
    }));
    const { events, agentService } = await runOrchestrator(provider, (svc) => {
      (svc.getConversation as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'conv-1',
        summary: null,
        summarizedThroughRunId: null,
      });
      (svc.listConversationRuns as ReturnType<typeof vi.fn>).mockResolvedValue(runs);
    });

    expect(events.some((e) => e.type === 'summarizing')).toBe(true);
    expect(agentService.updateConversationSummary).toHaveBeenCalledWith(
      'conv-1',
      'summary-text',
      'r0'
    );
    // system + internal summary + 20 recent turns + current user message
    const recentRoles = Array.from({ length: 20 }, () => ['user', 'assistant'] as const).flat();
    expect(streamMessages.map((m) => m.role)).toEqual(['system', 'system', ...recentRoles, 'user']);
    expect(streamMessages[1]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('summary-text'),
      internal: true,
    });
  });

  it('drops early turns and keeps only the recent window when summarization fails', async () => {
    let streamMessages: { role: string; content?: string; internal?: boolean }[] = [];
    const provider: ModelProvider = {
      stream: async function* (request): AsyncIterable<ModelEvent> {
        streamMessages = request.messages;
        yield { type: 'final_answer', text: 'ok' };
      },
      complete: async () => {
        throw new Error('boom');
      },
    };
    const runs = Array.from({ length: 21 }, (_, i) => ({
      id: `r${i}`,
      message: `m${i}`,
      finalAnswer: `a${i}`,
    }));
    const { events, agentService } = await runOrchestrator(provider, (svc) => {
      (svc.getConversation as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'conv-1',
        summary: null,
        summarizedThroughRunId: null,
      });
      (svc.listConversationRuns as ReturnType<typeof vi.fn>).mockResolvedValue(runs);
    });

    expect(agentService.updateConversationSummary).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'summarizing')).toBe(true);
    // system + 20 recent turns + current user message; no internal summary message
    expect(streamMessages.filter((m) => m.internal === true)).toHaveLength(0);
    expect(streamMessages).toHaveLength(42);
  });
});
