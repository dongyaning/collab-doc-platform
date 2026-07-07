import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

const MIN_WIDTH = 120;

export function ImageNodeView(props: NodeViewProps) {
  const { node, updateAttributes, editor, getPos } = props;
  const [isSelected, setIsSelected] = useState(false);
  const { src, width } = node.attrs;
  const textAlign = node.attrs.textAlign as string | null;
  const imgRef = useRef<HTMLImageElement>(null);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    if (!editor || typeof getPos !== 'function') return;
    const update = () => {
      const pos = getPos();
      const { from, to } = editor.state.selection;
      setIsSelected(from <= pos && to >= pos + node.nodeSize);
    };
    editor.on('selectionUpdate', update);
    update();
    return () => {
      editor.off('selectionUpdate', update);
    };
  }, [editor, getPos, node.nodeSize]);

  const currentWidth =
    typeof width === 'string' && width.endsWith('%')
      ? width
      : typeof width === 'string' && width.endsWith('px')
        ? width
        : `${width}px`;

  // Click the image wrapper → select the node
  const handleClick = useCallback(() => {
    if (editor && typeof getPos === 'function') {
      const pos = getPos();
      editor.commands.setNodeSelection(pos);
    }
  }, [editor, getPos]);

  // Resize drag handler
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setResizing(true);

      const startX = e.clientX;
      const startW = imgRef.current?.getBoundingClientRect().width ?? 400;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const newW = Math.max(MIN_WIDTH, startW + delta);
        updateAttributes({ width: `${newW}px` });
      };
      const onUp = () => {
        setResizing(false);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [updateAttributes]
  );

  return (
    <NodeViewWrapper
      className="image-node-view"
      style={{
        display: 'flex',
        justifyContent:
          textAlign === 'center' ? 'center' : textAlign === 'right' ? 'flex-end' : 'flex-start',
        margin: '1em 0',
      }}
    >
      <div
        style={{ position: 'relative', display: 'inline-flex', lineHeight: 0 }}
        onClick={handleClick}
      >
        <img
          ref={imgRef}
          src={src}
          width={currentWidth}
          style={{
            maxWidth: '100%',
            height: 'auto',
            borderRadius: 6,
            display: 'block',
            cursor: 'pointer',
            userSelect: resizing ? 'none' : undefined,
          }}
        />
        {isSelected && (
          <span
            onMouseDown={handleMouseDown}
            style={{
              position: 'absolute',
              right: -8,
              bottom: -8,
              width: 22,
              height: 22,
              cursor: 'nwse-resize',
              background: '#fff',
              border: '1px solid #e0e0e0',
              borderRadius: 4,
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M1 9 9 1M9 1v4M9 1H5M1 9V5M1 9h4"
                stroke="#999"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
      </div>
    </NodeViewWrapper>
  );
}
