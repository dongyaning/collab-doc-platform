import type { AgentTool, ToolExecutionContext } from '@wiseflow/mini-agent';
import { AgentService } from '../agent.service.js';
import { AgentWidgetService } from '../widgets/agent-widget.service.js';
import { compileWidget, compileErrorOf } from '../widgets/compile-widget.js';

/**
 * 插入一个 React 组件到文档。
 *
 * 两种模式：
 * 1. 复用已有组件：widgetType 来自组件目录，不提供 sourceCode，只填 props，无编译无新代码。
 * 2. 生成新组件：提供单文件 TSX（仅 React 内置 API），服务端 esbuild 编译为自包含 ESM
 *    （bundle React），gzip 后入库；编译失败返回结构化错误供 Agent 重试。
 *
 * 与 propose_document_patch 一致：不直接修改文档，写入 AgentProposal 供用户评审确认。
 */
export function createProposeWidgetTool(
  agentService: AgentService,
  widgetService: AgentWidgetService
): AgentTool<ProposeWidgetInput, ProposeWidgetResult> {
  return {
    name: 'propose_widget',
    description:
      '插入一个 React 组件到文档。两种模式：1. 复用已有组件（组件目录中的 widgetType，不提供 ' +
      'sourceCode，只填 props）；2. 生成新组件（提供 sourceCode，单文件 TSX 默认导出，仅使用 ' +
      'React 内置 API，状态必须经 updateProps 回写，props 必须 JSON 可序列化）。',
    inputSchema: {
      type: 'object',
      properties: {
        widgetType: {
          type: 'string',
          description: '组件身份标识，格式 w_<随机后缀>；复用模式填组件目录中的已有 widgetType',
        },
        title: { type: 'string', description: '组件展示名（生成模式必填）' },
        sourceCode: {
          type: 'string',
          description: '单文件 TSX 源码，默认导出组件（生成模式必填，复用模式省略）',
        },
        props: { type: 'object', description: '初始 props，JSON 可序列化' },
        insertAfter: { type: 'string', description: '插入位置锚点文本，组件插入到该文本之后' },
      },
      required: ['widgetType', 'props', 'insertAfter'],
    },
    riskLevel: 'write_proposal',

    async execute(
      ctx: ToolExecutionContext,
      input: ProposeWidgetInput
    ): Promise<ProposeWidgetResult> {
      if (!ctx.documentId) {
        throw new Error('No document context available for widget proposal');
      }
      if (!input.widgetType || typeof input.widgetType !== 'string') {
        throw new Error('widgetType is required');
      }
      if (typeof input.insertAfter !== 'string' || !input.insertAfter) {
        throw new Error('insertAfter anchor text is required');
      }
      const props = input.props && typeof input.props === 'object' ? input.props : {};

      let title = input.title ?? '';
      let sourceCode: string | undefined = input.sourceCode;

      if (sourceCode && typeof sourceCode === 'string' && sourceCode.trim().length > 0) {
        // 生成模式：编译校验 + 落库 DRAFT
        let jsCodeGzip: Uint8Array;
        try {
          const compiled = await compileWidget(sourceCode);
          jsCodeGzip = compiled.jsCodeGzip;
        } catch (err) {
          const detail = compileErrorOf(err);
          throw new Error(
            `Widget source code failed to compile:\n${detail.message}\n\n` +
              'Please fix the TSX syntax and retry. Keep the component simple ' +
              '(under ~40 lines) and avoid complex SVG or inline styles with many properties.'
          );
        }
        if (!title) {
          throw new Error('title is required when generating a new widget');
        }
        await widgetService.createComponent({
          widgetType: input.widgetType,
          kbId: ctx.kbId,
          title,
          sourceCode,
          jsCodeGzip,
          propsSchema: undefined,
        });
      } else {
        // 复用模式：校验目录中存在且 ACTIVE，title 由服务端回填
        const existing = await widgetService.findActiveForReuse(input.widgetType, ctx.kbId);
        if (!existing) {
          throw new Error(
            `Widget ${input.widgetType} does not exist or is not active in this knowledge base. ` +
              'Use the component catalog or generate a new widget instead.'
          );
        }
        title = existing.title;
        sourceCode = undefined;
      }

      const proposal = await agentService.createProposal({
        runId: ctx.runId,
        nodeId: ctx.documentId,
        baseVersion: ctx.documentVersion ?? 0,
        patch: {
          edits: [
            {
              kind: 'widget',
              widgetType: input.widgetType,
              title,
              props,
              insertAfter: input.insertAfter,
            },
          ],
        },
      });

      return {
        proposalId: proposal.id,
        widgetType: input.widgetType,
        title,
        mode: sourceCode ? 'generated' : 'reused',
      };
    },
  };
}

interface ProposeWidgetInput {
  widgetType: string;
  title?: string;
  sourceCode?: string;
  props?: Record<string, unknown>;
  insertAfter: string;
}

interface ProposeWidgetResult {
  proposalId: string;
  widgetType: string;
  title: string;
  mode: 'generated' | 'reused';
}
