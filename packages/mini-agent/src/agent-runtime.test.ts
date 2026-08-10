import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from './agent-runtime.js';
import type {
  AgentEvent,
  AgentTool,
  ModelEvent,
  ModelRequest,
  ModelProvider,
  RunRequest,
} from './types.js';

function makeTool(): AgentTool {
  return {
    name: 'propose_document_patch',
    description: 'propose a patch',
    inputSchema: {
      type: 'object',
      properties: { baseContent: { type: 'string' }, newText: { type: 'string' } },
      required: ['baseContent', 'newText'],
    },
    riskLevel: 'write_proposal',
    execute: async () => ({ proposalId: 'p-1', edits: [] }),
  };
}

function makeRunRequest(tools: AgentTool[]): RunRequest {
  return {
    conversationId: 'conv-1',
    userMessage: '帮我改一下这段',
    context: {
      userId: 'u-1',
      kbId: 'kb-1',
      effectiveRole: 'OWNER',
      selection: { content: 'abc' },
    },
    tools,
    budget: { maxSteps: 3 },
  };
}

async function collect(runtime: AgentRuntime, request: RunRequest): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of runtime.run(request)) {
    out.push(event);
  }
  return out;
}

describe('AgentRuntime', () => {
  it('pairs assistant tool_calls with tool results in the next model round', async () => {
    const streamMock = vi.fn<(request: ModelRequest) => AsyncIterable<ModelEvent>>();
    streamMock.mockImplementationOnce(async function* () {
      yield {
        type: 'tool_call_start',
        toolName: 'propose_document_patch',
        toolCallId: 'call_1',
        args: { baseContent: 'abc', newText: 'def' },
      };
      yield {
        type: 'tool_call_end',
        toolCallId: 'call_1',
        toolName: 'propose_document_patch',
        result: null,
      };
    });
    streamMock.mockImplementationOnce(async function* () {
      yield { type: 'final_answer', text: 'done' };
    });

    const provider = { stream: streamMock } as unknown as ModelProvider;
    const runtime = new AgentRuntime(provider);
    const events = await collect(runtime, makeRunRequest([makeTool()]));

    // The runtime executed the tool and re-emitted the end event with the result.
    expect(
      events.some((e) => e.type === 'tool_call_end' && e.toolCallId === 'call_1' && e.result)
    ).toBe(true);

    // The second round received an assistant message carrying the real tool_calls,
    // so the OpenAI-compatible API can pair the following tool message.
    const secondRequest = streamMock.mock.calls[1][0] as ModelRequest;
    // OpenAI-compatible APIs require the assistant tool_calls message to precede
    // its tool messages, otherwise they reject the request with a 400.
    expect(secondRequest.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
    ]);
    const assistant = secondRequest.messages.find((m) => m.role === 'assistant');
    expect(assistant?.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'propose_document_patch',
        args: { baseContent: 'abc', newText: 'def' },
      },
    ]);
    const toolMessage = secondRequest.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.toolCallId).toBe('call_1');
    expect(toolMessage?.content).toContain('proposalId');
  });

  it('turns provider error events into run_completed(error)', async () => {
    const streamMock = vi.fn<(request: ModelRequest) => AsyncIterable<ModelEvent>>();
    streamMock.mockImplementationOnce(async function* () {
      yield { type: 'error', message: 'boom' };
    });

    const runtime = new AgentRuntime({ stream: streamMock } as unknown as ModelProvider);
    const events = await collect(runtime, makeRunRequest([]));

    expect(events.at(-1)).toEqual({
      type: 'run_completed',
      runId: expect.any(String),
      reason: 'error',
      steps: 0,
      error: 'boom',
    });
  });

  it('places request.history between the system prompt and the current user message', async () => {
    const streamMock = vi.fn<(request: ModelRequest) => AsyncIterable<ModelEvent>>();
    streamMock.mockImplementationOnce(async function* () {
      yield { type: 'final_answer', text: 'done' };
    });

    const runtime = new AgentRuntime({ stream: streamMock } as unknown as ModelProvider);
    const request = makeRunRequest([]);
    request.history = [
      { role: 'user', content: 'h1' },
      { role: 'assistant', content: 'a1' },
      { role: 'system', content: 'summary', internal: true },
    ];
    await collect(runtime, request);

    const modelRequest = streamMock.mock.calls[0][0] as ModelRequest;
    expect(modelRequest.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'system',
      'user',
    ]);
    // Internal messages (e.g. the rolling summary) are passed through unchanged.
    expect(modelRequest.messages[3]).toMatchObject({
      role: 'system',
      content: 'summary',
      internal: true,
    });
  });
});
