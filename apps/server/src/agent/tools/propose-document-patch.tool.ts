import type { AgentTool, ToolExecutionContext } from '@wiseflow/mini-agent';
import { AgentService } from '../agent.service.js';

/**
 * Propose a document content patch.
 *
 * This tool does NOT modify the Yjs document directly. Instead it
 * saves a structured proposal to the AgentProposal table. The user
 * must review the diff preview in the UI and explicitly confirm
 * before the patch is applied.
 */
export function createProposeDocumentPatchTool(
  agentService: AgentService
): AgentTool<ProposePatchInput, ProposePatchResult> {
  return {
    name: 'propose_document_patch',
    description:
      'Propose a replacement for a range of text in the current document. ' +
      'The proposal will be shown to the user as a diff, and they must confirm before it is applied. ' +
      'Use "from" and "to" TipTap document positions to specify the range, and "newText" for the replacement.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'number', description: 'Starting TipTap document position' },
        to: { type: 'number', description: 'Ending TipTap document position' },
        newText: { type: 'string', description: 'The replacement text' },
      },
      required: ['from', 'to', 'newText'],
    },
    riskLevel: 'write_proposal',

    async execute(
      ctx: ToolExecutionContext,
      input: ProposePatchInput
    ): Promise<ProposePatchResult> {
      if (!ctx.documentId) {
        throw new Error('No document context available for patch proposal');
      }

      const patch = {
        type: 'replace',
        from: input.from,
        to: input.to,
        newText: input.newText,
      };

      const affectedRange = {
        from: input.from,
        to: input.to,
      };

      const proposal = await agentService.createProposal({
        runId: ctx.runId,
        nodeId: ctx.documentId,
        baseVersion: ctx.documentVersion ?? 0,
        patch,
        affectedRange,
      });

      return {
        proposalId: proposal.id,
        type: 'replace',
        from: input.from,
        to: input.to,
        newText: input.newText,
      };
    },
  };
}

interface ProposePatchInput {
  from: number;
  to: number;
  newText: string;
}

interface ProposePatchResult {
  proposalId: string;
  type: string;
  from: number;
  to: number;
  newText: string;
}
