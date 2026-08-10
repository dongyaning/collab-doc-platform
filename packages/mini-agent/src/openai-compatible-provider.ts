import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { FunctionParameters } from 'openai/resources/shared';
import type {
  CompleteRequest,
  Message,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  ToolCall,
  ToolSchema,
} from './types.js';

/**
 * OpenAICompatibleModelProvider — talks to any OpenAI-compatible chat
 * completions endpoint (DeepSeek, Qwen, GLM, ...) via the `openai` SDK.
 *
 * Mapping rules:
 * - `delta.content` chunks are forwarded as `token` events and accumulated.
 * - `delta.tool_calls` are accumulated per index (the JSON `arguments` arrive
 *   as split fragments) and emitted as `tool_call_start` only after the stream
 *   ends, followed by a placeholder `tool_call_end`. The AgentRuntime ignores
 *   the placeholder result and executes the tool itself, so this mirrors the
 *   MockModelProvider event ordering.
 * - `delta.reasoning_content` (DeepSeek thinking) is intentionally dropped;
 *   the frontend has no thinking-chain display.
 * - Any SDK error is converted into an `error` event instead of throwing.
 */
export interface OpenAICompatibleConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export class OpenAICompatibleModelProvider implements ModelProvider {
  private readonly client: OpenAI;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  }

  async complete(request: CompleteRequest): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.config.model,
      messages: toOpenAIMessages(request.messages),
      max_tokens: request.maxTokens,
      stream: false,
    });
    return completion.choices[0]?.message?.content ?? '';
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const tools = toOpenAITools(request.tools);
    const toolCallsByIndex = new Map<
      number,
      { id: string; name: string; argsFragments: string[] }
    >();
    let content = '';

    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.config.model,
          messages: toOpenAIMessages(request.messages),
          tools,
          max_tokens: request.maxTokens,
          stream: true,
        },
        { signal: request.signal }
      );

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) {
          continue;
        }

        if (delta.content) {
          content += delta.content;
          yield { type: 'token', text: delta.content };
        }

        if (delta.tool_calls) {
          for (const fragment of delta.tool_calls) {
            let acc = toolCallsByIndex.get(fragment.index);
            if (!acc) {
              acc = {
                id: fragment.id ?? '',
                name: fragment.function?.name ?? '',
                argsFragments: [],
              };
              toolCallsByIndex.set(fragment.index, acc);
            }
            if (fragment.id) {
              acc.id = fragment.id;
            }
            if (fragment.function?.name) {
              acc.name = fragment.function.name;
            }
            if (fragment.function?.arguments) {
              acc.argsFragments.push(fragment.function.arguments);
            }
          }
        }
      }
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : 'Model request failed' };
      return;
    }

    if (toolCallsByIndex.size > 0) {
      for (const acc of toolCallsByIndex.values()) {
        const args = parseToolArguments(acc);
        if (args instanceof Error) {
          // Malformed arguments would produce a tool message without a
          // matching assistant tool_call, breaking the next API round.
          yield { type: 'error', message: args.message };
          return;
        }
        const toolCallId = acc.id || `tc_${acc.name}`;
        yield { type: 'tool_call_start', toolName: acc.name, toolCallId, args };
        // Placeholder result; AgentRuntime executes the tool and re-emits the
        // event with the real result.
        yield { type: 'tool_call_end', toolCallId, toolName: acc.name, result: null };
      }
      return;
    }

    yield { type: 'final_answer', text: content };
  }
}

function toOpenAITools(tools: ToolSchema[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      // JsonSchema is structurally compatible; OpenAI expects a JSON-serializable object.
      parameters: t.inputSchema as unknown as FunctionParameters,
    },
  }));
}

function toOpenAIMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages.map((m) => {
    switch (m.role) {
      case 'system':
        return { role: 'system', content: m.content };
      case 'user':
        return { role: 'user', content: m.content };
      case 'tool':
        return { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '' };
      case 'assistant':
        return m.toolCalls && m.toolCalls.length > 0
          ? {
              role: 'assistant',
              content: m.content,
              tool_calls: m.toolCalls.map((tc: ToolCall) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.args) },
              })),
            }
          : { role: 'assistant', content: m.content };
    }
  });
}

function parseToolArguments(acc: { name: string; argsFragments: string[] }): unknown | Error {
  const raw = acc.argsFragments.join('');
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return new Error(`Failed to parse arguments for tool ${acc.name}`);
  }
}
