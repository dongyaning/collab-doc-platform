import { useEffect, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { relativePositionToAbsolutePosition, ySyncPluginKey } from 'y-prosemirror';

const NODE_CURSOR_TYPES = new Set(['image', 'widget']);

type AwarenessUser = {
  name?: string;
  color?: string;
  avatarUrl?: string;
  cursorKey?: string;
};

type AwarenessCursor = {
  anchor?: unknown;
  head?: unknown;
};

type AwarenessState = {
  user?: AwarenessUser;
  cursor?: AwarenessCursor | null;
  nodeCursor?: AwarenessCursor | null;
};

type AbsoluteCursor = {
  anchor: number;
  head: number;
};

type NodeCursorTarget = {
  pos: number;
  node: ProseMirrorNode;
};

type RemoteNodeCursor = {
  clientId: number;
  cursorKey?: string;
  name: string;
  color: string;
  avatarUrl?: string;
  top: number;
};

type RemoteNodeCursorsProps = {
  editor: Editor | null;
  provider: WebsocketProvider | null;
  containerRef: RefObject<HTMLDivElement>;
};

function avatarFallback(name: string | undefined): string {
  return (name?.trim().slice(0, 1) || 'A').toUpperCase();
}

function CursorAvatar({ cursor }: { cursor: RemoteNodeCursor }) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  if (cursor.avatarUrl && failedAvatarUrl !== cursor.avatarUrl) {
    return (
      <img
        src={cursor.avatarUrl}
        alt=""
        onError={() => setFailedAvatarUrl(cursor.avatarUrl ?? null)}
      />
    );
  }
  return <>{avatarFallback(cursor.name)}</>;
}

function toAbsolutePos(editor: Editor, value: unknown): number | null {
  const ystate = ySyncPluginKey.getState(editor.state);
  if (!ystate?.doc || !ystate?.type || !ystate?.binding?.mapping) {
    return null;
  }
  const relativePos = Y.createRelativePositionFromJSON(value);
  const pos = relativePositionToAbsolutePosition(
    ystate.doc,
    ystate.type,
    relativePos,
    ystate.binding.mapping
  );
  if (pos === null) {
    return null;
  }
  return Math.min(pos, Math.max(editor.state.doc.content.size - 1, 0));
}

function getAbsoluteCursor(editor: Editor, cursor: AwarenessCursor): AbsoluteCursor | null {
  if (!cursor.anchor || !cursor.head) {
    return null;
  }
  const anchor = toAbsolutePos(editor, cursor.anchor);
  const head = toAbsolutePos(editor, cursor.head);
  if (anchor === null || head === null) {
    return null;
  }
  return { anchor, head };
}

function isNodeCursorTarget(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return Boolean(node && NODE_CURSOR_TYPES.has(node.type.name));
}

function nodeAtPos(editor: Editor, pos: number): NodeCursorTarget | null {
  const node = editor.state.doc.nodeAt(pos);
  if (!isNodeCursorTarget(node)) {
    return null;
  }
  return { pos, node };
}

function findNodeCursorTarget(editor: Editor, cursor: AbsoluteCursor): NodeCursorTarget | null {
  const doc = editor.state.doc;
  const candidates = [cursor.anchor, cursor.head, cursor.anchor - 1, cursor.head - 1]
    .filter((pos) => pos >= 0)
    .map((pos) => Math.min(pos, doc.content.size));

  for (const pos of candidates) {
    const target = nodeAtPos(editor, pos);
    if (target) {
      return target;
    }
  }

  const from = Math.min(cursor.anchor, cursor.head);
  const to = Math.max(cursor.anchor, cursor.head);
  let match: NodeCursorTarget | null = null;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!match && isNodeCursorTarget(node)) {
      match = { pos, node };
      return false;
    }
    return true;
  });
  return match;
}

function getNodeRect(editor: Editor, target: NodeCursorTarget): DOMRect | null {
  const nodeDom = editor.view.nodeDOM(target.pos);
  if (!(nodeDom instanceof HTMLElement)) {
    return null;
  }
  if (target.node.type.name === 'image') {
    const img = nodeDom.querySelector('img');
    return (img ?? nodeDom).getBoundingClientRect();
  }
  return nodeDom.getBoundingClientRect();
}

function hideDefaultNodeCursors(container: HTMLDivElement, cursorKeys: Set<string>) {
  const carets = container.querySelectorAll<HTMLElement>(
    '.collaboration-cursor__caret[data-cursor-key]'
  );
  carets.forEach((caret) => {
    const cursorKey = caret.dataset.cursorKey;
    caret.toggleAttribute(
      'data-node-cursor-hidden',
      Boolean(cursorKey && cursorKeys.has(cursorKey))
    );
  });
}

function readRemoteNodeCursors(
  editor: Editor,
  provider: WebsocketProvider,
  container: HTMLDivElement
): RemoteNodeCursor[] {
  const containerRect = container.getBoundingClientRect();
  const selfId = provider.awareness.clientID;
  const cursors: RemoteNodeCursor[] = [];

  provider.awareness.getStates().forEach((rawState, clientId) => {
    if (clientId === selfId) {
      return;
    }
    const state = rawState as AwarenessState;
    const awarenessCursor = state.nodeCursor ?? state.cursor;
    if (!awarenessCursor) {
      return;
    }
    const cursor = getAbsoluteCursor(editor, awarenessCursor);
    if (!cursor) {
      return;
    }
    const target = findNodeCursorTarget(editor, cursor);
    if (!target) {
      return;
    }
    const nodeRect = getNodeRect(editor, target);
    if (!nodeRect) {
      return;
    }
    cursors.push({
      clientId,
      cursorKey: state.user?.cursorKey,
      name: state.user?.name ?? 'A',
      color: state.user?.color ?? '#888',
      avatarUrl: state.user?.avatarUrl,
      top: nodeRect.top - containerRect.top + nodeRect.height / 2,
    });
  });

  return cursors;
}

export function RemoteNodeCursors({ editor, provider, containerRef }: RemoteNodeCursorsProps) {
  const [cursors, setCursors] = useState<RemoteNodeCursor[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!editor || !provider || !container) {
      setCursors([]);
      return undefined;
    }

    const update = () => {
      const nextCursors = readRemoteNodeCursors(editor, provider, container);
      const cursorKeys = new Set(
        nextCursors.flatMap((cursor) => (cursor.cursorKey ? [cursor.cursorKey] : []))
      );
      hideDefaultNodeCursors(container, cursorKeys);
      setCursors(nextCursors);
    };

    provider.awareness.on('change', update);
    editor.on('transaction', update);
    window.addEventListener('resize', update);
    update();

    return () => {
      hideDefaultNodeCursors(container, new Set());
      provider.awareness.off('change', update);
      editor.off('transaction', update);
      window.removeEventListener('resize', update);
    };
  }, [containerRef, editor, provider]);

  if (cursors.length === 0) {
    return null;
  }

  return (
    <div aria-hidden="true">
      {cursors.map((cursor) => (
        <div
          key={cursor.clientId}
          className="remote-node-cursor"
          style={{ top: cursor.top, color: cursor.color }}
        >
          <span style={{ backgroundColor: cursor.color }} />
          <strong style={{ backgroundColor: cursor.color }}>
            <CursorAvatar cursor={cursor} />
          </strong>
        </div>
      ))}
    </div>
  );
}
