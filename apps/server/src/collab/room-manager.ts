import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { WebSocket } from 'ws';
import { PrismaService } from '../prisma/prisma.module.js';
import { Room } from './room.js';
import { decodeYjsStateToProseMirror } from './yjs-json-codec.js';
import type { NodeRole } from '@prisma/client';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const PERSIST_DEBOUNCE_MS = 2000;
const PERSIST_MAX_UPDATES = 50;
const SNAPSHOT_EVERY_UPDATES = 50;
const SNAPSHOT_MAX_INTERVAL_MS = 30 * 60 * 1000;
const SYNC_STEP1 = 0;

/**
 * Owns the in-memory `Room` map and orchestrates the y-protocol message flow.
 *
 * Wire format follows the de-facto y-websocket protocol so that the standard
 * `y-websocket` client works against this server unchanged:
 *   varuint messageType, then message body
 *     - 0 (sync): handled by y-protocols/sync
 *     - 1 (awareness): handled by y-protocols/awareness
 */
@Injectable()
export class RoomManager {
  private readonly log = new Logger(RoomManager.name);
  private readonly rooms = new Map<string, Room>();
  /** Per-room debounce timers for persistence. */
  private readonly persistTimers = new Map<string, NodeJS.Timeout>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Get-or-create a room and ensure its initial state is loaded from PG. */
  async getOrCreateRoom(docId: string): Promise<Room> {
    let room = this.rooms.get(docId);
    if (room) return room;

    room = new Room(docId);
    this.rooms.set(docId, room);
    await this.loadInitialState(room);
    this.wireDocListeners(room);
    return room;
  }

  /** Hydrate the room's Y.Doc from PG. */
  private async loadInitialState(room: Room): Promise<void> {
    const rec = await this.prisma.node.findUnique({
      where: { id: room.docId },
      select: { yjsState: true },
    });

    if (rec) {
      Y.applyUpdate(room.ydoc, new Uint8Array(rec.yjsState));
    } else {
      this.log.warn(`room ${room.docId}: doc not found, starting empty`);
    }
    room.loaded = true;
  }

