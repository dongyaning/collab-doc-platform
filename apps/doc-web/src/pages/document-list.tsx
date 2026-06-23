import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { documentsApi } from '../lib/endpoints';
import { useAuthStore } from '../stores/auth.store';

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

      <ul style={{ marginTop: 24, padding: 0, listStyle: 'none' }}>
        {isLoading && <li>Loading…</li>}
        {data?.length === 0 && <li style={{ color: '#888' }}>No documents yet.</li>}
        {data?.map((doc) => (
          <li
            key={doc.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 0',
              borderBottom: '1px solid #eee',
            }}
          >
            <Link to={`/documents/${doc.id}`} style={{ flex: 1 }}>
              <strong>{doc.title || 'Untitled'}</strong>
              <span style={{ marginLeft: 12, color: '#888', fontSize: 12 }}>
                {new Date(doc.updatedAt).toLocaleString()}
              </span>
            </Link>
            <button
              onClick={() => {
                if (confirm(`Delete "${doc.title}"?`)) removeMutation.mutate(doc.id);
              }}
              disabled={removeMutation.isPending}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
