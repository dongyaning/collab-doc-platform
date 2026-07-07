import { useCallback, useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  AlignLeftOutlined,
  AlignCenterOutlined,
  AlignRightOutlined,
  AppstoreAddOutlined,
  BoldOutlined,
  ItalicOutlined,
  StrikethroughOutlined,
  UnderlineOutlined,
  LinkOutlined,
  OrderedListOutlined,
  UnorderedListOutlined,
  CodeOutlined,
  MinusOutlined,
  HighlightOutlined,
  BgColorsOutlined,
  BlockOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { App, Dropdown, Input, Modal, Tooltip } from 'antd';
import { listWidgets } from '../../extensions/widget';
import styles from './editor-toolbar.module.less';

interface EditorToolbarProps {
  editor: Editor | null;
  editable: boolean;
}

type Level = 1 | 2 | 3;

const HEADING_LABEL: Record<string, string> = {
  paragraph: '正文',
  h1: '标题 1',
  h2: '标题 2',
  h3: '标题 3',
};

const COLOR_PRESETS = [
  '#e03131',
  '#e8590c',
  '#f08c00',
  '#2f9e44',
  '#1971c2',
  '#6741d9',
  '#cc5de8',
  '#c2255c',
  '#000000',
  '#495057',
  '#868e96',
  '#adb5bd',
];

const HIGHLIGHT_PRESETS = [
  '#ffe066',
  '#ffd8a8',
  '#b2f2bb',
  '#a5d8ff',
  '#d0bfff',
  '#ffc9de',
  '#fff5f5',
  '#f8f9fa',
];

function ToolbarBtn({
  icon,
  active,
  tooltip,
  onClick,
}: {
  icon: React.ReactNode;
  active?: boolean;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <Tooltip title={tooltip} mouseEnterDelay={0.4}>
      <button
        type="button"
        className={`${styles.btn}${active ? ` ${styles.btnActive}` : ''}`}
        onClick={onClick}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

export function EditorToolbar({ editor, editable }: EditorToolbarProps) {
  const [headingOpen, setHeadingOpen] = useState(false);
  const { modal } = App.useApp();

  const setHeading = useCallback(
    (val: string) => {
      if (val === 'paragraph') {
        editor!.chain().focus().setParagraph().run();
      } else {
        const level = parseInt(val.replace('h', ''), 10) as Level;
        editor!.chain().focus().toggleHeading({ level }).run();
      }
      setHeadingOpen(false);
    },
    [editor]
  );

  const handleLink = useCallback(() => {
    const prevUrl = editor!.getAttributes('link').href ?? '';
    let url = prevUrl;

    modal.confirm({
      title: prevUrl ? '修改链接' : '插入链接',
      icon: null,
      content: (
        <div style={{ marginTop: 8 }}>
          <Input
            placeholder="https://..."
            defaultValue={prevUrl}
            onChange={(e) => {
              url = e.target.value;
            }}
            onPressEnter={() => {
              Modal.destroyAll();
              if (url === '') {
                editor!.chain().focus().unsetLink().run();
              } else {
                editor!.chain().focus().setLink({ href: url }).run();
              }
            }}
            autoFocus
          />
        </div>
      ),
      okText: prevUrl ? '更新' : '插入',
      cancelText: '取消',
      onOk: () => {
        if (url === '') {
          editor!.chain().focus().unsetLink().run();
        } else {
          editor!.chain().focus().setLink({ href: url }).run();
        }
      },
      onCancel: () => {},
    });
  }, [editor, modal]);

  const handleImageUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      const { filesApi } = await import('../../lib/endpoints');
      try {
        const { url } = await filesApi.upload(file);
        editor!.chain().focus().setImage({ src: url }).run();
      } catch {
        modal.error({ title: '上传失败', content: '图片上传失败，请重试' });
      }
    };
    input.click();
  }, [editor, modal]);

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const { filesApi } = await import('../../lib/endpoints');
          try {
            const { url } = await filesApi.upload(file);
            editor!.chain().focus().setImage({ src: url }).run();
          } catch {
            // silent failure for paste
          }
        }
      }
    },
    [editor]
  );

  // Attach paste handler for image paste
  useEffect(() => {
    const el = editor?.view.dom;
    if (!el) return;
    el.addEventListener('paste', handlePaste);
    return () => el.removeEventListener('paste', handlePaste);
  }, [handlePaste, editor?.view.dom]);

  if (!editable || !editor) return null;

  const headingValue =
    (editor.isActive('heading', { level: 1 }) && 'h1') ||
    (editor.isActive('heading', { level: 2 }) && 'h2') ||
    (editor.isActive('heading', { level: 3 }) && 'h3') ||
    'paragraph';

  const colorTrigger = (
    <Tooltip title="文字颜色" mouseEnterDelay={0.4}>
      <button type="button" className={styles.btn}>
        <BgColorsOutlined />
      </button>
    </Tooltip>
  );

  const highlightTrigger = (
    <Tooltip title="高亮" mouseEnterDelay={0.4}>
      <button type="button" className={styles.btn}>
        <HighlightOutlined />
      </button>
    </Tooltip>
  );

  const widgetDefinitions = listWidgets();
  const widgetTrigger = (
    <Tooltip title="插入组件" mouseEnterDelay={0.4}>
      <button type="button" className={styles.btn}>
        <AppstoreAddOutlined />
      </button>
    </Tooltip>
  );

  return (
    <div className={styles.toolbar}>
      <div className={styles.group}>
        <Dropdown
          open={headingOpen}
          onOpenChange={setHeadingOpen}
          trigger={['click']}
          menu={{
            selectedKeys: [headingValue],
            onClick: ({ key }) => setHeading(key),
            items: ['paragraph', 'h1', 'h2', 'h3'].map((k) => ({
              key: k,
              label: HEADING_LABEL[k],
              className: k === headingValue ? styles.headingItemActive : undefined,
            })),
          }}
        >
          <button type="button" className={`${styles.btn} ${styles.headingBtn}`}>
            <span className={styles.headingText}>{HEADING_LABEL[headingValue]}</span>
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
              <path
                d="M1 1L5 5L9 1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </Dropdown>
      </div>

      <div className={styles.sep} />

      <div className={styles.group}>
        <ToolbarBtn
          icon={<BoldOutlined />}
          active={editor.isActive('bold')}
          tooltip="加粗 (Ctrl+B)"
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarBtn
          icon={<ItalicOutlined />}
          active={editor.isActive('italic')}
          tooltip="斜体 (Ctrl+I)"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarBtn
          icon={<UnderlineOutlined />}
          active={editor.isActive('underline')}
          tooltip="下划线 (Ctrl+U)"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolbarBtn
          icon={<StrikethroughOutlined />}
          active={editor.isActive('strike')}
          tooltip="删除线"
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
      </div>

      <div className={styles.sep} />

      <div className={styles.group}>
        <ToolbarBtn
          icon={<UnorderedListOutlined />}
          active={editor.isActive('bulletList')}
          tooltip="无序列表"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarBtn
          icon={<OrderedListOutlined />}
          active={editor.isActive('orderedList')}
          tooltip="有序列表"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarBtn
          icon={<BlockOutlined />}
          active={editor.isActive('blockquote')}
          tooltip="引用"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarBtn
          icon={<CodeOutlined />}
          active={editor.isActive('code') || editor.isActive('codeBlock')}
          tooltip="代码"
          onClick={() => {
            if (editor.isActive('codeBlock')) {
              editor.chain().focus().toggleCodeBlock().run();
            } else {
              editor.chain().focus().toggleCode().run();
            }
          }}
        />
      </div>

      <div className={styles.sep} />

      <div className={styles.group}>
        <ToolbarBtn
          icon={<AlignLeftOutlined />}
          active={editor.isActive({ textAlign: 'left' })}
          tooltip="左对齐"
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
        />
        <ToolbarBtn
          icon={<AlignCenterOutlined />}
          active={editor.isActive({ textAlign: 'center' })}
          tooltip="居中对齐"
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
        />
        <ToolbarBtn
          icon={<AlignRightOutlined />}
          active={editor.isActive({ textAlign: 'right' })}
          tooltip="右对齐"
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
        />
      </div>

      <div className={styles.sep} />

      <div className={styles.group}>
        <ToolbarBtn icon={<PictureOutlined />} tooltip="插入图片" onClick={handleImageUpload} />
        <Dropdown
          trigger={['click']}
          menu={{
            items: widgetDefinitions.map((widget) => ({
              key: widget.type,
              icon: widget.icon,
              label: widget.label,
              onClick: () => {
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: 'widget',
                    attrs: {
                      widgetType: widget.type,
                      props: widget.defaultProps ?? {},
                    },
                  })
                  .run();
              },
            })),
          }}
        >
          {widgetTrigger}
        </Dropdown>
        <ToolbarBtn
          icon={<LinkOutlined />}
          active={editor.isActive('link')}
          tooltip="链接"
          onClick={handleLink}
        />
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'unset',
                label: '清除颜色',
                onClick: () => editor.chain().focus().unsetColor().run(),
              },
              { type: 'divider' },
              ...COLOR_PRESETS.map((c) => ({
                key: c,
                label: (
                  <span className={styles.colorItem}>
                    <span className={styles.colorDot} style={{ background: c }} />
                    {c}
                  </span>
                ),
                onClick: () => editor.chain().focus().setColor(c).run(),
              })),
            ],
          }}
        >
          {colorTrigger}
        </Dropdown>
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'unset',
                label: '清除高亮',
                onClick: () => editor.chain().focus().unsetHighlight().run(),
              },
              { type: 'divider' },
              ...HIGHLIGHT_PRESETS.map((c) => ({
                key: c,
                label: (
                  <span className={styles.colorItem}>
                    <span className={styles.colorDot} style={{ background: c }} />
                    {c}
                  </span>
                ),
                onClick: () => editor.chain().focus().toggleHighlight({ color: c }).run(),
              })),
            ],
          }}
        >
          {highlightTrigger}
        </Dropdown>
      </div>

      <div className={styles.sep} />

      <div className={styles.group}>
        <ToolbarBtn
          icon={<MinusOutlined />}
          tooltip="分割线"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        />
      </div>
    </div>
  );
}
