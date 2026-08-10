/**
 * @wiseflow/mini-agent — Agent Runtime.
 */
export const AGENT_VERSION = '0.1.0';

// Types
export type {
  RiskLevel,
  JsonSchema,
  AgentTool,
  ToolExecutionContext,
  ToolSchema,
  Message,
  MessageRole,
  ToolCall,
  ModelRequest,
  ModelEvent,
  ModelProvider,
  RunBudget,
  RunContext,
  RunRequest,
  AgentEvent,
  RunResult,
} from './types.js';

// Runtime
export { AgentRuntime } from './agent-runtime.js';

// Providers
export { MockModelProvider } from './mock-provider.js';
export { OpenAICompatibleModelProvider } from './openai-compatible-provider.js';
export type { OpenAICompatibleConfig } from './openai-compatible-provider.js';
