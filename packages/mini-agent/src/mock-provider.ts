import type { ModelEvent, ModelProvider, ModelRequest, ToolSchema } from './types.js';

/**
 * MockModelProvider — hardcoded responses for development and testing.
 *
 * When the request mentions "propose_document_patch" (or talks about
 * rewrites / selections), it yields a mock tool_call with a fake patch.
 * Otherwise it yields a plain final_answer.
 *
 * This lets us test the full Agent Runtime loop without a real LLM.
 */
export class MockModelProvider implements ModelProvider {
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const userText = this.getUserText(request);
    const hasSelectionContext = userText.includes('User selected text:');
    const hasRewriteIntent =
      userText.includes('改写') ||
      userText.includes('润色') ||
      userText.includes('修改') ||
      userText.includes('改得');
    const hasProposeTool = request.tools.some(
      (t: ToolSchema) => t.name === 'propose_document_patch'
    );

    if ((hasSelectionContext || hasRewriteIntent) && hasProposeTool) {
      // Simulate the model proposing a patch
      yield { type: 'token', text: '好的' };
      yield { type: 'token', text: '，' };
      yield { type: 'token', text: '我' };
      yield { type: 'token', text: '来' };
      yield { type: 'token', text: '帮' };
      yield { type: 'token', text: '你' };
      yield { type: 'token', text: '改写' };
      yield { type: 'token', text: '这' };
      yield { type: 'token', text: '段' };
      yield { type: 'token', text: '文字' };
      yield { type: 'token', text: '。' };

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
    } else {
      // Simple Q&A — no tool call
      yield { type: 'token', text: '这' };
      yield { type: 'token', text: '是' };
      yield { type: 'token', text: '一' };
      yield { type: 'token', text: '个' };
      yield { type: 'token', text: '模' };
      yield { type: 'token', text: '拟' };
      yield { type: 'token', text: '回' };
      yield { type: 'token', text: '答' };
      yield { type: 'token', text: '。' };
      yield { type: 'final_answer', text: '这是一个模拟回答。Mini Agent Runtime 正在运行中。' };
    }
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
}
