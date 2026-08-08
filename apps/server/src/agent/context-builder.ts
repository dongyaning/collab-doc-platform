import { Injectable, Inject } from '@nestjs/common';
import { NodesService } from '../nodes/nodes.service.js';
import type { RunContext } from '@wiseflow/mini-agent';

export interface ContextInput {
  userId: string;
  kbId: string;
  nodeId?: string;
  selection?: {
    fromRelPos?: unknown;
    toRelPos?: unknown;
    content: string;
  };
}

@Injectable()
export class ContextBuilder {
  constructor(@Inject(NodesService) private readonly nodes: NodesService) {}

  async build(input: ContextInput): Promise<RunContext> {
    const context: RunContext = {
      userId: input.userId,
      kbId: input.kbId,
      documentId: input.nodeId,
      effectiveRole: 'VIEWER',
    };

    if (input.nodeId) {
      const doc = await this.nodes.get(input.userId, input.nodeId);
      context.documentTitle = doc.title;
      context.documentVersion = doc.version;
      context.effectiveRole = doc.role;

      const content = await this.nodes.getContent(input.userId, input.nodeId);
      if (typeof content === 'string') {
        context.documentContent = content;
      } else if (content && typeof content === 'object') {
        context.documentContent = JSON.stringify(content as Record<string, unknown>);
      }
    }

    if (input.selection) {
      context.selection = input.selection;
    }

    return context;
  }
}
