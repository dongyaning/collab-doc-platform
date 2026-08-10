import { Injectable, Inject } from '@nestjs/common';
import { NodesService } from '../nodes/nodes.service.js';
import { PrismaService } from '../prisma/prisma.module.js';
import type { RunContext } from '@wiseflow/mini-agent';
import { applyEditsToJson, type JsonEdit } from './widgets/apply-edits-json.js';

export interface ContextInput {
  userId: string;
  kbId: string;
  nodeId?: string;
  conversationId?: string;
  selection?: {
    fromRelPos?: unknown;
    toRelPos?: unknown;
    content: string;
  };
}

@Injectable()
export class ContextBuilder {
  constructor(
    @Inject(NodesService) private readonly nodes: NodesService,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  async build(input: ContextInput): Promise<RunContext> {
    const context: RunContext = {
      userId: input.userId,
      kbId: input.kbId,
      documentId: input.nodeId,
      effectiveRole: 'VIEWER',
    };

    let contentJson: unknown = null;

    if (input.nodeId) {
      const doc = await this.nodes.get(input.userId, input.nodeId);
      context.documentTitle = doc.title;
      context.documentVersion = doc.version;
      context.effectiveRole = doc.role;

      const content = await this.nodes.getContent(input.userId, input.nodeId);
      if (typeof content === 'string') {
        context.documentContent = content;
      } else if (content && typeof content === 'object') {
        contentJson = content;
        context.documentContent = JSON.stringify(content as Record<string, unknown>);
      }
    }

    // 迭代修改：聚合该 conversation 下未确认（PENDING 未过期）的 proposals，
    // 把 edits 应用生成"预览文档"注入，LLM 基于当前修改继续生成新 patch。
    if (input.conversationId && input.nodeId && contentJson) {
      try {
        const pending = await this.prisma.agentProposal.findMany({
          where: {
            nodeId: input.nodeId,
            status: 'PENDING',
            expiresAt: { gt: new Date() },
            run: { conversationId: input.conversationId },
          },
          orderBy: { createdAt: 'asc' },
        });

        if (pending.length > 0) {
          const edits: JsonEdit[] = pending.flatMap(
            (p) => ((p.patch as { edits?: JsonEdit[] })?.edits ?? []) as JsonEdit[]
          );
          if (edits.length > 0) {
            const preview = applyEditsToJson(contentJson as never, edits);
            context.documentContent = JSON.stringify(preview.doc);
            context.extraContext = {
              pendingChangeCount: pending.length,
            };
          }
        }
      } catch {
        // 聚合失败不阻塞 run，退回原始文档内容
      }
    }

    if (input.selection) {
      context.selection = input.selection;
    }

    return context;
  }
}
