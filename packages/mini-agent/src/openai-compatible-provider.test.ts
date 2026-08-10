import { describe, expect, it, vi } from 'vitest';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { OpenAICompatibleModelProvider } from './openai-compatible-provider.js';
import type { ModelEvent, ModelRequest, ToolSchema } from './types.js';

const { MockOpenAI } = vi.hoisted(() => {
  class MockOpenAI {
    static lastInstance: MockOpenAI | null = null;
    chat = {
      completions: {
        create: vi.fn(),
      },
    };
    constructor() {
      MockOpenAI.lastInstance = this;
    }
  }
  return { MockOpenAI };
});

vi.mock('openai', () => ({ default: MockOpenAI }));

function chunkWith(partial: Partial<ChatCompletionChunk>): ChatCompletionChunk {
  return {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'deepseek-chat',
    choices: [{ index: 0, delta: {}, finish_reason: null }],
    ...partial,
  } as unknown as ChatCompletionChunk;
}

function streamOf(chunks: ChatCompletionChunk[]): AsyncIterable<ChatCompletionChunk> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

function makeRequest(tools: ToolSchema[] = []): ModelRequest {
  return {
    messages: [{ role: 'user', content: '你好' }],
    tools,
    maxTokens: 8000,
  };
}

async function collect(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const event of events) {
    out.push(event);
  }
  return out;
}

type MockClient = InstanceType<typeof MockOpenAI>;

function createProvider(): {
  provider: OpenAICompatibleModelProvider;
  client: MockClient;
} {
  const provider = new OpenAICompatibleModelProvider({
    apiKey: 'test-key',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  });
  return { provider, client: MockOpenAI.lastInstance as MockClient };
}

describe('OpenAICompatibleModelProvider', () => {
  it('forwards content deltas as token events and ends with the full text', async () => {
    const { provider, client } = createProvider();
    client.chat.completions.create.mockImplementation(async () =>
      streamOf([
        chunkWith({ choices: [{ index: 0, delta: { content: '你' }, finish_reason: null }] }),
        chunkWith({ choices: [{ index: 0, delta: { content: '好' }, finish_reason: null }] }),
        chunkWith({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      ])
    );

    const events = await collect(provider.stream(makeRequest()));

    expect(events).toEqual([
      { type: 'token', text: '你' },
      { type: 'token', text: '好' },
      { type: 'final_answer', text: '你好' },
    ]);
  });

  it('accumulates split tool_call fragments into a complete start event', async () => {
    const { provider, client } = createProvider();
    client.chat.completions.create.mockImplementation(async () =>
      streamOf([
        chunkWith({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'propose_document_patch', arguments: '{"baseContent":' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        chunkWith({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: '"abc","newText":"def"}' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        chunkWith({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
      ])
    );

    const events = await collect(provider.stream(makeRequest()));

    expect(events).toEqual([
      {
        type: 'tool_call_start',
        toolName: 'propose_document_patch',
        toolCallId: 'call_1',
        args: { baseContent: 'abc', newText: 'def' },
      },
      {
        type: 'tool_call_end',
        toolCallId: 'call_1',
        toolName: 'propose_document_patch',
        result: null,
      },
    ]);
  });

  it('forwards the abort signal to the SDK request', async () => {
    const { provider, client } = createProvider();
    const abortController = new AbortController();
    client.chat.completions.create.mockImplementation(
      async (
        _body: ChatCompletionCreateParamsStreaming,
        options?: { signal?: AbortSignal | null }
      ) => {
        expect(options?.signal).toBe(abortController.signal);
        return streamOf([]);
      }
    );

    await collect(provider.stream({ ...makeRequest(), signal: abortController.signal }));

    expect(client.chat.completions.create).toHaveBeenCalledOnce();
  });

  it('maps SDK errors to an error event instead of throwing', async () => {
    const { provider, client } = createProvider();
    client.chat.completions.create.mockRejectedValueOnce(new Error('401 unauthorized'));

    const events = await collect(provider.stream(makeRequest()));

    expect(events).toEqual([{ type: 'error', message: '401 unauthorized' }]);
  });

  it('degrades to an error event when tool arguments are malformed', async () => {
    const { provider, client } = createProvider();
    client.chat.completions.create.mockImplementation(async () =>
      streamOf([
        chunkWith({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'propose_document_patch', arguments: '{not-json' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
      ])
    );

    const events = await collect(provider.stream(makeRequest()));

    expect(events).toEqual([
      { type: 'error', message: 'Failed to parse arguments for tool propose_document_patch' },
    ]);
  });

  it('converts tools to the OpenAI function format', async () => {
    const { provider, client } = createProvider();
    client.chat.completions.create.mockImplementation(
      async (body: ChatCompletionCreateParamsStreaming) => {
        expect(body.tools).toEqual([
          {
            type: 'function',
            function: {
              name: 'propose_document_patch',
              description: 'propose a patch',
              parameters: { type: 'object' },
            },
          },
        ]);
        return streamOf([]);
      }
    );

    await collect(
      provider.stream(
        makeRequest([
          {
            name: 'propose_document_patch',
            description: 'propose a patch',
            inputSchema: { type: 'object' },
          },
        ])
      )
    );
  });
});
