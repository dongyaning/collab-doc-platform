import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  documentsApi,
  type DocumentDetail,
  type DocumentMembersResponse,
  type DocumentRole,
  type DocumentVersion,
} from '../lib/endpoints';
import { useAuthStore } from '../stores/auth.store';

type ConnState = 'connecting' | 'connected' | 'disconnected';
type AssignableRole = Exclude<DocumentRole, 'OWNER'>;

const ASSIGNABLE_ROLES: AssignableRole[] = ['EDITOR', 'COMMENTER', 'VIEWER'];
const ROLE_LABEL: Record<DocumentRole, string> = {
  OWNER: 'Owner',
  EDITOR: 'Editor',
  COMMENTER: 'Commenter',
  VIEWER: 'Viewer',
};

function canEdit(role: DocumentRole | undefined): boolean {
  return role === 'OWNER' || role === 'EDITOR';
}

const COLLAB_WS_URL =
  (import.meta.env.VITE_COLLAB_WS_URL as string | undefined) ?? 'ws://localhost:3001/collab';

const USER_COLORS = [
  '#e57373',
  '#f06292',
  '#ba68c8',
  '#9575cd',
  '#7986cb',
  '#64b5f6',
  '#4db6ac',
  '#81c784',
  '#ffb74d',
  '#a1887f',
];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return USER_COLORS[Math.abs(h) % USER_COLORS.length] ?? USER_COLORS[0]!;
}

