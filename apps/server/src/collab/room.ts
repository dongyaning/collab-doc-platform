import * as Y from 'yjs';
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness';
import type { NodeRole } from '@prisma/client';
import type { WebSocket } from 'ws';

/**
 * One Room == one collaborative document loaded into memory.
 *
 * Holds the authoritative Y.Doc, the Awareness instance and the set of
 * connected websocket clients. Persistence + history are wired in by
 * `RoomManager` via callbacks; the room itself only does in-memory work.
 */
export class Room {
  readonly ydoc = new Y.Doc({ gc: true });
  readonly awareness = new Awareness(this.ydoc);
  readonly conns = new Map<WebSocket, Set<number>>(); // ws -> set of awareness clientIds it owns
  readonly roles = new Map<WebSocket, NodeRole>();

  /** Set to true once initial state has been loaded from storage. */
  loaded = false;

  /** Number of updates accumulated since the last persist. */
  pendingUpdates = 0;

  /** Number of updates accumulated since the last automatic snapshot. */
  updatesSinceSnapshot = 0;

  /** Last time we persisted to storage (ms epoch). */
  lastPersistedAt = 0;

  /** Last time an automatic snapshot was written (ms epoch). */
  lastSnapshotAt = 0;

  constructor(readonly docId: string) {
    // Awareness clients should not include the local Y.Doc client by default
    // (the server is not a "user").
    this.awareness.setLocalState(null);
  }

  addConn(ws: WebSocket, role: NodeRole): void {
    this.conns.set(ws, new Set());
    this.roles.set(ws, role);
  }

  removeConn(ws: WebSocket): void {
    const controlled = this.conns.get(ws);
    if (controlled && controlled.size > 0) {
      removeAwarenessStates(this.awareness, Array.from(controlled), null);
    }
    this.conns.delete(ws);
    this.roles.delete(ws);
  }

  isEmpty(): boolean {
    return this.conns.size === 0;
  }

  destroy(): void {
    this.awareness.destroy();
    this.ydoc.destroy();
  }
}
