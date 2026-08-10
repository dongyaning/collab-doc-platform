import { useCallback, useEffect, useRef, useState, type FocusEvent } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { absolutePositionToRelativePosition, ySyncPluginKey } from 'y-prosemirror';
import { getWidget, normalizeWidgetProps } from './registry';
import { loadAgentWidget, type AgentWidgetMeta } from './agent-widget-loader';
import { WidgetSandbox } from './widget-sandbox';

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

function setWidgetNodeCursor(
  editor: NodeViewProps['editor'],
  pos: number,
  nodeSize: number
): boolean {
  const provider = getCollaborationProvider(editor);
  const ystate = ySyncPluginKey.getState(editor.state);
  if (!provider?.awareness || !ystate?.type || !ystate?.binding?.mapping) {
    return false;
  }

  provider.awareness.setLocalStateField('nodeCursor', {
    anchor: absolutePositionToRelativePosition(pos, ystate.type, ystate.binding.mapping),
    head: absolutePositionToRelativePosition(pos + nodeSize, ystate.type, ystate.binding.mapping),
  });
  return true;
}

function clearWidgetNodeCursor(editor: NodeViewProps['editor']) {
  const provider = getCollaborationProvider(editor);
  provider?.awareness?.setLocalStateField('nodeCursor', null);
}

type AgentLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; meta: AgentWidgetMeta }
  | { status: 'error' };

export function WidgetNodeView(props: NodeViewProps) {
  const { node, updateAttributes, editor, getPos, selected } = props;
  const [isSelected, setIsSelected] = useState(false);
  const { widgetType, props: widgetProps } = node.attrs;
  const definition = getWidget(widgetType as string);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const ownsNodeCursorRef = useRef(false);
  const editable = editor.isEditable;
  const mode = editable ? 'edit' : 'read';
  const normalizedProps = normalizeWidgetProps(definition, widgetProps);

  // Agent 组件异步加载状态（注册表未命中时走此分支）
  const [agentState, setAgentState] = useState<AgentLoadState>({ status: 'idle' });
  const nodeId = (editor.storage as { widgetRuntime?: { nodeId?: string } } | undefined)
    ?.widgetRuntime?.nodeId;

  useEffect(() => {
    if (definition || !widgetType || !nodeId) {
      return undefined;
    }
    let cancelled = false;
    setAgentState({ status: 'loading' });
    loadAgentWidget(widgetType, nodeId)
      .then((meta) => {
        if (!cancelled) {
          setAgentState({ status: 'ready', meta });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgentState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [definition, widgetType, nodeId]);

  useEffect(() => {
    if (!editor || typeof getPos !== 'function') {
      return undefined;
    }
    const update = () => {
      const pos = getPos();
      const { from, to } = editor.state.selection;
      const nextSelected = from <= pos && to >= pos + node.nodeSize;
      setIsSelected(nextSelected);
      if (!nextSelected && ownsNodeCursorRef.current) {
        clearWidgetNodeCursor(editor);
        ownsNodeCursorRef.current = false;
      }
    };
    editor.on('selectionUpdate', update);
    update();
    return () => {
      if (ownsNodeCursorRef.current) {
        clearWidgetNodeCursor(editor);
        ownsNodeCursorRef.current = false;
      }
      editor.off('selectionUpdate', update);
    };
  }, [editor, getPos, node.nodeSize]);

  const selectWidgetNode = useCallback(() => {
    if (editor && typeof getPos === 'function') {
      const pos = getPos();
      editor.commands.setNodeSelection(pos);
      ownsNodeCursorRef.current = setWidgetNodeCursor(editor, pos, node.nodeSize);
    }
  }, [editor, getPos, node.nodeSize]);

  const handleFocusInside = useCallback(() => {
    selectWidgetNode();
  }, [selectWidgetNode]);

  const handleBlurInside = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        return;
      }
      if (ownsNodeCursorRef.current) {
        clearWidgetNodeCursor(editor);
        ownsNodeCursorRef.current = false;
      }
    },
    [editor]
  );

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
  const wrapperStyle: React.CSSProperties = {
    margin: '0.75em 0',
    outline: showSelected ? '2px solid #1967d2' : undefined,
    outlineOffset: 2,
    borderRadius: 6,
    cursor: 'pointer',
  };

  // 分支 1：预设组件（注册表命中）
  if (definition) {
    const WidgetComponent = definition.component;
    return (
      <NodeViewWrapper
        style={wrapperStyle}
        onClick={selectWidgetNode}
        onFocusCapture={handleFocusInside}
        onBlurCapture={handleBlurInside}
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

  // 分支 2：Agent 组件（未命中注册表，异步加载后沙箱渲染）
  if (agentState.status === 'loading') {
    return (
      <NodeViewWrapper style={wrapperStyle} ref={wrapperRef}>
        <div
          style={{
            border: '1px dashed #d9d9d9',
            borderRadius: 6,
            padding: '24px 16px',
            textAlign: 'center' as const,
            color: '#999',
            fontSize: 13,
          }}
        >
          组件加载中：{String(widgetType ?? '')}
        </div>
      </NodeViewWrapper>
    );
  }

  if (agentState.status === 'error') {
    return (
      <NodeViewWrapper
        style={wrapperStyle}
        onClick={selectWidgetNode}
        onFocusCapture={handleFocusInside}
        onBlurCapture={handleBlurInside}
        ref={wrapperRef}
      >
        <div
          style={{
            border: '1px dashed #d9d9d9',
            borderRadius: 6,
            padding: '24px 16px',
            textAlign: 'center' as const,
            color: '#c62828',
            fontSize: 13,
          }}
        >
          组件加载失败：{String(widgetType ?? '')}，请检查组件是否已确认激活
        </div>
      </NodeViewWrapper>
    );
  }

  if (agentState.status === 'ready') {
    return (
      <NodeViewWrapper
        style={wrapperStyle}
        onClick={selectWidgetNode}
        onFocusCapture={handleFocusInside}
        onBlurCapture={handleBlurInside}
        ref={wrapperRef}
      >
        <WidgetSandbox
          jsCode={agentState.meta.jsCode}
          props={normalizedProps}
          mode={mode}
          editable={editable}
          onPropsChange={handleUpdateProps}
        />
      </NodeViewWrapper>
    );
  }

  // 分支 3：未知 widgetType（无注册表定义、无 nodeId 上下文或加载未触发）
  return (
    <NodeViewWrapper
      style={wrapperStyle}
      onClick={selectWidgetNode}
      onFocusCapture={handleFocusInside}
      onBlurCapture={handleBlurInside}
      ref={wrapperRef}
    >
      <div
        style={{
          border: '1px dashed #d9d9d9',
          borderRadius: 6,
          padding: '24px 16px',
          textAlign: 'center' as const,
          color: '#999',
          fontSize: 13,
        }}
      >
        Unknown widget: {String(widgetType ?? '')}
      </div>
    </NodeViewWrapper>
  );
}
