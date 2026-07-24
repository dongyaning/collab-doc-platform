import type {
  AgentEvent,
  Message,
  ModelProvider,
  RunBudget,
  RunRequest,
  ToolExecutionContext,
} from './types.js';

const DEFAULT_BUDGET: RunBudget = {
  maxSteps: 5,
  maxToolCalls: 8,
  maxInputTokens: 32000,
  maxOutputTokens: 8000,
  toolTimeoutMs: 30000,
  runTimeoutMs: 120000,
};

const SYSTEM_PROMPT = `You are a helpful AI assistant embedded in a collaborative document platform.
You can read documents, search knowledge bases, and propose document changes.
When the user asks you to modify document content, use the propose_document_patch tool.
Always explain what you're doing before making changes.`;

let nextRunId = 1;

export class AgentRuntime {
  private modelProvider: ModelProvider;

  constructor(modelProvider: ModelProvider) {
    this.modelProvider = modelProvider;
  }

  async *run(request: RunRequest): AsyncIterable<AgentEvent> {
    const runId = request.runId ?? (nextRunId++).toString();
    const budget = { ...DEFAULT_BUDGET, ...request.budget };

    yield { type: 'run_started', runId };

    const ctx: ToolExecutionContext = {
      userId: request.context.userId,
      runId,
      kbId: request.context.kbId,
      documentId: request.context.documentId,
      documentVersion: request.context.documentVersion,
      effectiveRole: request.context.effectiveRole,
      signal: AbortSignal.timeout(budget.runTimeoutMs),
    };

    const toolSchemas = request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    const messages: Message[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: this.buildUserMessage(request) },
    ];

    let step = 0;
    let toolCalls = 0;

    try {
      while (step < budget.maxSteps && toolCalls < budget.maxToolCalls) {
        if (ctx.signal.aborted) {
          yield { type: 'run_completed', runId, reason: 'cancelled', steps: step };
          return;
        }

        const response = await this.modelProvider.stream({
          messages,
          tools: toolSchemas,
          maxTokens: budget.maxOutputTokens,
          signal: ctx.signal,
        });

        let hasToolCall = false;
        const pendingToolArgs = new Map<string, unknown>();

        for await (const event of response) {
          if (ctx.signal.aborted) {
            yield { type: 'run_completed', runId, reason: 'cancelled', steps: step };
            return;
          }

          switch (event.type) {
            case 'token':
              yield { type: 'token', runId, text: event.text, step };
              break;

            case 'tool_call_start':
              hasToolCall = true;
              pendingToolArgs.set(event.toolCallId, event.args);
              yield {
                type: 'tool_call_start',
                runId,
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                args: event.args,
                step,
              };
              break;

            case 'tool_call_end': {
              const tool = request.tools.find((t) => t.name === event.toolName);
              if (!tool) {
                yield {
                  type: 'tool_error',
                  runId,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  error: `Unknown tool: ${event.toolName}`,
                  step,
                };
                messages.push({
                  role: 'tool',
                  content: `Error: Unknown tool ${event.toolName}`,
                  toolCallId: event.toolCallId,
                });
                break;
              }

              const args = pendingToolArgs.get(event.toolCallId) || {};

              try {
                const result = await tool.execute(ctx, args as Record<string, unknown>);
                toolCalls++;
                yield {
                  type: 'tool_call_end',
                  runId,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  result,
                  step,
                };
                messages.push({
                  role: 'tool',
                  content: JSON.stringify(result),
                  toolCallId: event.toolCallId,
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Tool execution failed';
                yield {
                  type: 'tool_error',
                  runId,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  error: msg,
                  step,
                };
                messages.push({
                  role: 'tool',
                  content: `Error: ${msg}`,
                  toolCallId: event.toolCallId,
                });
              }
              break;
            }

            case 'tool_error':
              yield {
                type: 'tool_error',
                runId,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                error: event.error,
                step,
              };
              messages.push({
                role: 'tool',
                content: `Error: ${event.error}`,
                toolCallId: event.toolCallId,
              });
              break;

            case 'final_answer':
              yield { type: 'final_answer', runId, text: event.text, steps: step };
              yield { type: 'run_completed', runId, reason: 'final_answer', steps: step };
              return;

            case 'error':
              yield {
                type: 'run_completed',
                runId,
                reason: 'error',
                steps: step,
                error: event.message,
              };
              return;
          }
        }

        // If the model returned tool calls but its final turn didn't end
        // with a final_answer, we need to add an assistant message and loop.
        if (hasToolCall) {
          messages.push({
            role: 'assistant',
            content: '',
            toolCalls: [], // The model events carried the calls inline
          });
        }

        step++;
      }

      if (step >= budget.maxSteps || toolCalls >= budget.maxToolCalls) {
        yield { type: 'run_completed', runId, reason: 'budget_exhausted', steps: step };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Runtime error';
      yield { type: 'run_completed', runId, reason: 'error', steps: step, error: msg };
    }
  }

  private buildUserMessage(request: RunRequest): string {
    const ctx = request.context;
    const parts: string[] = [request.userMessage];

    if (ctx.documentTitle) {
      parts.push('', `Current document: ${ctx.documentTitle}`);
    }
    if (ctx.documentContent) {
      parts.push('', `Document content:\n\`\`\`\n${ctx.documentContent}\n\`\`\``);
    }
    if (ctx.selection) {
      parts.push(
        '',
        `User selected text (from character ${ctx.selection.from} to ${ctx.selection.to}):`,
        `"${ctx.selection.text}"`
      );
    }

    return parts.join('\n');
  }
}
