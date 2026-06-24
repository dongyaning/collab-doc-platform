import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { documentsApi, type DocumentSummary, type DocumentRole } from '../lib/endpoints';
import { useAuthStore } from '../stores/auth.store';

const ROLE_LABEL: Record<DocumentRole, string> = {
  OWNER: 'Owner',
  EDITOR: 'Editor',
  COMMENTER: 'Commenter',
  VIEWER: 'Viewer',
};

export function DocumentListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const { data, isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: documentsApi.list,
  });

  const createMutation = useMutation({
    mutationFn: () => documentsApi.create('Untitled'),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      navigate(`/documents/${doc.id}`);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => documentsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });

  const owned = (data ?? []).filter((d) => d.role === 'OWNER');
  const shared = (data ?? []).filter((d) => d.role !== 'OWNER');

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'system-ui' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <h1>Documents</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ color: '#666' }}>{user?.email}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </header>

      <button
        onClick={() => createMutation.mutate()}
        disabled={createMutation.isPending}
        style={{ marginTop: 16, padding: '8px 16px' }}
      >
        {createMutation.isPending ? 'Creating…' : 'New document'}
      </button>

      {isLoading ? (
        <p style={{ marginTop: 24 }}>Loading…</p>
      ) : (
        <>
          <Section
            title="My documents"
            docs={owned}
            empty="No documents yet."
            onDelete={(id, title) => {
              if (confirm(`Delete "${title}"?`)) removeMutation.mutate(id);
            }}
            deletePending={removeMutation.isPending}
          />
          <Section
            title="Shared with me"
            docs={shared}
            empty="Nothing shared with you yet."
            showOwner
          />
        </>
      )}
    </main>
  );
}

function Section({
  title,
  docs,
  empty,
  showOwner,
  onDelete,
  deletePending,
}: {
  title: string;
  docs: DocumentSummary[];
  empty: string;
  showOwner?: boolean;
  onDelete?: (id: string, title: string) => void;
  deletePending?: boolean;
}) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 14, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </h2>
      <ul style={{ padding: 0, listStyle: 'none' }}>
        {docs.length === 0 ? (
          <li style={{ color: '#888' }}>{empty}</li>
        ) : (
          docs.map((doc) => (
            <li
              key={doc.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 0',
                borderBottom: '1px solid #eee',
                gap: 12,
              }}
            >
              <Link to={`/documents/${doc.id}`} style={{ flex: 1, minWidth: 0 }}>
                <strong>{doc.title || 'Untitled'}</strong>
                <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
                  {showOwner ? `Shared by ${doc.owner.name} · ` : ''}
                  {new Date(doc.updatedAt).toLocaleString()}
                </div>
              </Link>
              <span
                style={{
                  fontSize: 11,
                  background: '#f0f0f0',
                  borderRadius: 10,
                  padding: '2px 8px',
                  color: '#555',
                }}
              >
                {ROLE_LABEL[doc.role]}
              </span>
              {onDelete ? (
                <button onClick={() => onDelete(doc.id, doc.title)} disabled={deletePending}>
                  Delete
                </button>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
