import type { Editor } from '@tiptap/react';
import { relativePositionToAbsolutePosition, ySyncPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import type { AgentEdit, AgentProposal } from './agent.types';

export type ConflictReason = 'not_found' | 'modified' | 'overlap';

export interface ConflictEdit {
  edit: AgentEdit;
  reason: ConflictReason;
}

export type ApplyResult = { status: 'applied' } | { status: 'conflict'; failures: ConflictEdit[] };

interface ResolvedEdit {
  edit: AgentEdit;
  range: { from: number; to: number };
}

function clampPos(editor: Editor, pos: number): number {
  return Math.min(pos, Math.max(editor.state.doc.content.size - 1, 0));
}

/**
 * Resolve an edit's anchor to a current document range.
 *
 * 前端锚点（fromRelPos/toRelPos）优先：经 ySyncPlugin 的实时 binding 解析，
 * 相对位置自动跟随其他协作者的并发修改。
 * 内容锚点（baseContent）：在最新文档中唯一匹配原文片段，匹配失败或不唯一返回 null。
 * widget edit：按 insertAfter 锚点文本定位，返回零宽插入点（range.to）。
 */
function resolveEditRange(editor: Editor, edit: AgentEdit): { from: number; to: number } | null {
  if (edit.kind === 'widget') {
    const anchor = findUniqueTextRange(editor, edit.insertAfter);
    if (!anchor) {
      return null;
    }
    return { from: anchor.to, to: anchor.to };
  }

  const hasAnchor = edit.fromRelPos !== undefined && edit.toRelPos !== undefined;

  if (hasAnchor) {
    const ystate = ySyncPluginKey.getState(editor.state);
    if (!ystate?.doc || !ystate?.type || !ystate?.binding?.mapping) {
      return null;
    }
    const fromAbs = relativePositionToAbsolutePosition(
      ystate.doc,
      ystate.type,
      Y.createRelativePositionFromJSON(edit.fromRelPos),
      ystate.binding.mapping
    );
    const toAbs = relativePositionToAbsolutePosition(
      ystate.doc,
      ystate.type,
      Y.createRelativePositionFromJSON(edit.toRelPos),
      ystate.binding.mapping
    );
    if (fromAbs === null || toAbs === null) {
      return null;
    }
    return { from: clampPos(editor, fromAbs), to: clampPos(editor, toAbs) };
  }

  return findUniqueTextRange(editor, edit.baseContent);
}

/**
 * Find the unique document range whose text equals `content`.
 * Only matches within a single text node (content must not cross block boundaries).
 */
export function findUniqueTextRange(
  editor: Editor,
  content: string
): { from: number; to: number } | null {
  if (!content) {
    return null;
  }
  const doc = editor.state.doc;
  let matches = 0;
  let found: { from: number; to: number } | null = null;

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return true;
    }
    let index = node.text.indexOf(content);
    while (index !== -1) {
      matches++;
      if (matches > 1) {
        return false;
      }
      found = { from: pos + index, to: pos + index + content.length };
      index = node.text.indexOf(content, index + 1);
    }
    return true;
  });

  return matches === 1 ? found : null;
}

/**
 * Apply an Agent proposal with write-time validation.
 *
 * 两步执行：先全部解析并校验，再按 from 降序单事务应用。
 * - 校验：前端锚点解析 + 内容快照对比（主判断），任一失败则整体冲突
 * - 应用：排序后相邻区间相交则整体冲突；同一 chain() 共享一个事务
 *   = 单 undo 步 = 单次 /collab 广播
 *
 * `force = true` 时跳过内容对比（"仍要应用"覆盖路径），但锚点解析失败仍为冲突。
 */
export function applyAgentProposal(
  editor: Editor,
  proposal: AgentProposal,
  force = false
): ApplyResult {
  const failures: ConflictEdit[] = [];
  const resolved: ResolvedEdit[] = [];

  for (const edit of proposal.patch.edits) {
    const range = resolveEditRange(editor, edit);
    if (range === null) {
      failures.push({ edit, reason: 'not_found' });
      continue;
    }
    if (!force && edit.kind !== 'widget') {
      const current = editor.state.doc.textBetween(range.from, range.to, '\n');
      if (current !== edit.baseContent) {
        failures.push({ edit, reason: 'modified' });
        continue;
      }
    }
    resolved.push({ edit, range });
  }

  if (failures.length > 0) {
    return { status: 'conflict', failures };
  }

  const ordered = [...resolved].sort((a, b) => b.range.from - a.range.from);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].range.to > ordered[i - 1].range.from) {
      const overlapFailures = ordered
        .slice(i - 1)
        .map((item) => ({ edit: item.edit, reason: 'overlap' as const }));
      return { status: 'conflict', failures: overlapFailures };
    }
  }

  const chain = editor.chain().focus();
  for (const { edit, range } of ordered) {
    if (edit.kind === 'widget') {
      chain.insertContentAt(range.to, {
        type: 'widget',
        attrs: { widgetType: edit.widgetType, props: edit.props },
      });
    } else {
      chain.insertContentAt({ from: range.from, to: range.to }, edit.newText);
    }
  }
  chain.run();
  return { status: 'applied' };
}