export function DocumentEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const { data, isLoading, isError } = useQuery<DocumentDetail>({
    queryKey: ['document', id],
    queryFn: () => documentsApi.get(id),
    enabled: !!id,
  });

  // ---- Yjs doc + provider (one per docId) ----
  const ydoc = useMemo(() => new Y.Doc(), [id]);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [connState, setConnState] = useState<ConnState>('connecting');
  const [peers, setPeers] = useState<Array<{ id: number; name: string; color: string }>>([]);

  useEffect(() => {
    if (!id || !token || !user) return undefined;
    const url = new URL(COLLAB_WS_URL);
    // y-websocket appends `/<room>` to the url; we use docId as the room name
    // and pass token via the query param the server reads on upgrade.
    const p = new WebsocketProvider(url.toString(), id, ydoc, {
      params: { token, docId: id },
      connect: true,
    });
    p.awareness.setLocalStateField('user', {
      name: user.name,
      color: colorFor(user.id),
    });
    p.on('status', (e: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      setConnState(e.status);
    });
    const updatePeers = () => {
      const states = Array.from(p.awareness.getStates().entries());
      setPeers(
        states.map(([clientId, state]: [number, { user?: { name?: string; color?: string } }]) => ({
          id: clientId,
          name: state.user?.name ?? 'Anonymous',
          color: state.user?.color ?? '#888',
        }))
      );
    };
    p.awareness.on('change', updatePeers);
    updatePeers();
    setProvider(p);
    return () => {
      p.awareness.off('change', updatePeers);
      p.destroy();
      setProvider(null);
    };
  }, [id, token, user, ydoc]);

  // ---- editor (collab-aware; StarterKit history disabled) ----
  const editable = canEdit(data?.role);
  const editor = useEditor(
    {
      editable,
      extensions: [
        StarterKit.configure({ history: false }),
        Collaboration.configure({ document: ydoc }),
        ...(provider
          ? [
              CollaborationCursor.configure({
                provider,
                user: { name: user?.name ?? 'Anonymous', color: colorFor(user?.id ?? 'anon') },
              }),
            ]
          : []),
      ],
    },
    [ydoc, provider, editable]
  );

  // ---- title (still REST autosave; not part of CRDT) ----
  const [title, setTitle] = useState('');
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentTitle = useRef('');
  useEffect(() => {
    if (data) {
      setTitle(data.title);
      lastSentTitle.current = data.title;
    }
  }, [data]);
  useEffect(
    () => () => {
      if (titleTimer.current) clearTimeout(titleTimer.current);
    },
    []
  );
  function onTitleChange(next: string) {
    setTitle(next);
    if (next === lastSentTitle.current) return;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      documentsApi
        .update(id, { title: next })
        .then(() => {
          lastSentTitle.current = next;
        })
        .catch(() => {
          /* surfaced via global error handling later */
        });
    }, 800);
  }

  // ---- versions ----
  const [versionsOpen, setVersionsOpen] = useState(false);
  const versionsQuery = useQuery<DocumentVersion[]>({
    queryKey: ['document-versions', id],
    queryFn: () => documentsApi.listVersions(id),
    enabled: versionsOpen && !!id,
  });
  const [snapshotPending, setSnapshotPending] = useState(false);

  // ---- members / sharing ----
  const [shareOpen, setShareOpen] = useState(false);
  const membersQuery = useQuery<DocumentMembersResponse>({
    queryKey: ['document-members', id],
    queryFn: () => documentsApi.listMembers(id),
    enabled: shareOpen && !!id,
  });

  async function onSaveSnapshot() {
    const label = window.prompt('Label for this version (optional):') ?? undefined;
    setSnapshotPending(true);
    try {
      await documentsApi.createVersion(id, label || undefined);
      await queryClient.invalidateQueries({ queryKey: ['document-versions', id] });
    } finally {
      setSnapshotPending(false);
    }
  }

  async function onRestore(versionId: string) {
    if (!window.confirm('Restore this version? Current edits will be merged with it.')) return;
    await documentsApi.restoreVersion(id, versionId);
    await queryClient.invalidateQueries({ queryKey: ['document-versions', id] });
  }

  if (isLoading) return <main style={{ padding: 24 }}>Loading…</main>;
  if (isError || !data)
    return (
      <main style={{ padding: 24 }}>
        Document not found. <Link to="/documents">Back</Link>
      </main>
    );

  const isOwner = data.role === 'OWNER';

  return (
    <main style={{ maxWidth: 900, margin: '24px auto', fontFamily: 'system-ui' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          gap: 12,
        }}
      >
        <button onClick={() => navigate('/documents')}>← Back</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 11,
              background: '#f0f0f0',
              borderRadius: 10,
              padding: '2px 8px',
              color: '#555',
            }}
          >
            {ROLE_LABEL[data.role]}
          </span>
          <PeerList peers={peers} selfId={provider?.awareness.clientID} />
          <ConnBadge state={connState} />
          {editable ? (
            <button onClick={onSaveSnapshot} disabled={snapshotPending}>
              {snapshotPending ? 'Saving…' : 'Save version'}
            </button>
          ) : null}
          <button onClick={() => setVersionsOpen((v) => !v)}>
            {versionsOpen ? 'Hide history' : 'History'}
          </button>
          {isOwner ? (
            <button onClick={() => setShareOpen((v) => !v)}>
              {shareOpen ? 'Hide share' : 'Share'}
            </button>
          ) : null}
        </div>
      </header>

      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Untitled"
        readOnly={!editable}
        style={{
          width: '100%',
          padding: 8,
          fontSize: 24,
          fontWeight: 600,
          border: 'none',
          outline: 'none',
          marginBottom: 16,
          background: editable ? 'transparent' : '#fafafa',
        }}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: versionsOpen || shareOpen ? '1fr 280px' : '1fr',
          gap: 16,
        }}
      >
        <div
          style={{
            border: '1px solid #eee',
            borderRadius: 6,
            padding: 16,
            minHeight: 400,
            background: editable ? 'white' : '#fafafa',
          }}
        >
          <EditorContent editor={editor} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {shareOpen && isOwner ? (
            <SharePanel
              docId={id}
              data={membersQuery.data}
              loading={membersQuery.isLoading}
              currentUserId={user?.id ?? ''}
            />
          ) : null}
          {versionsOpen ? (
            <VersionsPanel
              loading={versionsQuery.isLoading}
              versions={versionsQuery.data ?? []}
              onRestore={isOwner ? onRestore : undefined}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function SharePanel({
  docId,
  data,
  loading,
  currentUserId,
}: {
  docId: string;
  data: DocumentMembersResponse | undefined;
  loading: boolean;
  currentUserId: string;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('EDITOR');
  const [error, setError] = useState<string | null>(null);
  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['document-members', docId] }),
      qc.invalidateQueries({ queryKey: ['documents'] }),
    ]);

  const addMutation = useMutation({
    mutationFn: () => documentsApi.addMember(docId, email.trim(), role),
    onSuccess: async () => {
      setEmail('');
      setError(null);
      await invalidate();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Failed to add member';
      setError(msg);
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ userId, role: r }: { userId: string; role: AssignableRole }) =>
      documentsApi.updateMemberRole(docId, userId, r),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => documentsApi.removeMember(docId, userId),
    onSuccess: invalidate,
  });

  return (
    <aside
      style={{
        border: '1px solid #eee',
        borderRadius: 6,
        padding: 12,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Share</div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) addMutation.mutate();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}
      >
        <input
          type="email"
          required
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 6 }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AssignableRole)}
            style={{ flex: 1 }}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <button type="submit" disabled={addMutation.isPending}>
            {addMutation.isPending ? '…' : 'Invite'}
          </button>
        </div>
        {error ? <div style={{ color: 'crimson', fontSize: 11 }}>{error}</div> : null}
      </form>

      {loading ? (
        <div style={{ color: '#888' }}>Loading…</div>
      ) : !data ? null : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          <li
            style={{
              padding: '6px 0',
              borderBottom: '1px solid #f3f3f3',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>
                {data.owner.name}
                {data.owner.id === currentUserId ? ' (you)' : ''}
              </div>
              <div style={{ color: '#888', fontSize: 11 }}>{data.owner.email}</div>
            </div>
            <span style={{ fontSize: 11, color: '#555' }}>Owner</span>
          </li>
          {data.members.map((m) => (
            <li
              key={m.userId}
              style={{
                padding: '6px 0',
                borderBottom: '1px solid #f3f3f3',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{m.name}</div>
                <div style={{ color: '#888', fontSize: 11 }}>{m.email}</div>
              </div>
              <select
                value={m.role}
                onChange={(e) =>
                  updateMutation.mutate({
                    userId: m.userId,
                    role: e.target.value as AssignableRole,
                  })
                }
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <button onClick={() => removeMutation.mutate(m.userId)}>×</button>
            </li>
          ))}
          {data.members.length === 0 ? (
            <li style={{ color: '#888', padding: '6px 0' }}>No collaborators yet.</li>
          ) : null}
        </ul>
      )}
    </aside>
  );
}

function VersionsPanel({
  loading,
  versions,
  onRestore,
}: {
  loading: boolean;
  versions: DocumentVersion[];
  onRestore?: (id: string) => void;
}) {
  return (
    <aside
      style={{
        border: '1px solid #eee',
        borderRadius: 6,
        padding: 12,
        fontSize: 13,
        height: 'fit-content',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>History</div>
      {loading ? (
        <div style={{ color: '#888' }}>Loading…</div>
      ) : versions.length === 0 ? (
        <div style={{ color: '#888' }}>No versions yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {versions.map((v) => (
            <li
              key={v.id}
              style={{
                padding: '6px 0',
                borderBottom: '1px solid #f3f3f3',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>
                  v{v.version}
                  {v.label ? ` · ${v.label}` : v.createdById ? '' : ' · auto'}
                </div>
                <div style={{ color: '#888', fontSize: 11 }}>
                  {new Date(v.createdAt).toLocaleString()}
                </div>
              </div>
              <button onClick={() => onRestore?.(v.id)} disabled={!onRestore}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function ConnBadge({ state }: { state: ConnState }) {
  const map: Record<ConnState, { label: string; color: string }> = {
    connecting: { label: 'Connecting…', color: '#0066cc' },
    connected: { label: 'Live', color: '#0a7' },
    disconnected: { label: 'Offline', color: '#c0392b' },
  };
  const v = map[state];
  return <span style={{ color: v.color, fontSize: 13 }}>● {v.label}</span>;
}

function PeerList({
  peers,
  selfId,
}: {
  peers: Array<{ id: number; name: string; color: string }>;
  selfId: number | undefined;
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {peers.map((p) => (
        <div
          key={p.id}
          title={p.name + (p.id === selfId ? ' (you)' : '')}
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: p.color,
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 600,
            border: p.id === selfId ? '2px solid #333' : 'none',
          }}
        >
          {p.name.slice(0, 1).toUpperCase()}
        </div>
      ))}
    </div>
  );
}
