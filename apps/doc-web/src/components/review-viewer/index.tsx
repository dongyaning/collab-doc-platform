import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Alert, Button, Drawer, Space, Tag, Typography } from 'antd';
import type { JSONContent } from '@tiptap/core';
import { WidgetExtension } from '../../extensions/widget/widget';
import { WidgetNodeView } from '../../extensions/widget/widget-node-view';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { applyEditsToPreview, extractEditText } from '../../agent/review/apply-edits';
import {
  applyChangeSetToEditor,
  type ChangeSetItem,
  type ChangeSetResult,
} from '../../agent/review/apply-change-set';
import { ReviewHighlightExtension } from '../../agent/review/review-highlight-extension';

const { Text } = Typography;

export interface ReviewViewerProps {
  open: boolean;
  editor: Editor;
  baseJson: JSONContent | null;
  changeSet: ChangeSetItem[];
  /** 应用前先执行服务端确认（CAS PENDING → APPLYING），失败抛错中止。 */
  confirmProposals: (proposalIds: string[]) => Promise<void>;
  onClose: () => void;
  onConfirmed: (proposalIds: string[]) => void;
  onRejected: (proposalIds: string[]) => void;
}

const reviewExtensions = [
  StarterKit.configure({ history: false }),
  WidgetExtension.extend({
    addNodeView() {
      return ReactNodeViewRenderer(WidgetNodeView);
    },
  }),
  ReviewHighlightExtension,
];

/**
 * 文档变更评审视图（客户端本地行为，不写入协同文档）。
 *
 * - Base 编辑器：变更前快照，只读，可切换查看。
 * - Preview 编辑器：应用变更集后的文档，added 绿底 / removed 红底叠加，
 *   仅变更区域（reviewAdd mark 内）可编辑。
 * - 确认：变更集折叠应用到主编辑器（一次事务），按 edit 粒度提取 Preview 当前文本。
 * - 拒绝：关闭评审，变更集作废。
 */
export function ReviewViewer({
  open,
  editor,
  baseJson,
  changeSet,
  confirmProposals,
  onClose,
  onConfirmed,
  onRejected,
}: ReviewViewerProps) {
  const [showBase, setShowBase] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  const baseEditor = useEditor(
    {
      editable: false,
      extensions: reviewExtensions,
    },
    []
  );

  const previewEditor = useEditor(
    {
      editable: false,
      extensions: reviewExtensions,
    },
    []
  );

  const previewEditorRef = useRef<Editor | null>(null);
  previewEditorRef.current = previewEditor ?? null;

  // 编辑器就绪 + baseJson 就绪后，统一设置内容（消除 useEditor content 异步时序竞态）
  useEffect(() => {
    if (!baseEditor || !baseJson) {
      return;
    }
    baseEditor.commands.setContent(baseJson);
  }, [baseEditor, baseJson]);

  // 变更集变化时重新生成 Preview（全量重建）
  useEffect(() => {
    if (!previewEditor || !baseJson) {
      return;
    }
    const flattened = changeSet.flatMap((item) => item.edits);
    applyEditsToPreview(previewEditor, baseJson, flattened);
  }, [previewEditor, baseJson, changeSet]);

  // 首次点击进入可编辑区域时自动聚焦（editable 翻转不自动 focus）
  useEffect(() => {
    if (!previewEditor) {
      return undefined;
    }
    const onSelection = () => {
      if (previewEditor.isEditable) {
        return;
      }
      const { from } = previewEditor.state.selection;
      const marks = previewEditor.state.doc.resolve(from).marks();
      if (marks.some((m) => m.type.name === 'reviewAdd')) {
        previewEditor.commands.focus();
      }
    };
    previewEditor.on('selectionUpdate', onSelection);
    return () => {
      previewEditor.off('selectionUpdate', onSelection);
    };
  }, [previewEditor]);

  const closeReview = () => {
    setShowBase(false);
    setError('');
    onClose();
  };

  const confirmReview = async () => {
    if (!editor || changeSet.length === 0 || !previewEditor) {
      return;
    }
    setApplying(true);
    setError('');
    try {
      // 先服务端确认（CAS），失败（过期/非 PENDING）抛错中止
      await confirmProposals(changeSet.map((item) => item.proposalId));

      const result: ChangeSetResult = applyChangeSetToEditor(editor, changeSet, (editId) =>
        extractEditText(previewEditor, editId)
      );
      if (result.status === 'applied') {
        onConfirmed(changeSet.map((item) => item.proposalId));
        closeReview();
        return;
      }
      const reasons = result.failures.map((f) => f.reason);
      const details = result.failures
        .slice(0, 3)
        .map((f) => (f.edit.kind === 'widget' ? f.edit.insertAfter : f.edit.baseContent))
        .filter(Boolean)
        .join(', ');
      setError(`应用冲突（${reasons.join(', ')}）：${details || '目标内容已不存在'}`);
    } catch (applyError) {
      const text = applyError instanceof Error ? applyError.message : '确认失败';
      setError(text);
    } finally {
      setApplying(false);
    }
  };

  const rejectReview = async () => {
    if (changeSet.length === 0) {
      closeReview();
      return;
    }
    onRejected(changeSet.map((item) => item.proposalId));
    closeReview();
  };

  const editCount = changeSet.reduce((sum, item) => sum + item.edits.length, 0);

  return (
    <Drawer
      open={open}
      onClose={closeReview}
      width="min(860px, 90vw)"
      destroyOnClose
      title="文档变更评审"
      extra={
        <Space>
          <Button size="small" onClick={() => setShowBase((prev) => !prev)}>
            {showBase ? '查看变更后' : '查看变更前'}
          </Button>
          <Tag color={showBase ? 'default' : 'green'}>
            {editCount} 处变更{showBase ? '（快照）' : ''}
          </Tag>
          <Button size="small" danger onClick={rejectReview} disabled={applying}>
            拒绝
          </Button>
          <Button size="small" type="primary" onClick={confirmReview} loading={applying}>
            确认应用
          </Button>
        </Space>
      }
    >
      {error ? <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} /> : null}
      <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
        {showBase ? '变更前快照（只读）' : '变更后预览（绿色为新增，可编辑；红色为删除内容）'}
      </div>
      <div className="review-editor-shell">
        {showBase ? (
          baseEditor ? (
            <EditorContent editor={baseEditor} />
          ) : null
        ) : previewEditor ? (
          <EditorContent editor={previewEditor} />
        ) : null}
      </div>
      <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
        评审仅在你本地进行，不会同步给其他协作者；确认应用后作为一次变更写入协同文档。
      </Text>
    </Drawer>
  );
}
