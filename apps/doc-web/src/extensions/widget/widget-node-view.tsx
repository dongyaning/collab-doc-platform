import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { getWidget, normalizeWidgetProps } from './registry';

export function WidgetNodeView(props: NodeViewProps) {
  const { node, updateAttributes, editor, getPos, selected } = props;
  const [isSelected, setIsSelected] = useState(false);
  const { widgetType, props: widgetProps } = node.attrs;
  const definition = getWidget(widgetType as string);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editable = editor.isEditable;
  const mode = editable ? 'edit' : 'read';
  const normalizedProps = normalizeWidgetProps(definition, widgetProps);

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

  const handleClick = useCallback(() => {
    if (editor && typeof getPos === 'function') {
      const pos = getPos();
      editor.commands.setNodeSelection(pos);
    }
  }, [editor, getPos]);

  const handleUpdateProps = useCallback(
    (next: Record<string, unknown>) => {
      if (!editable) return;
      updateAttributes({ props: normalizeWidgetProps(definition, next) });
    },
    [definition, editable, updateAttributes]
  );

  const showSelected = isSelected || selected;

  if (!definition) {
    return (
      <NodeViewWrapper
        style={{
          border: '1px dashed #d9d9d9',
          borderRadius: 6,
          padding: '24px 16px',
          textAlign: 'center' as const,
          color: '#999',
          fontSize: 13,
          margin: '0.75em 0',
          cursor: 'pointer',
          outline: showSelected ? '2px solid #1967d2' : undefined,
          outlineOffset: 2,
        }}
        onClick={handleClick}
        ref={wrapperRef}
      >
        Unknown widget: {String(widgetType ?? '')}
      </NodeViewWrapper>
    );
  }

  const WidgetComponent = definition.component;

  return (
    <NodeViewWrapper
      style={{
        margin: '0.75em 0',
        outline: showSelected ? '2px solid #1967d2' : undefined,
        outlineOffset: 2,
        borderRadius: 6,
        cursor: 'pointer',
      }}
      onClick={handleClick}
      ref={wrapperRef}
    >
      <WidgetComponent
        props={normalizedProps}
        updateProps={handleUpdateProps}
        selected={showSelected}
        mode={mode}
        editable={editable}
      />
    </NodeViewWrapper>
  );
}
