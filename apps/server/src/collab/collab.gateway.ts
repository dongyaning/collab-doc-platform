import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { URL } from 'url';
import { PrismaService } from '../prisma/prisma.module.js';
import { RoomManager } from './room-manager.js';

const PING_INTERVAL_MS = 25_000;

interface AuthInfo {
  userId: string;
  docId: string;
}

interface CollabSocket extends WebSocket {
  isAlive?: boolean;
}

/**
 * Attaches a `ws` server to an existing http.Server on the path `/collab`.
 *
 * Wire:
 *   ws://host:3000/collab?docId=xxx&token=jwt
 *
 * The connection is upgraded only if JWT is valid AND the user has access
 * to the document. After that all messages are y-protocol binary frames.
 */
@Injectable()
export class CollabGateway implements OnModuleDestroy {
  private readonly log = new Logger(CollabGateway.name);
  private wss?: WebSocketServer;
  private heartbeat?: NodeJS.Timeout;

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RoomManager) private readonly rooms: RoomManager
  ) {}

  /** Call from main.ts after the Nest app is created. */
  attach(server: import('http').Server): void {
    if (this.wss) return;
    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;

    server.on('upgrade', (req, socket, head) => {
      const url = req.url ?? '';
      if (!url.startsWith('/collab')) return; // let other handlers deal with it
      this.authorize(req)
        .then((auth) => {
          if (!auth) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req, auth);
          });
        })
        .catch((err) => {
          this.log.warn(`upgrade failed: ${(err as Error).message}`);
          socket.destroy();
        });
    });

    wss.on('connection', (ws: CollabSocket, _req: IncomingMessage, auth: AuthInfo) => {
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      this.handleConnection(ws, auth).catch((err) => {
        this.log.error('connection setup failed', err);
        ws.close();
      });
    });

    this.heartbeat = setInterval(() => {
      for (const ws of wss.clients as Set<CollabSocket>) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        try {
          ws.ping();
        } catch {
          ws.terminate();
        }
      }
    }, PING_INTERVAL_MS);

    this.log.log('collab websocket attached at /collab');
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.wss?.close();
  }

  // ---------- private ----------

  private async authorize(req: IncomingMessage): Promise<AuthInfo | null> {
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      const docId = url.searchParams.get('docId');
      if (!token || !docId) return null;
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      if (!payload?.sub) return null;
      const userId = payload.sub;

      const doc = await this.prisma.document.findUnique({
        where: { id: docId },
        select: {
          ownerId: true,
          members: { where: { userId }, select: { role: true }, take: 1 },
        },
      });
      if (!doc) return null;
      // Allow the owner or any member with at least VIEWER access. Write
      // permission is enforced again at the y-protocol level if needed.
      if (doc.ownerId !== userId && doc.members.length === 0) return null;
      return { userId, docId };
    } catch {
      return null;
    }
  }

  private async handleConnection(ws: CollabSocket, auth: AuthInfo): Promise<void> {
    const room = await this.rooms.getOrCreateRoom(auth.docId);
    await this.rooms.addConnection(room, ws);

    ws.on('message', (data: Buffer) => {
      this.rooms.handleMessage(room, ws, new Uint8Array(data));
    });
    ws.on('close', () => {
      void this.rooms.removeConnection(room, ws);
    });
    ws.on('error', (err) => {
      this.log.warn(`ws error in room ${room.docId}: ${err.message}`);
    });
  }
}
