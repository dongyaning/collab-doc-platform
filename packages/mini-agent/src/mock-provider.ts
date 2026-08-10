import type {
  CompleteRequest,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  ToolSchema,
} from './types.js';

/**
 * MockModelProvider — hardcoded responses for development and testing.
 *
 * The rewrite branch (propose_document_patch tool call) only triggers when
 * the user message carries a selection context ("User selected text:"),
 * because a rewrite patch without a selection anchor is not applicable.
 * Plain questions and rewrite intent without a selection go to the Q&A branch.
 *
 * Token events are emitted one character at a time with a configurable
 * delay, simulating the typewriter rhythm of a real LLM stream.
 */
export class MockModelProvider implements ModelProvider {
  constructor(private readonly tokenDelayMs = 30) {}

  async complete(_request: CompleteRequest): Promise<string> {
    return '这是对早期历史对话的模拟摘要，保留关键主题与已完成的决策。';
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const userText = this.getUserText(request);
    const hasSelectionContext = userText.includes('User selected text:');
    const hasProposeTool = request.tools.some(
      (t: ToolSchema) => t.name === 'propose_document_patch'
    );
    const hasWidgetTool = request.tools.some((t: ToolSchema) => t.name === 'propose_widget');

    if (hasSelectionContext && hasProposeTool) {
      // Simulate the model proposing a patch
      for (const ch of '好的，我来帮你改这段文字。') {
        yield { type: 'token', text: ch };
        if (await this.tick(request.signal)) {
          return;
        }
      }

      const baseContent = this.extractSelectionContent(userText);
      const toolCallId = 'mock_tc_1';

      yield {
        type: 'tool_call_start',
        toolName: 'propose_document_patch',
        toolCallId,
        args: {
          baseContent,
          newText: '这段内容已被 Agent 改写为更专业的表述。',
        },
      };

      // Immediately finish the tool call with a fake result
      yield {
        type: 'tool_call_end',
        toolCallId,
        toolName: 'propose_document_patch',
        result: {
          patch: {
            edits: [
              {
                baseContent,
                newText: '这段内容已被 Agent 改写为更专业的表述。',
              },
            ],
          },
        },
      };

      yield { type: 'token', text: '' };
      yield {
        type: 'final_answer',
        text: '已将选定文本改写为更专业的表述，请查看 Diff 预览并确认是否应用。',
      };
    } else if (hasWidgetTool && userText.includes('组件')) {
      // Simulate the model generating a widget component.
      // Trigger: user message contains "组件" and propose_widget is available.
      const anchor = this.extractAnchorText(userText);
      const sourceCode = [
        `export default function DemoCard(props: any) {`,
        `  const p = props.props ?? {};`,
        `  return React.createElement('div', { style: { border: '1px solid #e5e6eb', borderRadius: 8, padding: '16px' } },`,
        `    React.createElement('div', { style: { fontWeight: 600, marginBottom: 8 } }, String(p.title ?? '未命名')),`,
        `    React.createElement('div', { style: { fontSize: 28, color: '#1677ff' } }, String(p.value ?? 0)),`,
        `  );`,
        `}`,
      ].join('\n');

      for (const ch of '好的，我来生成一个自定义组件。') {
        yield { type: 'token', text: ch };
        if (await this.tick(request.signal)) {
          return;
        }
      }

      const toolCallId = 'mock_widget_1';
      yield {
        type: 'tool_call_start',
        toolName: 'propose_widget',
        toolCallId,
        args: {
          widgetType: 'w_mock_demo',
          title: '数据卡片',
          sourceCode,
          props: { title: '目标进度', value: 86 },
          insertAfter: anchor,
        },
      };
      yield {
        type: 'tool_call_end',
        toolCallId,
        toolName: 'propose_widget',
        result: { proposalId: 'mock-proposal', widgetType: 'w_mock_demo', mode: 'generated' },
      };
      yield { type: 'token', text: '' };
      yield {
        type: 'final_answer',
        text: '已生成"数据卡片"组件并建议插入到文档中，请在文档内评审变更后确认。',
      };
    } else {
      // Simple Q&A — no tool call
      for (const ch of '这是一个模拟回答。') {
        yield { type: 'token', text: ch };
        if (await this.tick(request.signal)) {
          return;
        }
      }
      yield { type: 'final_answer', text: '这是一个模拟回答。Mini Agent Runtime 正在运行中。' };
    }
  }

  /**
   * Wait for one token interval. Returns true when the stream was aborted,
   * so the caller can stop yielding further events.
   */
  private async tick(signal?: AbortSignal): Promise<boolean> {
    if (this.tokenDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.tokenDelayMs));
    }
    return signal?.aborted ?? false;
  }

  private getUserText(request: ModelRequest): string {
    // Find the last user message
    for (let i = request.messages.length - 1; i >= 0; i--) {
      if (request.messages[i].role === 'user') {
        return request.messages[i].content;
      }
    }
    return '';
  }

  private extractSelectionContent(text: string): string {
    // Parse the selected text from the user message, anchored after the
    // "User selected text:" line so document JSON quotes are not matched:
    //   User selected text:
    //   "<selected content>"
    const marker = 'User selected text:';
    const markerIndex = text.lastIndexOf(marker);
    const fromIndex = markerIndex === -1 ? 0 : markerIndex + marker.length;
    const match = text.slice(fromIndex).match(/"([^"]*)"/);
    return match?.[1] ?? 'selected text';
  }

  /** 提取"在「XX」后插入组件"中的锚点文本，缺省用「组件」。 */
  private extractAnchorText(text: string): string {
    const match = text.match(/在「([^」]+)」后/);
    return match?.[1] ?? '组件';
  }
}
