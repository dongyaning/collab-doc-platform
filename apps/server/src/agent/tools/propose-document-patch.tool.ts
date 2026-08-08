import type { AgentTool, ToolExecutionContext } from '@wiseflow/mini-agent';
import { AgentService } from '../agent.service.js';

/**
 * Propose a document content patch.
 *
 * This tool does NOT modify the Yjs document directly. Instead it
 * saves a structured proposal to the AgentProposal table. The user
 * must review the diff preview in the UI and explicitly confirm
 * before the patch is applied.
 *
 * The edit is described by content anchors (baseContent + newText):
 * the Agent side has no Y.Doc and cannot generate Yjs relative
 * positions, so the frontend resolves the baseContent to a position
 * at apply time (unique match required).
 */
export function createProposeDocumentPatchTool(
  agentService: AgentService
): AgentTool<ProposePatchInput, ProposePatchResult> {
  return {
    name: 'propose_document_patch',
    description:
      'Propose a replacement for a range of text in the current document. ' +
      'The proposal will be shown to the user as a diff, and they must confirm before it is applied. ' +
      'Use "baseContent" (the exact original text to replace) and "newText" (the replacement).',
    inputSchema: {
      type: 'object',
      properties: {
        baseContent: {
          type: 'string',
          description: 'The exact original text to replace (must match the document byte-for-byte)',
        },
        newText: { type: 'string', description: 'The replacement text' },
      },
      required: ['baseContent', 'newText'],
    },
    riskLevel: 'write_proposal',

    async execute(
      ctx: ToolExecutionContext,
      input: ProposePatchInput
    ): Promise<ProposePatchResult> {
      if (!ctx.documentId) {
        throw new Error('No document context available for patch proposal');
      }

      const edits = [
        {
          baseContent: input.baseContent,
          newText: input.newText,
        },
      ];

      const proposal = await agentService.createProposal({
        runId: ctx.runId,
        nodeId: ctx.documentId,
        baseVersion: ctx.documentVersion ?? 0,
        patch: { edits },
      });

      return {
        proposalId: proposal.id,
        edits,
      };
    },
  };
}

interface ProposePatchInput {
  baseContent: string;
  newText: string;
}

interface ProposePatchResult {
  proposalId: string;
  edits: Array<{
    baseContent: string;
    newText: string;
  }>;
}
