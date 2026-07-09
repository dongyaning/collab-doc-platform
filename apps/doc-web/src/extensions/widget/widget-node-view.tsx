import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { absolutePositionToRelativePosition, ySyncPluginKey } from 'y-prosemirror';
import { getWidget, normalizeWidgetProps } from './registry';

type AwarenessProvider = {
  awareness?: {
    setLocalStateField: (field: string, value: unknown) => void;
  };
};

function getCollaborationProvider(editor: NodeViewProps['editor']): AwarenessProvider | null {
  const extension = editor.extensionManager.extensions.find(
    (item) => item.name === 'collaborationCursor'
  );
  return (extension?.options.provider as AwarenessProvider | undefined) ?? null;
}

function syncWidgetCursor(editor: NodeViewProps['editor'], pos: number, nodeSize: number) {
  const provider = getCollaborationProvider(editor);
  const ystate = ySyncPluginKey.getState(editor.state);
  if (!provider?.awareness || !ystate?.type || !ystate?.binding?.mapping) {
    return;
  }

  provider.awareness.setLocalStateField('cursor', {
    anchor: absolutePositionToRelativePosition(pos, ystate.type, ystate.binding.mapping),
    head: absolutePositionToRelativePosition(pos + nodeSize, ystate.type, ystate.binding.mapping),
  });
}

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
    if (!editor || typeof getPos !== 'function') {
      return;
    }
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

  const selectWidgetNode = useCallback(() => {
    if (editor && typeof getPos === 'function') {
      const pos = getPos();
      editor.commands.setNodeSelection(pos);
      syncWidgetCursor(editor, pos, node.nodeSize);
    }
  }, [editor, getPos, node.nodeSize]);

  const handleFocusInside = useCallback(() => {
    selectWidgetNode();
    requestAnimationFrame(selectWidgetNode);
  }, [selectWidgetNode]);

  const handleUpdateProps = useCallback(
    (next: Record<string, unknown>) => {
      if (!editable) {
        return;
      }
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
        onClick={selectWidgetNode}
        onFocusCapture={handleFocusInside}
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
      onClick={selectWidgetNode}
      onFocusCapture={selectWidgetNode}
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
