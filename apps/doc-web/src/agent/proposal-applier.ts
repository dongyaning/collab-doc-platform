import type { Editor } from '@tiptap/react';
import type { AgentProposal, AgentSelection } from './agent.types';

export class StaleAgentProposalError extends Error {
  constructor(message = 'The selected content changed. Generate a new proposal.') {
    super(message);
    this.name = 'StaleAgentProposalError';
  }
}

export function applyAgentProposal(
  editor: Editor,
  proposal: AgentProposal,
  selection: AgentSelection,
  currentVersion: number
): void {
  if (proposal.nodeId === '' || proposal.baseVersion !== currentVersion) {
    throw new StaleAgentProposalError('The document version changed. Generate a new proposal.');
  }

  const { from, to, newText } = proposal.patch;
  if (from !== selection.from || to !== selection.to) {
    throw new StaleAgentProposalError();
  }

  const currentText = editor.state.doc.textBetween(from, to, '\n');
  if (currentText !== selection.text) {
    throw new StaleAgentProposalError();
  }

  const applied = editor.chain().focus().insertContentAt({ from, to }, newText).run();

  if (!applied) {
    throw new Error('The editor could not apply the Agent proposal.');
  }
}
