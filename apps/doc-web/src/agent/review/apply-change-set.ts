import type { Editor } from '@tiptap/react';
import type { AgentEdit } from '../agent.types';
import { findUniqueTextRange } from '../proposal-applier';
import type { ConflictEdit } from '../proposal-applier';

export type ChangeSetItem = { proposalId: string; edits: Array<AgentEdit & { editId: string }> };

export type ChangeSetResult =
  | { status: 'applied' }
  | { status: 'conflict'; failures: ConflictEdit[] };

/**
 * 变更集折叠应用到主编辑器。
 *
 * 按到达顺序在"中间文档"上逐个定位（后续 edit 的锚点基于预览文档，
 * 在已应用前序 edit 的中间文档上匹配成立，前提是变更集内区域互不重叠）。
 * 文本替换内容取自 Preview 提取文本（用户微调生效），widget 插入真实节点。
 * 全部解析后按位置降序单事务应用。
 */
export function applyChangeSetToEditor(
  editor: Editor,
  changeSet: ChangeSetItem[],
  extractText: (editId: string) => string | null
): ChangeSetResult {
  const failures: ConflictEdit[] = [];
  const resolved: Array<{
    edit: AgentEdit & { editId: string };
    range: { from: number; to: number };
    content: string | { type: string; attrs?: Record<string, unknown> };
  }> = [];

  for (const item of changeSet) {
    for (const edit of item.edits) {
      if (edit.kind === 'widget') {
        const anchor = findUniqueTextRange(editor, edit.insertAfter);
        if (!anchor) {
          failures.push({ edit, reason: 'not_found' });
          continue;
        }
        resolved.push({
          edit,
          range: { from: anchor.to, to: anchor.to },
          content: { type: 'widget', attrs: { widgetType: edit.widgetType, props: edit.props } },
        });
        continue;
      }

      const range = findUniqueTextRange(editor, edit.baseContent);
      if (!range) {
        failures.push({ edit, reason: 'not_found' });
        continue;
      }
      const current = editor.state.doc.textBetween(range.from, range.to, '\n');
      if (current !== edit.baseContent) {
        failures.push({ edit, reason: 'modified' });
        continue;
      }
      const text = extractText(edit.editId) ?? edit.newText;
      resolved.push({ edit, range, content: text });
    }
  }

  if (failures.length > 0) {
    return { status: 'conflict', failures };
  }

  const ordered = [...resolved].sort((a, b) => b.range.from - a.range.from);
  const chain = editor.chain().focus();
  for (const item of ordered) {
    if (typeof item.content === 'string') {
      chain.insertContentAt({ from: item.range.from, to: item.range.to }, item.content);
    } else {
      chain.insertContentAt(item.range.to, item.content);
    }
  }
  chain.run();
  return { status: 'applied' };
}