  /** Subscribe to update events to broadcast + schedule persistence. */
  private wireDocListeners(room: Room): void {
    room.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      // Broadcast sync update to every connected client (except the origin if it's a ws).
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      const buf = encoding.toUint8Array(enc);
      for (const ws of room.conns.keys()) {
        if (ws === origin) continue;
        this.send(ws, buf);
      }
      room.pendingUpdates += 1;
      room.updatesSinceSnapshot += 1;
      this.schedulePersist(room);
    });

    room.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown
      ) => {
        const changedClients = added.concat(updated, removed);
        // Track which client ids each connection owns so we can clean up on disconnect.
        if (origin && typeof origin === 'object') {
          const conn = room.conns.get(origin as WebSocket);
          if (conn) {
            for (const id of added) conn.add(id);
            for (const id of removed) conn.delete(id);
          }
        }
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          enc,
          awarenessProtocol.encodeAwarenessUpdate(room.awareness, changedClients)
        );
        const buf = encoding.toUint8Array(enc);
        for (const ws of room.conns.keys()) this.send(ws, buf);
      }
    );
  }

  /** Add a websocket to a room and send the y-protocol handshake. */
  async addConnection(room: Room, ws: WebSocket, role: NodeRole): Promise<void> {
    room.addConn(ws, role);

    // 1. Editors can sync their local state into the room. Read-only clients
    // receive state through their own initial sync step1 instead.
    if (role === 'OWNER' || role === 'EDITOR') {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(enc, room.ydoc);
      this.send(ws, encoding.toUint8Array(enc));
    }
    // 2. send current awareness states to the new client (if any)
    const awarenessStates = room.awareness.getStates();
    if (awarenessStates.size > 0) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(awarenessStates.keys()))
      );
      this.send(ws, encoding.toUint8Array(enc));
    }
  }

  /** Handle a single binary frame from a client. */
  handleMessage(room: Room, ws: WebSocket, data: Uint8Array): void {
    try {
      const decoder = decoding.createDecoder(data);
      const encoder = encoding.createEncoder();
      const messageType = decoding.readVarUint(decoder);
      switch (messageType) {
        case MESSAGE_SYNC: {
          if (!this.canApplySyncMessage(room, ws, data)) {
            this.log.warn(`blocked read-only sync update in room ${room.docId}`);
            ws.close(1008, 'read-only role cannot edit this document');
            break;
          }
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, room.ydoc, ws);
          // readSyncMessage writes a reply (step2 / update ack) into encoder.
          // length === 1 means "only the type byte" -> no reply needed.
          if (encoding.length(encoder) > 1) {
            this.send(ws, encoding.toUint8Array(encoder));
          }
          break;
        }
        case MESSAGE_AWARENESS: {
          awarenessProtocol.applyAwarenessUpdate(
            room.awareness,
            decoding.readVarUint8Array(decoder),
            ws
          );
          break;
        }
        default:
          this.log.warn(`unknown message type ${messageType} in room ${room.docId}`);
      }
    } catch (err) {
      this.log.error(`error handling message in room ${room.docId}`, err as Error);
    }
  }

  private canApplySyncMessage(room: Room, ws: WebSocket, data: Uint8Array): boolean {
    const role = room.roles.get(ws);
    if (role === 'OWNER' || role === 'EDITOR') return true;

    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);
    if (messageType !== MESSAGE_SYNC) return true;
    const syncType = decoding.readVarUint(decoder);
    return syncType === SYNC_STEP1;
  }

  /** Drop a connection from its room; if empty, persist + free the room. */
  async removeConnection(room: Room, ws: WebSocket): Promise<void> {
    room.removeConn(ws);
    if (room.isEmpty()) {
      await this.persistNow(room);
      const t = this.persistTimers.get(room.docId);
      if (t) {
        clearTimeout(t);
        this.persistTimers.delete(room.docId);
      }
      this.rooms.delete(room.docId);
      room.destroy();
      this.log.log(`room ${room.docId} closed`);
    }
  }

  // ---------- persistence ----------

  private schedulePersist(room: Room): void {
    if (room.pendingUpdates >= PERSIST_MAX_UPDATES) {
      void this.persistNow(room);
      return;
    }
    if (this.persistTimers.has(room.docId)) return;
    const t = setTimeout(() => {
      this.persistTimers.delete(room.docId);
      void this.persistNow(room);
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimers.set(room.docId, t);
  }

  private async persistNow(room: Room): Promise<void> {
    if (room.pendingUpdates === 0 && room.lastPersistedAt !== 0) return;
    const snapshot = Y.encodeStateAsUpdate(room.ydoc);
    const buf = Buffer.from(snapshot);
    try {
      const updated = await this.prisma.node.update({
        where: { id: room.docId },
        data: { yjsState: buf, version: { increment: 1 } },
        select: { version: true },
      });
      room.pendingUpdates = 0;
      room.lastPersistedAt = Date.now();
      await this.maybeSnapshot(room, updated.version, buf);
    } catch (err) {
      this.log.error(`persist failed for ${room.docId}`, err as Error);
    }
  }

  /**
   * Decide whether to write a row into the snapshots table. Auto snapshots fire
   * either every N updates or once a configured wall-clock interval elapses.
   * Manual snapshots go through {@link createManualSnapshot} instead.
   */
  private async maybeSnapshot(room: Room, version: number, snapshot: Buffer): Promise<void> {
    const now = Date.now();
    const byUpdates = room.updatesSinceSnapshot >= SNAPSHOT_EVERY_UPDATES;
    const byTime =
      room.lastSnapshotAt !== 0 && now - room.lastSnapshotAt >= SNAPSHOT_MAX_INTERVAL_MS;
    if (!byUpdates && !byTime) return;
    try {
      await this.prisma.nodeVersion.create({
        data: {
          nodeId: room.docId,
          version,
          yjsState: snapshot,
        },
      });
      room.updatesSinceSnapshot = 0;
      room.lastSnapshotAt = now;
    } catch (err) {
      this.log.warn(`auto snapshot failed for ${room.docId}: ${(err as Error).message}`);
    }
  }

  /**
   * Force a persist + write a labeled snapshot. Used by the manual
   * "save version" REST endpoint.
   */
  async createManualSnapshot(
    docId: string,
    userId: string,
    label: string | undefined
  ): Promise<{ version: number; id: string }> {
    const room = this.rooms.get(docId);

    let snapshotBuf: Buffer;
    let version: number;

    if (room) {
      // Live room: flush in-memory state first so the snapshot reflects it.
      snapshotBuf = Buffer.from(Y.encodeStateAsUpdate(room.ydoc));
      const updated = await this.prisma.node.update({
        where: { id: docId },
        data: { yjsState: snapshotBuf, version: { increment: 1 } },
        select: { version: true },
      });
      version = updated.version;
      room.pendingUpdates = 0;
      room.lastPersistedAt = Date.now();
      room.updatesSinceSnapshot = 0;
      room.lastSnapshotAt = Date.now();
    } else {
      // Cold doc: fetch from Node table.
      const node = await this.prisma.node.findUnique({
        where: { id: docId },
        select: { yjsState: true, version: true },
      });
      if (!node) throw new Error('document not found');
      snapshotBuf = node.yjsState ? Buffer.from(node.yjsState) : Buffer.alloc(0);
      version = node.version;
    }

    const created = await this.prisma.nodeVersion.create({
      data: {
        nodeId: docId,
        version,
        yjsState: snapshotBuf,
        createdById: userId,
        label: label ?? null,
      },
      select: { id: true, version: true },
    });
    return created;
  }

  /**
   * Decode persisted yjsState to Tiptap JSON for REST clients.
   */
  async getDocumentContent(docId: string): Promise<unknown> {
    const rec = await this.prisma.node.findUnique({
      where: { id: docId },
      select: { yjsState: true },
    });
    if (!rec) throw new NotFoundException('document not found');

    return decodeYjsStateToProseMirror(new Uint8Array(rec.yjsState));
  }

  async getVersionSnapshot(docId: string, versionId: string) {
    const target = await this.prisma.nodeVersion.findFirst({
      where: { id: versionId, nodeId: docId },
      select: {
        id: true,
        version: true,
        label: true,
        createdById: true,
        createdAt: true,
        yjsState: true,
      },
    });
    if (!target) throw new NotFoundException('version not found');
    const content = decodeYjsStateToProseMirror(new Uint8Array(target.yjsState));
    return {
      id: target.id,
      version: target.version,
      label: target.label,
      createdById: target.createdById,
      createdAt: target.createdAt,
      content,
    };
  }

  // ---------- helpers ----------

  private send(ws: WebSocket, data: Uint8Array): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(data, (err) => {
      if (err) this.log.warn(`ws send failed: ${err.message}`);
    });
  }
}
