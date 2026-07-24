export interface AgentSelection {
  from: number;
  to: number;
  text: string;
}

export interface AgentPatch {
  type: 'replace';
  from: number;
  to: number;
  newText: string;
}

export interface AgentProposal {
  proposalId: string;
  runId: string;
  nodeId: string;
  baseVersion: number;
  patch: AgentPatch;
}

export type AgentEvent =
  | { type: 'run_started'; runId: string }
  | { type: 'preparing_context'; runId: string }
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
  nodeId: string;
  nodeBaseVersion: number;
  selection: AgentSelection;
}
