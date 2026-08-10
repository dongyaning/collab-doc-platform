/**
 * @wiseflow/mini-agent — core type definitions.
 *
 * These types are the contract between the generic Agent Runtime
 * and any application that wires it up (e.g. WiseFlow server).
 */

// ---------------------------------------------------------------------------
// Tool Contract
// ---------------------------------------------------------------------------

export type RiskLevel = 'read' | 'write_proposal' | 'write_confirm' | 'high_risk';

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
  enum?: string[];
  items?: JsonSchema;
}

export interface ToolExecutionContext {
  userId: string;
  runId: string;
  kbId: string;
  documentId?: string;
  documentVersion?: number;
  effectiveRole: string;
  signal: AbortSignal;
}

export interface AgentTool<TInput = unknown, TResult = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  riskLevel: RiskLevel;
  execute(context: ToolExecutionContext, input: TInput): Promise<TResult>;
}

// ---------------------------------------------------------------------------
// Model Provider
// ---------------------------------------------------------------------------

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ModelRequest {
  messages: Message[];
  tools: ToolSchema[];
  maxTokens: number;
  signal?: AbortSignal;
}

/** 非流式补全请求，用于滚动摘要等一次性文本生成。 */
export interface CompleteRequest {
  messages: Message[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export type ModelEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call_start'; toolName: string; toolCallId: string; args: unknown }
  | { type: 'tool_call_end'; toolCallId: string; toolName: string; result: unknown }
  | { type: 'tool_error'; toolCallId: string; toolName: string; error: string }
  | { type: 'final_answer'; text: string }
  | { type: 'error'; message: string };

export interface ModelProvider {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
  /** 非流式补全，用于滚动摘要等一次性文本生成。实现方可选。 */
  complete?(request: CompleteRequest): Promise<string>;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  /** 内部消息（如滚动摘要），仅 server/mini-agent 侧注解，不用于前端展示。 */
  internal?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Agent Runtime
// ---------------------------------------------------------------------------

export interface RunBudget {
  maxSteps: number;
  maxToolCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  toolTimeoutMs: number;
  runTimeoutMs: number;
}

export interface RunContext {
  userId: string;
  kbId: string;
  documentId?: string;
  documentVersion?: number;
  effectiveRole: string;
  documentTitle?: string;
  documentContent?: string;
  selection?: {
    fromRelPos?: unknown;
    toRelPos?: unknown;
    content: string;
  };
  extraContext?: Record<string, unknown>;
}

export interface RunRequest {
  runId?: string;
  conversationId: string;
  userMessage: string;
  context: RunContext;
  tools: AgentTool[];
  budget?: Partial<RunBudget>;
  /** 历史对话消息（含内部摘要），位于系统提示词与当前用户消息之间。 */
  history?: Message[];
  /** 追加到系统提示词末尾的应用特定指令（如组件生成规范），由宿主注入，保持运行时通用。 */
  systemPromptAppend?: string;
}

// ---------------------------------------------------------------------------
// Runtime Events (emitted by the Agent Runtime)
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { type: 'run_started'; runId: string }
  | { type: 'token'; runId: string; text: string; step: number }
  | {
      type: 'tool_call_start';
      runId: string;
      toolName: string;
      toolCallId: string;
      args: unknown;
      step: number;
    }
  | {
      type: 'tool_call_end';
      runId: string;
      toolCallId: string;
      toolName: string;
      result: unknown;
      step: number;
    }
  | {
      type: 'tool_error';
      runId: string;
      toolCallId: string;
      toolName: string;
      error: string;
      step: number;
    }
  | { type: 'final_answer'; runId: string; text: string; steps: number }
  | {
      type: 'run_completed';
      runId: string;
      reason: 'final_answer' | 'cancelled' | 'budget_exhausted' | 'error';
      steps: number;
      error?: string;
    };

// ---------------------------------------------------------------------------
// Run Result (final summary after the async generator completes)
// ---------------------------------------------------------------------------

export interface RunResult {
  runId: string;
  status: 'completed' | 'cancelled' | 'budget_exhausted' | 'error';
  finalAnswer: string | null;
  steps: number;
  toolCalls: number;
  error: string | null;
}
