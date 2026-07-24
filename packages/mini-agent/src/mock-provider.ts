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
    const hasSelection =
      userText.includes('选') ||
      userText.includes('选区') ||
      userText.includes('改写') ||
      userText.includes('润色') ||
      userText.includes('修改');
    const hasProposeTool = request.tools.some(
      (t: ToolSchema) => t.name === 'propose_document_patch'
    );

    if (hasSelection && hasProposeTool) {
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

      // extract from/to from the user message if available
      const range = this.extractSelectionRange(userText);
      const toolCallId = 'mock_tc_1';

      yield {
        type: 'tool_call_start',
        toolName: 'propose_document_patch',
        toolCallId,
        args: {
          from: range.from,
          to: range.to,
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
            type: 'replace',
            from: range.from,
            to: range.to,
            newText: '这段内容已被 Agent 改写为更专业的表述。',
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

  private extractSelectionRange(text: string): { from: number; to: number } {
    // Try to parse "from X to Y" or "character X to Y" from the user message
    const match = text.match(/character\s+(\d+)\s+to\s+(\d+)/i);
    if (match) {
      return { from: parseInt(match[1], 10), to: parseInt(match[2], 10) };
    }
    return { from: 0, to: 10 }; // fallback
  }
}
