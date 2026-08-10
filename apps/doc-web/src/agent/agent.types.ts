export interface AgentSelection {
  fromRelPos: unknown;
  toRelPos: unknown;
  content: string;
}

export interface AgentEdit {
  fromRelPos?: unknown;
  toRelPos?: unknown;
  baseContent: string;
  newText: string;
}

export interface AgentPatch {
  edits: AgentEdit[];
}

export interface AgentProposal {
  proposalId: string;
  runId: string;
  nodeId: string;
  baseVersion: number;
  patch: AgentPatch;
}

/** AgentEdit 增加 proposal 内稳定 id，用于列表 key（不依赖渲染 index）。 */
export interface ViewEdit extends AgentEdit {
  editId: string;
}

export interface ViewProposal extends Omit<AgentProposal, 'patch'> {
  patch: { edits: ViewEdit[] };
}

export type AgentEvent =
  | { type: 'run_started'; runId: string }
  | { type: 'preparing_context'; runId: string }
  | { type: 'summarizing'; runId: string }
  | { type: 'token'; runId: string; text: string; step: number }
  | { type: 'tool_call_start'; runId: string; toolName: string; toolCallId: string }
  | { type: 'tool_call_end'; runId: string; toolName: string; toolCallId: string }
  | { type: 'tool_error'; runId: string; toolName: string; error: string }
  | { type: 'final_answer'; runId: string; text: string; steps: number }
  | ({ type: 'proposal_ready' } & AgentProposal)
  | {
      type: 'run_completed';
      runId: string;
      reason: 'final_answer' | 'cancelled' | 'budget_exhausted' | 'error';
      error?: string;
    };

export interface StartAgentRunInput {
  conversationId: string;
  message: string;
  kbId: string;
  nodeId?: string;
  nodeBaseVersion?: number;
  selection?: AgentSelection;
}

export interface ConversationSummary {
  id: string;
  title: string;
  lastMessageAt: string | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'streaming' | 'done' | 'error';
  error?: string;
  proposal?: ViewProposal;
  /** 用户消息附带的选区上下文（仅展示用）。 */
  selectionContent?: string;
  /** 提案处理结果，存在则提案卡片只读。 */
  proposalOutcome?: 'applied' | 'rejected';
}
