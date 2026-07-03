import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { URL } from 'url';
import { PrismaService } from '../prisma/prisma.module.js';
import { RoomManager } from './room-manager.js';
import type { NodeRole } from '@prisma/client';

const PING_INTERVAL_MS = 25_000;

interface AuthInfo {
  userId: string;
  docId: string;
  role: NodeRole;
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

      // Look up the node and resolve effective role via NodeMember hierarchy
      const role = await this.resolveNodeRole(userId, docId);
      if (!role) return null;
      return { userId, docId, role };
    } catch {
      return null;
    }
  }

  /**
   * Resolve effective role for a userId on a node by walking the parent chain.
   */
  private async resolveNodeRole(
    userId: string,
    nodeId: string
  ): Promise<NodeRole | null> {
    let currentId: string | null = nodeId;
    let best: NodeRole | null = null;

    const RANK: Record<NodeRole, number> = {
      OWNER: 4,
      EDITOR: 3,
      COMMENTER: 2,
      VIEWER: 1,
    };

    while (currentId) {
      const member = await this.prisma.nodeMember.findUnique({
        where: { nodeId_userId: { nodeId: currentId, userId } },
        select: { role: true },
      });
      if (member) {
        if (!best || RANK[member.role] > RANK[best]) {
          best = member.role;
          if (best === 'OWNER') return best; // highest possible, short-circuit
        }
      }
      // Walk up to parent
      const parentInfo = await this.prisma.node.findUnique({
        where: { id: currentId },
        select: { parentId: true, kb: { select: { ownerId: true } } },
      }) as { parentId: string | null; kb: { ownerId: string } } | null;
      if (!parentInfo) break;

      // KB owner always has OWNER on every node in the KB
      if (parentInfo.kb.ownerId === userId) {
        return 'OWNER';
      }

      currentId = parentInfo.parentId;
    }
    return best;
  }

  private async handleConnection(ws: CollabSocket, auth: AuthInfo): Promise<void> {
    const room = await this.rooms.getOrCreateRoom(auth.docId);
    await this.rooms.addConnection(room, ws, auth.role);

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
