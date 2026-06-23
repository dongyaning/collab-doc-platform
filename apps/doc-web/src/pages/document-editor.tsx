import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { documentsApi, type DocumentDetail } from '../lib/endpoints';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const SAVE_DEBOUNCE_MS = 800;

export function DocumentEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery<DocumentDetail>({
    queryKey: ['document', id],
    queryFn: () => documentsApi.get(id),
    enabled: !!id,
  });

  const [title, setTitle] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentTitle = useRef<string>('');

  const initialContent = useMemo(() => {
    if (
      !data?.content ||
      (typeof data.content === 'object' && Object.keys(data.content).length === 0)
    ) {
      return { type: 'doc', content: [] };
    }
    return data.content as object;
  }, [data?.content]);

  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: initialContent,
      onUpdate({ editor }) {
        setSaveState('dirty');
        if (contentTimer.current) clearTimeout(contentTimer.current);
        contentTimer.current = setTimeout(async () => {
          try {
            setSaveState('saving');
            await documentsApi.update(id, { content: editor.getJSON() });
            setSaveState('saved');
          } catch {
            setSaveState('error');
          }
        }, SAVE_DEBOUNCE_MS);
      },
    },
    [id, initialContent]
  );

  useEffect(() => {
    if (data) {
      setTitle(data.title);
      lastSentTitle.current = data.title;
    }
  }, [data]);

  useEffect(() => {
    return () => {
      if (titleTimer.current) clearTimeout(titleTimer.current);
      if (contentTimer.current) clearTimeout(contentTimer.current);
    };
  }, []);

  function onTitleChange(next: string) {
    setTitle(next);
    if (next === lastSentTitle.current) return;
    setSaveState('dirty');
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      try {
        setSaveState('saving');
        await documentsApi.update(id, { title: next });
        lastSentTitle.current = next;
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, SAVE_DEBOUNCE_MS);
  }

  if (isLoading) return <main style={{ padding: 24 }}>Loading…</main>;
  if (isError || !data)
    return (
      <main style={{ padding: 24 }}>
        Document not found. <Link to="/documents">Back</Link>
      </main>
    );

  return (
    <main style={{ maxWidth: 800, margin: '24px auto', fontFamily: 'system-ui' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <button onClick={() => navigate('/documents')}>← Back</button>
        <SaveStateBadge state={saveState} />
      </header>

      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Untitled"
        style={{
          width: '100%',
          padding: 8,
          fontSize: 24,
          fontWeight: 600,
          border: 'none',
          outline: 'none',
          marginBottom: 16,
        }}
      />

      <div
        style={{
          border: '1px solid #eee',
          borderRadius: 6,
          padding: 16,
          minHeight: 400,
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </main>
  );
}

function SaveStateBadge({ state }: { state: SaveState }) {
  const map: Record<SaveState, { label: string; color: string }> = {
    idle: { label: 'Ready', color: '#888' },
    dirty: { label: 'Unsaved changes', color: '#c08000' },
    saving: { label: 'Saving…', color: '#0066cc' },
    saved: { label: 'Saved', color: '#0a7' },
    error: { label: 'Save failed', color: 'crimson' },
  };
  const v = map[state];
  return <span style={{ color: v.color, fontSize: 13 }}>{v.label}</span>;
}
