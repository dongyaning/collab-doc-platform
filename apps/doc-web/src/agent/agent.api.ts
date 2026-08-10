import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth.store';
import type { AgentEvent, ConversationSummary, StartAgentRunInput } from './agent.types';

/** A stored agent run used to rebuild conversation history. */
export interface RunRecord {
  id: string;
  status: string;
  message: string;
  finalAnswer: string | null;
  error: string | null;
  createdAt: string;
  proposals: Array<{
    id: string;
    status: string;
    patch: unknown;
    nodeId: string;
    baseVersion: number;
    expiresAt: string | null;
  }>;
}

async function parseSse(response: Response, onEvent: (event: AgentEvent) => void): Promise<void> {
  if (!response.ok) {
    throw new Error(`Agent request failed with status ${response.status}`);
  }
  if (!response.body) {
    throw new Error('Agent response did not include a stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');

      if (data) {
        onEvent(JSON.parse(data) as AgentEvent);
      }
      boundary = buffer.indexOf('\n\n');
    }

    if (done) {
      break;
    }
  }
}

export const agentApi = {
  run: async (
    input: StartAgentRunInput,
    onEvent: (event: AgentEvent) => void,
    signal?: AbortSignal
  ) => {
    const token = useAuthStore.getState().token;
    const response = await fetch(
      `/api/agent/conversations/${encodeURIComponent(input.conversationId)}/runs`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: input.message,
          kbId: input.kbId,
          nodeId: input.nodeId,
          nodeBaseVersion: input.nodeBaseVersion,
          selection: input.selection,
        }),
        signal,
      }
    );

    await parseSse(response, onEvent);
  },

  confirmProposal: (proposalId: string) =>
    api
      .post<{ status: 'APPLYING' }>(`/agent/proposals/${proposalId}/confirm`)
      .then((response) => response.data),

  acknowledgeApplied: (proposalId: string) =>
    api
      .post<{ status: 'APPLIED' }>(`/agent/proposals/${proposalId}/applied`)
      .then((response) => response.data),

  rejectProposal: (proposalId: string) =>
    api
      .post<{ status: 'REJECTED' }>(`/agent/proposals/${proposalId}/reject`)
      .then((response) => response.data),

  markProposalStale: (proposalId: string) =>
    api
      .post<{ status: 'STALE' }>(`/agent/proposals/${proposalId}/stale`)
      .then((response) => response.data),

  listConversations: (kbId: string) =>
    api
      .get<ConversationSummary[]>('/agent/conversations', { params: { kbId } })
      .then((response) => response.data),

  createConversation: (kbId: string) =>
    api
      .post<ConversationSummary>('/agent/conversations', { kbId })
      .then((response) => response.data),

  listRuns: (conversationId: string) =>
    api
      .get<RunRecord[]>(`/agent/conversations/${encodeURIComponent(conversationId)}/runs`)
      .then((response) => response.data),
};
