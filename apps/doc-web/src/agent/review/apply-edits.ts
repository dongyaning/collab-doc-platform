import type { Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import type { AgentEdit } from '../agent.types';
import { findUniqueTextRange } from '../proposal-applier';
import { reviewAddMarkName } from './review-highlight-extension';
import type { ReviewEditInfo } from './review-highlight-extension';

export interface ReviewApplyResult {
  /** 重新生成 Preview 所需的编辑序列（增量更新时替换整个序列）。 */
  editInfos: ReviewEditInfo[];
}

/**
 * 在 Preview 编辑器上应用 edits 生成"变更后"文档。
 *
 * - 文本替换：baseContent 唯一匹配后替换为 newText，并给新增文本包裹 reviewAdd mark。
 * - widget 插入：在 insertAfter 锚点后插入占位段落 "[widget: title]"（评审期不加载真实组件），
 *   同样包裹 reviewAdd mark，确认时用 edit 记录的 widgetType/props 插入真实节点。
 * - 位置记录在 editInfos 中，供 decorations 与确认提取使用。
 */
export function applyEditsToPreview(
  previewEditor: Editor,
  baseJson: JSONContent,
  edits: Array<AgentEdit & { editId: string }>
): ReviewEditInfo[] {
  previewEditor.commands.setContent(baseJson);

  const editInfos: ReviewEditInfo[] = [];
  for (const edit of edits) {
    if (edit.kind === 'widget') {
      const anchor = findUniqueTextRange(previewEditor, edit.insertAfter);
      if (!anchor) {
        editInfos.push({
          editId: edit.editId,
          kind: 'widget',
          status: 'not_found',
          baseContent: edit.insertAfter,
          from: 0,
          to: 0,
        });
        continue;
      }
      const placeholder = `[widget: ${edit.title}]`;
      previewEditor.chain().focus().insertContentAt(anchor.to, placeholder).run();
      const from = anchor.to;
      const to = from + placeholder.length;
      previewEditor.chain().setTextSelection({ from, to }).setReviewAddMark(edit.editId).run();
      editInfos.push({
        editId: edit.editId,
        kind: 'widget',
        status: 'ok',
        baseContent: edit.insertAfter,
        from,
        to,
      });
      continue;
    }

    const range = findUniqueTextRange(previewEditor, edit.baseContent);
    if (!range) {
      editInfos.push({
        editId: edit.editId,
        kind: 'text',
        status: 'not_found',
        baseContent: edit.baseContent,
        from: 0,
        to: 0,
      });
      continue;
    }
    previewEditor
      .chain()
      .focus()
      .insertContentAt({ from: range.from, to: range.to }, edit.newText)
      .run();
    const from = range.from;
    const to = from + edit.newText.length;
    previewEditor.chain().setTextSelection({ from, to }).setReviewAddMark(edit.editId).run();
    editInfos.push({
      editId: edit.editId,
      kind: 'text',
      status: 'ok',
      baseContent: edit.baseContent,
      from,
      to,
    });
  }

  // 高亮扩展按最新 edits 重算 decorations
  const extension = previewEditor.extensionManager.extensions.find(
    (item) => item.name === 'reviewHighlight'
  );
  if (extension) {
    extension.options.edits = editInfos;
  }
  // 触发一次空事务让 decorations / editable 按最新 edits 重算
  previewEditor.view.dispatch(previewEditor.state.tr);
  return editInfos;
}

/** 提取 reviewAdd mark 当前文本（用户可能已微调；整段删空后重打的文本不带 mark，需兜底）。 */
export function extractEditText(editor: Editor, editId: string): string | null {
  let text = '';
  let foundMark = false;
  editor.state.doc.descendants((node) => {
    if (!node.isText || !node.text) {
      return true;
    }
    const mark = node.marks.find(
      (m) => m.type.name === reviewAddMarkName && m.attrs.editId === editId
    );
    if (mark) {
      foundMark = true;
      text += node.text;
    }
    return true;
  });
  if (!foundMark) {
    return null;
  }
  return text;
}
