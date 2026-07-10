import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import dayjs from 'dayjs';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import LinkExtension from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';
import { ResizableImage, ImageNodeView } from '../../extensions/image';
import { WidgetExtension, WidgetNodeView } from '../../extensions/widget';
import { registerPresetWidgets } from '../../extensions/widget/presets';
import { EditorToolbar } from './editor-toolbar';
import { RemoteNodeCursors } from './remote-node-cursors';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  App as AntdApp,
  Avatar,
  Badge,
  Button,
  Drawer,
  Empty,
  Input,
  Layout,
  List,
  Modal,
  Popover,
  Result,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tree,
  Typography,
  type TreeProps,
} from 'antd';
import {
  FileOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  MailOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SaveOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import {
  knowledgeBasesApi,
  nodesApi,
  type AccessRequest,
  type AccessRequestScope,
  type NodeVersion,
  type NodeVersionDetail,
  type NodeRole,
  type NodeMembersResponse,
} from '../../lib/endpoints';
import {
  clearContext,
  measure,
  setContext,
  startSpan,
  track,
  type MonitorSpan,
} from '@wiseflow/monitor-sdk';
import { useAuthStore } from '../../stores/auth.store';
import type { TreeNode, KnowledgeBaseTree } from '@wiseflow/shared';
import styles from './index.module.less';
import { useDocLoading } from './use-doc-loading';

const lowlight = createLowlight(common);
registerPresetWidgets();
const { Sider, Content } = Layout;
const { Text } = Typography;

type ConnState = 'connecting' | 'connected' | 'disconnected';
type AssignableRole = Exclude<NodeRole, 'OWNER'>;

type ApiError = {
  response?: {
    status?: number;
    data?: {
      code?: string;
      message?: string;
    };
  };
};

const ASSIGNABLE_ROLES: AssignableRole[] = ['EDITOR', 'COMMENTER', 'VIEWER'];
const ROLE_LABEL: Record<NodeRole, string> = {
  OWNER: 'Owner',
  EDITOR: 'Editor',
  COMMENTER: 'Commenter',
  VIEWER: 'Viewer',
};
const ROLE_COLOR: Record<NodeRole, string> = {
  OWNER: 'blue',
  EDITOR: 'green',
  COMMENTER: 'gold',
  VIEWER: 'default',
};

function canEdit(role: NodeRole | undefined): boolean {
  return role === 'OWNER' || role === 'EDITOR';
}

function isKnowledgeBaseAccessDenied(error: unknown): boolean {
  const apiError = error as ApiError;
  return apiError.response?.status === 403 && apiError.response.data?.code === 'KB_ACCESS_DENIED';
}

function accessErrorMessage(error: unknown, fallback: string): string {
  return (error as ApiError).response?.data?.message ?? fallback;
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

function avatarFallback(name: string | undefined): string {
  return (name?.trim().slice(0, 1) || 'A').toUpperCase();
}

function buildCursorLabel(user: {
  name: string;
  color: string;
  avatarUrl?: string;
  cursorKey?: string;
}): HTMLElement {
  const cursor = document.createElement('span');
  cursor.classList.add('collaboration-cursor__caret');
  cursor.setAttribute('style', `border-color: ${user.color}`);
  if (user.cursorKey) {
    cursor.dataset.cursorKey = user.cursorKey;
  }
  const label = document.createElement('div');
  label.classList.add('collaboration-cursor__label');
  label.setAttribute('style', `background-color: ${user.color}`);
  label.textContent = avatarFallback(user.name);
  if (user.avatarUrl) {
    const img = document.createElement('img');
    img.src = user.avatarUrl;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
      img.remove();
      label.textContent = avatarFallback(user.name);
    };
    label.textContent = '';
    label.appendChild(img);
  }
  cursor.appendChild(label);
  return cursor;
}
function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return USER_COLORS[Math.abs(h) % USER_COLORS.length] ?? USER_COLORS[0]!;
}

function normalizeDocContent(content: JSONContent): JSONContent {
  return normalizeDocNode(content) ?? { type: 'doc', content: [] };
}

function normalizeDocNode(node: JSONContent, parentType?: string): JSONContent | null {
  if (node.type === 'text' && node.text === '') {
    return null;
  }

  const children = node.content?.flatMap((child) => {
    const normalized = normalizeDocNode(child, node.type);
    return normalized ? [normalized] : [];
  });

  const next: JSONContent = { ...node };
  if (children) {
    if (children.length > 0) {
      next.content = children;
    } else {
      delete next.content;
    }
  }

  if (next.type === 'image' && parentType === 'doc') {
    const attrs = { ...(next.attrs ?? {}) };
    delete attrs.textAlign;
    delete attrs.layoutMode;
    delete attrs.floatSide;
    return {
      type: 'paragraph',
      attrs: { textAlign: node.attrs?.textAlign ?? 'center' },
      content: [{ ...next, attrs }],
    };
  }

  return next;
}

export function KnowledgeBaseViewPage() {
  const { kbId, nodeId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { modal } = AntdApp.useApp();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [isEditing, setIsEditing] = useState(false);
  const docOpenSpanRef = useRef<MonitorSpan | null>(null);
  const editorReadyRef = useRef<string | null>(null);
  const contentLoadStartRef = useRef<number | null>(null);
  const collabConnectStartRef = useRef<number | null>(null);
  const paperRef = useRef<HTMLDivElement>(null);

  const treeQuery = useQuery<KnowledgeBaseTree>({
    queryKey: ['kb-tree', kbId],
    queryFn: () => knowledgeBasesApi.getTree(kbId!),
    enabled: !!kbId,
  });
  const accessDenied = treeQuery.isError && isKnowledgeBaseAccessDenied(treeQuery.error);

  const myAccessRequestQuery = useQuery<AccessRequest | null>({
    queryKey: ['kb-access-request-my', kbId],
    queryFn: () => knowledgeBasesApi.getMyAccessRequest(kbId!),
    enabled: !!kbId && accessDenied,
  });

  const activeDoc = useQuery({
    queryKey: ['node', nodeId],
    queryFn: () => nodesApi.get(nodeId!),
    enabled: !!nodeId,
  });

  // resolve role — prefer node-level role, fall back to KB-level role
  const userRole: NodeRole | undefined =
    (activeDoc.data?.role as NodeRole | undefined) ??
    (treeQuery.data?.kb?.role as NodeRole | undefined);
  const canUserEdit = canEdit(userRole);

  useEffect(() => {
    if (!kbId || !treeQuery.isSuccess) {
      return;
    }
    docOpenSpanRef.current?.mark('kb_tree_loaded', { nodeCount: treeQuery.data.nodes.length });
  }, [kbId, treeQuery.data?.nodes.length, treeQuery.isSuccess]);

  useEffect(() => {
    if (!nodeId || !activeDoc.isSuccess) {
      return;
    }
    docOpenSpanRef.current?.mark('node_detail_loaded', { role: activeDoc.data.role });
  }, [activeDoc.data?.role, activeDoc.isSuccess, nodeId]);

  useEffect(() => {
    if (treeQuery.isError) {
      track('business', 'kb_tree_load_failed', {
        docId: nodeId,
        errorMessage: accessErrorMessage(treeQuery.error, 'Knowledge base tree load failed'),
        metadata: { kbId },
        status: 'error',
      });
    }
  }, [kbId, nodeId, treeQuery.error, treeQuery.isError]);

  useEffect(() => {
    if (activeDoc.isError) {
      track('business', 'node_detail_load_failed', {
        docId: nodeId,
        errorMessage: accessErrorMessage(activeDoc.error, 'Node detail load failed'),
        status: 'error',
      });
    }
  }, [activeDoc.error, activeDoc.isError, nodeId]);
  const isOwner = userRole === 'OWNER';
  const requestedMode = searchParams.get('mode');
  const editable = canUserEdit && isEditing;

  useEffect(() => {
    if (!nodeId) {
      clearContext(['docId']);
      docOpenSpanRef.current = null;
      return undefined;
    }
    setContext({ docId: nodeId });
    const span = startSpan('doc_open', { docId: nodeId, metadata: { kbId } });
    docOpenSpanRef.current = span;
    track('business', 'doc_route_enter', {
      docId: nodeId,
      metadata: { kbId },
      traceId: span.traceId,
    });
    editorReadyRef.current = null;
    contentLoadStartRef.current = null;
    collabConnectStartRef.current = null;
    return () => {
      if (docOpenSpanRef.current === span) {
        docOpenSpanRef.current = null;
      }
      clearContext(['docId']);
    };
  }, [kbId, nodeId]);

  const setModeParam = useCallback(
    (mode: 'read' | 'edit') => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('mode', mode);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const enterEditMode = useCallback(() => {
    if (!canUserEdit) {
      track('business', 'enter_edit_mode_blocked', {
        docId: nodeId,
        metadata: { role: userRole },
        status: 'error',
      });
      return;
    }
    track('business', 'enter_edit_mode', {
      docId: nodeId,
      metadata: { role: userRole },
      traceId: docOpenSpanRef.current?.traceId,
    });
    setIsEditing(true);
    setModeParam('edit');
  }, [canUserEdit, nodeId, setModeParam, userRole]);

  // ---- tree helpers ----
  function buildTreeData(nodes: TreeNode[]): TreeProps['treeData'] {
    return nodes.map((n) => ({
      key: n.id,
      title: n.title || 'Untitled',
      icon: n.type === 'FOLDER' ? <FolderOutlined /> : <FileOutlined />,
      isLeaf: n.type === 'DOC',
      children: n.children.length > 0 ? buildTreeData(n.children) : undefined,
    }));
  }

  const onSelect: TreeProps['onSelect'] = (keys) => {
    if (keys.length > 0 && keys[0] !== nodeId) {
      const query = searchParams.toString();
      navigate(`/kb/${kbId}/${keys[0]}${query ? `?${query}` : ''}`);
    }
  };

  // ---- drag & drop move ----
  const moveMutation = useMutation({
    mutationFn: (data: { id: string; parentId: string | null; index: number }) =>
      nodesApi.move(data.id, { parentId: data.parentId, index: data.index }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-tree', kbId] });
    },
  });

  const onDrop: TreeProps['onDrop'] = (info) => {
    const dragKey = String(info.dragNode.key);
    const dropKey = String(info.node.key);
    const dropToGap = info.dropToGap;
    const dropPosition = info.dropPosition;

    const tree = treeQuery.data?.nodes ?? [];
    const { parentId, index } = computeDropTarget(tree, dragKey, dropKey, dropToGap, dropPosition);

    if (!dropToGap) {
      const targetNode = findNode(tree, dropKey);
      if (targetNode && targetNode.type !== 'FOLDER') return;
    }

    moveMutation.mutate({ id: dragKey, parentId, index });
  };

  // ---- create node ----
  const createMutation = useMutation({
    mutationFn: (data: { title?: string; type?: string; parentId?: string | null }) =>
      nodesApi.create({ kbId: kbId!, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-tree', kbId] });
    },
  });

  // ---- create node ----
  function onCreateChild(parentId: string | null) {
    modal.confirm({
      title: parentId ? 'New document in folder' : 'New document',
      content: (
        <div style={{ marginTop: 8 }}>
          <Input
            placeholder="Document title"
            onPressEnter={(e) => {
              const val = (e.target as HTMLInputElement).value.trim();
              if (val) {
                Modal.destroyAll();
                createMutation.mutate({ title: val, parentId });
              }
            }}
          />
        </div>
      ),
      okText: 'Create',
      onOk: (close) => {
        const input = document.querySelector(
          '.ant-modal-confirm-body-wrapper input'
        ) as HTMLInputElement;
        const val = input?.value?.trim();
        if (val) {
          createMutation.mutate({ title: val, parentId });
        }
        close();
      },
    });
  }

  function onCreateFolder() {
    modal.confirm({
      title: 'New folder',
      content: (
        <div style={{ marginTop: 8 }}>
          <Input
            placeholder="Folder name"
            onPressEnter={(e) => {
              const val = (e.target as HTMLInputElement).value.trim();
              if (val) {
                Modal.destroyAll();
                createMutation.mutate({ title: val, type: 'FOLDER', parentId: null });
              }
            }}
          />
        </div>
      ),
      okText: 'Create',
      onOk: (close) => {
        const input = document.querySelector(
          '.ant-modal-confirm-body-wrapper input'
        ) as HTMLInputElement;
        const val = input?.value?.trim();
        if (val) {
          createMutation.mutate({ title: val, type: 'FOLDER', parentId: null });
        }
        close();
      },
    });
  }

  // ---- Yjs editor ----
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ydoc = useMemo(() => new Y.Doc(), [nodeId]);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [connState, setConnState] = useState<ConnState>('connecting');
  const [peers, setPeers] = useState<
    Array<{ id: number; name: string; color: string; email?: string; avatarUrl?: string }>
  >([]);

  // Fetch document content for reading mode via REST
  const contentQuery = useQuery({
    queryKey: ['node-content', nodeId],
    queryFn: async () => {
      contentLoadStartRef.current = performance.now();
      const content = normalizeDocContent(await nodesApi.getContent(nodeId!));
      const duration = Math.round(performance.now() - contentLoadStartRef.current);
      measure('doc_content_loaded', duration, {
        docId: nodeId,
        eventType: 'business',
        traceId: docOpenSpanRef.current?.traceId,
      });
      docOpenSpanRef.current?.mark('doc_content_loaded');
      return content;
    },
    enabled: !!nodeId && !isEditing,
  });

  useEffect(() => {
    if (contentQuery.isError) {
      track('business', 'doc_content_load_failed', {
        docId: nodeId,
        errorMessage: accessErrorMessage(contentQuery.error, 'Document content load failed'),
        status: 'error',
        traceId: docOpenSpanRef.current?.traceId,
      });
    }
  }, [contentQuery.error, contentQuery.isError, nodeId]);

  useEffect(() => {
    setIsEditing(canUserEdit && requestedMode === 'edit');
  }, [canUserEdit, nodeId, requestedMode]);

  useEffect(() => {
    if (requestedMode === 'edit' && userRole && !canUserEdit) {
      setModeParam('read');
    }
  }, [canUserEdit, requestedMode, setModeParam, userRole]);

  useEffect(() => {
    if (!nodeId || !token || !user || !isEditing) {
      return undefined;
    }
    const url = new URL(COLLAB_WS_URL);
    collabConnectStartRef.current = performance.now();
    track('business', 'collab_provider_create', {
      docId: nodeId,
      metadata: { endpoint: url.origin },
      traceId: docOpenSpanRef.current?.traceId,
    });
    const p = new WebsocketProvider(url.toString(), nodeId, ydoc, {
      params: { token, docId: nodeId },
      connect: true,
    });
    p.awareness.setLocalStateField('user', {
      name: user.name,
      color: colorFor(user.id),
      email: user.email,
      avatarUrl: user.avatarUrl,
    });

    const onStatus = (e: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      setConnState(e.status);
      const duration = collabConnectStartRef.current
        ? Math.round(performance.now() - collabConnectStartRef.current)
        : undefined;
      track('business', 'collab_status_change', {
        docId: nodeId,
        duration,
        metadata: { status: e.status },
        status: e.status === 'connected' ? 'ok' : undefined,
        traceId: docOpenSpanRef.current?.traceId,
      });
      if (e.status === 'connected' && duration !== undefined) {
        measure('collab_connected', duration, {
          docId: nodeId,
          eventType: 'business',
          traceId: docOpenSpanRef.current?.traceId,
        });
        docOpenSpanRef.current?.mark('collab_connected');
      }
    };
    p.on('status', onStatus);
    const updatePeers = () => {
      const states = Array.from(p.awareness.getStates().entries());
      track('business', 'collab_awareness_change', {
        docId: nodeId,
        metadata: { peerCount: states.length },
        traceId: docOpenSpanRef.current?.traceId,
      });
      setPeers(
        states.map(
          ([clientId, state]: [
            number,
            { user?: { name?: string; color?: string; email?: string; avatarUrl?: string } },
          ]) => ({
            id: clientId,
            name: state.user?.name ?? 'Anonymous',
            color: state.user?.color ?? '#888',
            email: state.user?.email,
            avatarUrl: state.user?.avatarUrl,
          })
        )
      );
    };
    p.awareness.on('change', updatePeers);
    updatePeers();
    setProvider(p);
    return () => {
      track('business', 'collab_provider_destroy', {
        docId: nodeId,
        metadata: { peerCount: p.awareness.getStates().size },
        traceId: docOpenSpanRef.current?.traceId,
      });
      p.off('status', onStatus);
      p.awareness.off('change', updatePeers);
      p.destroy();
      setProvider(null);
    };
  }, [nodeId, token, user, ydoc, isEditing]);

  const editor = useEditor(
    {
      editable,
      autofocus: true,
      content: contentQuery.data ?? undefined,
      onCreate: () => {
        const mode = editable ? 'edit' : 'read';
        const source = provider ? 'collab' : 'static';
        const key = `${nodeId ?? 'none'}:${mode}:${source}`;
        if (editorReadyRef.current === key) {
          return;
        }
        editorReadyRef.current = key;
        measure('editor_ready', 0, {
          docId: nodeId,
          eventType: 'business',
          metadata: { editable, hasProvider: Boolean(provider) },
          traceId: docOpenSpanRef.current?.traceId,
        });
        docOpenSpanRef.current?.mark('editor_ready', { editable, hasProvider: Boolean(provider) });
        docOpenSpanRef.current?.end({ editable, hasProvider: Boolean(provider) });
      },
      extensions: [
        StarterKit.configure({ history: false }),
        CodeBlockLowlight.configure({ lowlight }),
        ResizableImage.extend({
          addNodeView() {
            return ReactNodeViewRenderer(ImageNodeView);
          },
        }),
        WidgetExtension.extend({
          addNodeView() {
            return ReactNodeViewRenderer(WidgetNodeView);
          },
        }),
        TextAlign.configure({
          types: ['heading', 'paragraph'],
          alignments: ['left', 'center', 'right'],
          defaultAlignment: 'left',
        }),
        Underline,
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        LinkExtension.configure({
          openOnClick: true,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        }),
        Placeholder.configure({ placeholder: 'Start writing…' }),
        ...(provider ? [Collaboration.configure({ document: ydoc })] : []),
        ...(provider
          ? [
              CollaborationCursor.configure({
                provider,
                user: {
                  name: user?.name ?? 'A',
                  color: colorFor(user?.id ?? 'anon'),
                  email: user?.email,
                  avatarUrl: user?.avatarUrl,
                  cursorKey: user?.id ?? user?.email ?? user?.name ?? 'anon',
                },
                render: buildCursorLabel,
              }),
            ]
          : []),
      ],
    },
    [ydoc, provider, editable, contentQuery.data]
  );

  useEffect(() => {
    if (!editor || !contentQuery.data || provider || isEditing) {
      return;
    }
    editor.commands.setContent(contentQuery.data);
  }, [editor, contentQuery.data, provider, isEditing]);

  const exitEditMode = useCallback(() => {
    track('business', 'exit_edit_mode', {
      docId: nodeId,
      metadata: { hasEditor: Boolean(editor) },
      traceId: docOpenSpanRef.current?.traceId,
    });
    if (nodeId && editor) {
      queryClient.setQueryData(['node-content', nodeId], normalizeDocContent(editor.getJSON()));
      void queryClient.invalidateQueries({ queryKey: ['node-content', nodeId] });
    }
    setIsEditing(false);
    setModeParam('read');
  }, [editor, nodeId, queryClient, setModeParam]);

  // Cmd+E toggles edit mode for users with edit permission
  useEffect(() => {
    if (!canUserEdit) {
      return undefined;
    }
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        if (isEditing) {
          exitEditMode();
        } else {
          enterEditMode();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canUserEdit, enterEditMode, isEditing, exitEditMode]);

  // ---- title autosave ----
  const [title, setTitle] = useState('');
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentTitle = useRef('');
  useEffect(() => {
    if (activeDoc.data) {
      setTitle(activeDoc.data.title);
      lastSentTitle.current = activeDoc.data.title;
    }
  }, [activeDoc.data]);
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
      nodesApi
        .update(nodeId!, { title: next })
        .then(() => {
          lastSentTitle.current = next;
          queryClient.invalidateQueries({ queryKey: ['kb-tree', kbId] });
        })
        .catch(() => {});
    }, 800);
  }

  // ---- versions ----
  const [versionsOpen, setVersionsOpen] = useState(false);
  const versionsQuery = useQuery<NodeVersion[]>({
    queryKey: ['node-versions', nodeId],
    queryFn: () => nodesApi.listVersions(nodeId!),
    enabled: versionsOpen && !!nodeId,
  });
  const [snapshotPending, setSnapshotPending] = useState(false);

  // ---- node-level members (sharing) ----
  const [shareOpen, setShareOpen] = useState(false);
  const membersQuery = useQuery<NodeMembersResponse>({
    queryKey: ['node-members', nodeId],
    queryFn: () => nodesApi.listMembers(nodeId!),
    enabled: shareOpen && !!nodeId,
  });

  // ---- KB-level members ----
  const [kbShareOpen, setKbShareOpen] = useState(false);
  const kbMembersQuery = useQuery<NodeMembersResponse>({
    queryKey: ['kb-members', kbId],
    queryFn: () => knowledgeBasesApi.listMembers(kbId!),
    enabled: kbShareOpen && !!kbId,
  });
  const accessRequestsQuery = useQuery<AccessRequest[]>({
    queryKey: ['kb-access-requests', kbId],
    queryFn: () => knowledgeBasesApi.listAccessRequests(kbId!),
    enabled: kbShareOpen && !!kbId && isOwner,
  });

  function onSaveSnapshot() {
    let label = '';
    modal.confirm({
      title: 'Save version',
      content: (
        <Input
          placeholder="Label for this version (optional)"
          onChange={(e) => {
            label = e.target.value;
          }}
        />
      ),
      okText: 'Save',
      onOk: async () => {
        setSnapshotPending(true);
        try {
          await nodesApi.createVersion(nodeId!, label || undefined);
          await queryClient.invalidateQueries({ queryKey: ['node-versions', nodeId] });
        } finally {
          setSnapshotPending(false);
        }
      },
    });
  }

  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const versionPreviewQuery = useQuery<NodeVersionDetail>({
    queryKey: ['node-version', nodeId, previewVersionId],
    queryFn: () => nodesApi.getVersion(nodeId!, previewVersionId!),
    enabled: !!nodeId && !!previewVersionId,
  });

  const loading = useDocLoading({
    activeDocLoading: activeDoc.isLoading,
    treeLoading: treeQuery.isLoading,
    movePending: moveMutation.isPending,
    createPending: createMutation.isPending,
    snapshotPending,
  });

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const updateTime: string = useMemo(() => {
    if (!activeDoc?.data) return '-';

    const activeTime = dayjs(activeDoc.data.updatedAt);
    const now = dayjs();

    const diffMinutes = now.diff(activeTime, 'minute');
    if (diffMinutes < 1) {
      return 'just now';
    } else if (now.diff(activeTime, 'hour') < 1) {
      return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
    } else if (now.diff(activeTime, 'day') < 1) {
      return activeTime.format('HH:mm:ss');
    } else if (now.diff(activeTime, 'day') === 1) {
      return `Yesterday at ${activeTime.format('HH:mm:ss')}`;
    } else {
      return activeTime.format('YYYY-MM-DD HH:mm');
    }
    // tick drives periodic refresh, activeDoc drives data update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc, tick]);

  const [siderCollapsed, setSiderCollapsed] = useState(false);

  // ---- loading / error states ----
  if (treeQuery.isLoading) {
    return (
      <Layout className={styles.layout}>
        <Content className={styles.contentArea}>
          <div className={styles.loading}>
            <Spin size="large" />
          </div>
        </Content>
      </Layout>
    );
  }

  if (accessDenied) {
    return (
      <Layout className={styles.layout}>
        <Content className={styles.contentArea}>
          <AccessRequestPanel
            kbId={kbId!}
            nodeId={nodeId}
            request={myAccessRequestQuery.data}
            loading={myAccessRequestQuery.isLoading}
          />
        </Content>
      </Layout>
    );
  }

  if (treeQuery.isError || !treeQuery.data) {
    return (
      <Layout className={styles.layout}>
        <Content className={styles.contentArea}>
          <div className={styles.emptyState}>
            <Result status="error" title="Failed to load knowledge base" />
          </div>
        </Content>
      </Layout>
    );
  }

  return (
    <Layout className={styles.layout}>
      <Sider
        width={280}
        collapsedWidth={0}
        breakpoint="md"
        className={styles.sider}
        collapsible
        collapsed={siderCollapsed}
        onBreakpoint={(broken) => {
          if (broken) {
            setSiderCollapsed(true);
          }
        }}
        onCollapse={setSiderCollapsed}
        trigger={null}
      >
        <div className={styles.siderInner}>
          <div className={styles.siderTopBar}>
            {!siderCollapsed && (
              <Text className={styles.kbTitle} ellipsis>
                {treeQuery.data.kb.title}
              </Text>
            )}
            <div className={styles.siderCollapseBtn}>
              <Button
                type="text"
                size="small"
                icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setSiderCollapsed(!siderCollapsed)}
              />
            </div>
            {!siderCollapsed && (
              <>
                {isOwner ? (
                  <Button
                    type="text"
                    size="small"
                    icon={<TeamOutlined />}
                    className={styles.addBtn}
                    onClick={() => setKbShareOpen(true)}
                  />
                ) : null}
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined />}
                  className={styles.addBtn}
                  onClick={() => onCreateChild(null)}
                />
                <Button
                  type="text"
                  size="small"
                  icon={<FolderOpenOutlined />}
                  className={styles.addBtn}
                  onClick={onCreateFolder}
                />
              </>
            )}
          </div>
          {!siderCollapsed && (
            <div className={styles.tree}>
              {loading.isCreating ? (
                <div className={styles.treeLoading}>
                  <Spin size="small" />
                </div>
              ) : null}
              <Tree
                treeData={buildTreeData(treeQuery.data.nodes)}
                onSelect={onSelect}
                defaultExpandAll
                selectedKeys={nodeId ? [nodeId] : []}
                showIcon
                draggable
                blockNode
                onDrop={onDrop}
              />
            </div>
          )}
        </div>
      </Sider>

      <Content className={styles.contentArea}>
        <Button
          aria-label="Open document tree"
          className={styles.mobileSiderTrigger}
          icon={<MenuUnfoldOutlined />}
          onClick={() => setSiderCollapsed(false)}
          type="text"
        />
        {loading.isDocLoading ? (
          <div className={styles.emptyState}>
            <Spin size="large" />
          </div>
        ) : !nodeId || !activeDoc.data ? (
          <div className={styles.emptyState}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Select a document from the tree to start editing"
            />
          </div>
        ) : activeDoc.isError ? (
          <div className={styles.emptyState}>
            <Result
              status="error"
              title="Failed to load document"
              extra={<Button onClick={() => navigate(`/kb/${kbId}`)}>Go back</Button>}
            />
          </div>
        ) : (
          <div className={styles.editorPage}>
            <div className={styles.toolbar}>
              <Space>
                <Tag color={ROLE_COLOR[userRole ?? 'VIEWER']}>
                  {ROLE_LABEL[userRole ?? 'VIEWER']}
                </Tag>
                {isEditing ? (
                  <>
                    <PeerList peers={peers} selfId={provider?.awareness.clientID} />
                    <ConnBadge state={connState} />
                  </>
                ) : null}
              </Space>
              <Space wrap>
                {canUserEdit ? (
                  isEditing ? (
                    <Button onClick={exitEditMode}>Exit edit</Button>
                  ) : (
                    <Button type="primary" onClick={enterEditMode}>
                      Edit
                    </Button>
                  )
                ) : null}
                {isEditing ? (
                  <Button
                    icon={<SaveOutlined />}
                    onClick={onSaveSnapshot}
                    loading={snapshotPending}
                  >
                    Save version
                  </Button>
                ) : null}
                <Button icon={<HistoryOutlined />} onClick={() => setVersionsOpen(true)}>
                  History
                </Button>
                {isOwner ? (
                  <Button icon={<TeamOutlined />} onClick={() => setShareOpen(true)}>
                    Share
                  </Button>
                ) : null}
              </Space>
            </div>

            {isEditing ? <EditorToolbar editor={editor} editable={editable} /> : null}

            <div className={styles.paper} ref={paperRef}>
              <RemoteNodeCursors editor={editor} provider={provider} containerRef={paperRef} />
              <span className={styles.updateTime}>recently update: {updateTime}</span>
              <div className={styles.titleRow}>
                <Input
                  className={styles.titleInput}
                  value={title}
                  onChange={(e) => onTitleChange(e.target.value)}
                  placeholder="Untitled"
                  readOnly={!editable}
                  variant="borderless"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && editor) {
                      e.preventDefault();
                      editor.commands.focus('start');
                    }
                  }}
                />
              </div>
              <div
                className={styles.editorSurface}
                onMouseDown={(e) => {
                  if (!editable || !editor) {
                    return;
                  }

                  const target = e.target as HTMLElement;
                  const editorDom = editor.view.dom;
                  if (editorDom.contains(target) && target !== editorDom) {
                    return;
                  }

                  e.preventDefault();
                  editor.commands.focus('end');
                }}
              >
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>
        )}

        {/* Node-level share: shares only this document/folder */}
        <Drawer
          title={`Share: ${activeDoc.data?.title || 'Untitled'}`}
          open={shareOpen && !!nodeId && isOwner}
          onClose={() => setShareOpen(false)}
          size={360}
        >
          <SharePanel
            nodeId={nodeId!}
            data={membersQuery.data}
            loading={membersQuery.isLoading}
            currentUserId={user?.id ?? ''}
          />
        </Drawer>

        {/* KB-level share: shares the entire knowledge base */}
        <Drawer
          title="Knowledge base members"
          open={kbShareOpen}
          onClose={() => setKbShareOpen(false)}
          size={360}
        >
          <KbSharePanel
            kbId={kbId!}
            data={kbMembersQuery.data}
            loading={kbMembersQuery.isLoading}
            currentUserId={user?.id ?? ''}
            accessRequests={accessRequestsQuery.data ?? []}
            accessRequestsLoading={accessRequestsQuery.isLoading}
          />
        </Drawer>

        <Drawer
          title="History"
          open={versionsOpen}
          onClose={() => setVersionsOpen(false)}
          size={360}
        >
          <VersionsPanel
            loading={versionsQuery.isLoading}
            versions={versionsQuery.data ?? []}
            selectedId={previewVersionId}
            onSelect={setPreviewVersionId}
          />
        </Drawer>

        <VersionPreviewModal
          open={!!previewVersionId}
          loading={versionPreviewQuery.isLoading}
          version={versionPreviewQuery.data}
          onClose={() => setPreviewVersionId(null)}
        />
      </Content>
    </Layout>
  );
}

function AccessRequestPanel({
  kbId,
  nodeId,
  request,
  loading,
}: {
  kbId: string;
  nodeId?: string;
  request: AccessRequest | null | undefined;
  loading: boolean;
}) {
  const { message: messageApi } = AntdApp.useApp();
  const qc = useQueryClient();
  const [scope, setScope] = useState<AccessRequestScope>(nodeId ? 'NODE' : 'KNOWLEDGE_BASE');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      knowledgeBasesApi.createAccessRequest(kbId, {
        scope,
        nodeId: scope === 'NODE' ? nodeId : undefined,
        requestedRole: 'VIEWER',
        message: message.trim() || undefined,
      }),
    onSuccess: async () => {
      setError(null);
      messageApi.success('Access request submitted');
      await qc.invalidateQueries({ queryKey: ['kb-access-request-my', kbId] });
    },
    onError: (err: unknown) => {
      setError(accessErrorMessage(err, 'Failed to submit access request'));
    },
  });

  const isPending = request?.status === 'PENDING';
  const isApproved = request?.status === 'APPROVED';
  const isRejected = request?.status === 'REJECTED';
  const disableSubmit =
    loading || createMutation.isPending || (scope === 'NODE' && !nodeId) || isPending;

  return (
    <div className={styles.accessRequestShell}>
      <div className={styles.accessRequestBox}>
        <Result
          status={isApproved ? 'success' : '403'}
          title={isApproved ? 'Access granted' : 'Access required'}
          subTitle={
            isPending
              ? 'Your request has been sent. The owner can approve it from the knowledge base members panel.'
              : isRejected
                ? 'Your previous request was rejected. You can submit a new request.'
                : 'Ask the owner for permission to view this knowledge base or document.'
          }
          extra={
            isApproved ? (
              <Button type="primary" onClick={() => window.location.reload()}>
                Reload
              </Button>
            ) : null
          }
        />
        {!isApproved ? (
          <div className={styles.accessRequestForm}>
            <Text className={styles.formLabel}>Access scope</Text>
            <Segmented<AccessRequestScope>
              block
              value={scope}
              onChange={setScope}
              options={[
                ...(nodeId ? [{ label: 'Current document', value: 'NODE' as const }] : []),
                { label: 'Entire knowledge base', value: 'KNOWLEDGE_BASE' as const },
              ]}
            />
            <Input.TextArea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Reason for access (optional)"
              autoSize={{ minRows: 3, maxRows: 5 }}
              maxLength={500}
              showCount
            />
            {error ? <Text type="danger">{error}</Text> : null}
            <Button
              type="primary"
              block
              disabled={disableSubmit}
              loading={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {isPending ? 'Request pending' : 'Request access'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---- Node-level Share Panel (shares a specific node) ----

function SharePanel({
  nodeId,
  data,
  loading,
  currentUserId,
}: {
  nodeId: string;
  data: NodeMembersResponse | undefined;
  loading: boolean;
  currentUserId: string;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('EDITOR');
  const [includeChildren, setIncludeChildren] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalidate = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ['node-members', nodeId] })]);

  const addMutation = useMutation({
    mutationFn: () => nodesApi.addMember(nodeId, email.trim(), role, includeChildren),
    onSuccess: async () => {
      setEmail('');
      setError(null);
      setIncludeChildren(false);
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
    mutationFn: ({
      userId,
      role: r,
      includeChildren: ic,
    }: {
      userId: string;
      role: AssignableRole;
      includeChildren?: boolean;
    }) => nodesApi.updateMemberRole(nodeId, userId, r, ic),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => nodesApi.removeMember(nodeId, userId),
    onSuccess: invalidate,
  });

  return (
    <div>
      <Space.Compact className={styles.inviteInputGroup}>
        <Input
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onPressEnter={() => {
            if (email.trim()) addMutation.mutate();
          }}
        />
        <Select<AssignableRole>
          value={role}
          onChange={setRole}
          className={styles.inviteRoleSelect}
          options={ASSIGNABLE_ROLES.map((r) => ({
            value: r,
            label: ROLE_LABEL[r],
          }))}
        />
        <Button
          type="primary"
          loading={addMutation.isPending}
          onClick={() => {
            if (email.trim()) addMutation.mutate();
          }}
        >
          Invite
        </Button>
      </Space.Compact>
      <div style={{ marginTop: 8, marginBottom: 8 }}>
        <label>
          <input
            type="checkbox"
            checked={includeChildren}
            onChange={(e) => setIncludeChildren(e.target.checked)}
          />
          <span style={{ marginLeft: 6, fontSize: 13, color: '#666' }}>Include sub-documents</span>
        </label>
      </div>
      {error ? (
        <Text type="danger" className={styles.inlineError}>
          {error}
        </Text>
      ) : null}

      {loading ? (
        <div className={styles.loading}>
          <Spin />
        </div>
      ) : !data ? null : (
        <List
          className={styles.memberList}
          dataSource={[
            {
              userId: data.owner.id,
              name: data.owner.name,
              email: data.owner.email,
              role: 'OWNER' as const,
            },
            ...data.members,
          ]}
          locale={{ emptyText: 'No collaborators yet.' }}
          renderItem={(m) => {
            const isOwnerRow = m.role === 'OWNER';
            return (
              <List.Item
                actions={
                  isOwnerRow
                    ? undefined
                    : [
                        <Select<AssignableRole>
                          key="role"
                          size="small"
                          value={m.role as AssignableRole}
                          className={styles.roleSelect}
                          onChange={(r) => updateMutation.mutate({ userId: m.userId, role: r })}
                          options={ASSIGNABLE_ROLES.map((r) => ({
                            value: r,
                            label: ROLE_LABEL[r],
                          }))}
                        />,
                        <Button
                          key="remove"
                          type="text"
                          danger
                          size="small"
                          onClick={() => removeMutation.mutate(m.userId)}
                        >
                          ×
                        </Button>,
                      ]
                }
              >
                <List.Item.Meta
                  title={
                    <span>
                      {m.name}
                      {m.userId === currentUserId ? ' (you)' : ''}
                    </span>
                  }
                  description={
                    <Text type="secondary">
                      {m.email}
                      {(m as { includeChildren?: boolean }).includeChildren
                        ? ' · includes sub-documents'
                        : ''}
                    </Text>
                  }
                />
                {isOwnerRow ? <Tag color="blue">Owner</Tag> : null}
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );
}

// ---- KB-level Share Panel (shares the entire KB via root node) ----

function KbSharePanel({
  kbId,
  data,
  loading,
  currentUserId,
  accessRequests,
  accessRequestsLoading,
}: {
  kbId: string;
  data: NodeMembersResponse | undefined;
  loading: boolean;
  currentUserId: string;
  accessRequests: AccessRequest[];
  accessRequestsLoading: boolean;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('EDITOR');
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['kb-members', kbId] });

  const addMutation = useMutation({
    mutationFn: () => knowledgeBasesApi.addMember(kbId, email.trim(), role),
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
      knowledgeBasesApi.updateMemberRole(kbId, userId, r),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => knowledgeBasesApi.removeMember(kbId, userId),
    onSuccess: invalidate,
  });

  return (
    <div>
      <AccessRequestsPanel kbId={kbId} requests={accessRequests} loading={accessRequestsLoading} />
      <Space.Compact className={styles.inviteInputGroup}>
        <Input
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onPressEnter={() => {
            if (email.trim()) addMutation.mutate();
          }}
        />
        <Select<AssignableRole>
          value={role}
          onChange={setRole}
          className={styles.inviteRoleSelect}
          options={ASSIGNABLE_ROLES.map((r) => ({
            value: r,
            label: ROLE_LABEL[r],
          }))}
        />
        <Button
          type="primary"
          loading={addMutation.isPending}
          onClick={() => {
            if (email.trim()) addMutation.mutate();
          }}
        >
          Invite
        </Button>
      </Space.Compact>
      {error ? (
        <Text type="danger" className={styles.inlineError}>
          {error}
        </Text>
      ) : null}

      {loading ? (
        <div className={styles.loading}>
          <Spin />
        </div>
      ) : !data ? null : (
        <List
          className={styles.memberList}
          dataSource={[
            {
              userId: data.owner.id,
              name: data.owner.name,
              email: data.owner.email,
              role: 'OWNER' as const,
            },
            ...data.members,
          ]}
          locale={{ emptyText: 'No collaborators yet.' }}
          renderItem={(m) => {
            const isOwnerRow = m.role === 'OWNER';
            return (
              <List.Item
                actions={
                  isOwnerRow
                    ? undefined
                    : [
                        <Select<AssignableRole>
                          key="role"
                          size="small"
                          value={m.role as AssignableRole}
                          className={styles.roleSelect}
                          onChange={(r) =>
                            updateMutation.mutate({
                              userId: m.userId,
                              role: r,
                            })
                          }
                          options={ASSIGNABLE_ROLES.map((r) => ({
                            value: r,
                            label: ROLE_LABEL[r],
                          }))}
                        />,
                        <Button
                          key="remove"
                          type="text"
                          danger
                          size="small"
                          disabled={m.userId === currentUserId}
                          onClick={() => removeMutation.mutate(m.userId)}
                        >
                          ×
                        </Button>,
                      ]
                }
              >
                <List.Item.Meta
                  title={
                    <span>
                      {m.name}
                      {m.userId === currentUserId ? ' (you)' : ''}
                    </span>
                  }
                  description={<Text type="secondary">{m.email}</Text>}
                />
                {isOwnerRow ? <Tag color="blue">Owner</Tag> : null}
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );
}

function AccessRequestsPanel({
  kbId,
  requests,
  loading,
}: {
  kbId: string;
  requests: AccessRequest[];
  loading: boolean;
}) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<
    Record<string, { role: AssignableRole; scope: AccessRequestScope; includeChildren?: boolean }>
  >({});

  const reviewMutation = useMutation({
    mutationFn: ({
      request,
      status,
    }: {
      request: AccessRequest;
      status: 'APPROVED' | 'REJECTED';
    }) => {
      const draft = drafts[request.id] ?? {
        role: request.requestedRole,
        scope: request.scope,
        includeChildren: request.requestedIncludeChildren,
      };
      return knowledgeBasesApi.reviewAccessRequest(kbId, request.id, {
        status,
        role: draft.role,
        scope: draft.scope,
        nodeId: draft.scope === 'NODE' ? (request.nodeId ?? undefined) : undefined,
        includeChildren: draft.includeChildren,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['kb-access-requests', kbId] }),
        qc.invalidateQueries({ queryKey: ['kb-members', kbId] }),
        qc.invalidateQueries({ queryKey: ['kb-tree', kbId] }),
      ]);
    },
  });

  const pendingCount = requests.filter((request) => request.status === 'PENDING').length;

  return (
    <div className={styles.accessRequestsPanel}>
      <div className={styles.panelSectionTitle}>
        <Text strong>Access requests</Text>
        {pendingCount > 0 ? <Badge count={pendingCount} size="small" /> : null}
      </div>
      {loading ? (
        <div className={styles.loading}>
          <Spin />
        </div>
      ) : requests.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No access requests." />
      ) : (
        <List
          className={styles.accessRequestList}
          dataSource={requests}
          renderItem={(request) => {
            const draft = drafts[request.id] ?? {
              role: request.requestedRole,
              scope: request.scope,
              includeChildren: request.requestedIncludeChildren,
            };
            const isPending = request.status === 'PENDING';
            const scopeLabel =
              request.scope === 'KNOWLEDGE_BASE'
                ? 'Entire knowledge base'
                : request.node?.title
                  ? `Node: ${request.node.title}`
                  : 'Current node';
            return (
              <List.Item>
                <div className={styles.accessRequestItem}>
                  <div>
                    <Text strong>{request.requester?.name ?? request.requesterId}</Text>
                    <Tag className={styles.requestStatusTag}>{request.status}</Tag>
                  </div>
                  <Text type="secondary">
                    {request.requester?.email ?? ''} · {scopeLabel} ·{' '}
                    {ROLE_LABEL[request.requestedRole]}
                  </Text>
                  {request.message ? <Text>{request.message}</Text> : null}
                  {isPending ? (
                    <Space wrap>
                      <Select<AccessRequestScope>
                        size="small"
                        value={draft.scope}
                        className={styles.scopeSelect}
                        onChange={(nextScope) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [request.id]: { ...draft, scope: nextScope },
                          }))
                        }
                        options={[
                          ...(request.nodeId
                            ? [{ value: 'NODE' as const, label: 'Current node' }]
                            : []),
                          { value: 'KNOWLEDGE_BASE' as const, label: 'Entire KB' },
                        ]}
                      />
                      <Select<AssignableRole>
                        size="small"
                        value={draft.role}
                        className={styles.roleSelect}
                        onChange={(nextRole) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [request.id]: { ...draft, role: nextRole },
                          }))
                        }
                        options={ASSIGNABLE_ROLES.map((role) => ({
                          value: role,
                          label: ROLE_LABEL[role],
                        }))}
                      />
                      <Button
                        size="small"
                        type="primary"
                        loading={reviewMutation.isPending}
                        onClick={() => reviewMutation.mutate({ request, status: 'APPROVED' })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        danger
                        loading={reviewMutation.isPending}
                        onClick={() => reviewMutation.mutate({ request, status: 'REJECTED' })}
                      >
                        Reject
                      </Button>
                    </Space>
                  ) : null}
                </div>
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );
}

function VersionsPanel({
  loading,
  versions,
  selectedId,
  onSelect,
}: {
  loading: boolean;
  versions: NodeVersion[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className={styles.versionLoading}>
        <Spin />
      </div>
    );
  }
  if (versions.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No versions yet." />;
  }
  return (
    <List
      dataSource={versions}
      renderItem={(v) => (
        <List.Item
          actions={[
            <Button
              key="view"
              size="small"
              disabled={selectedId === v.id}
              onClick={() => onSelect(v.id)}
            >
              {selectedId === v.id ? 'Viewing' : 'View'}
            </Button>,
          ]}
        >
          <List.Item.Meta
            title={
              <span>
                v{v.version}
                {v.label ? ` · ${v.label}` : v.createdById ? '' : ' · auto'}
              </span>
            }
            description={
              <Text type="secondary" className={styles.versionTime}>
                {new Date(v.createdAt).toLocaleString()}
              </Text>
            }
          />
        </List.Item>
      )}
    />
  );
}

function VersionPreviewModal({
  open,
  loading,
  version,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  version: NodeVersionDetail | undefined;
  onClose: () => void;
}) {
  const previewEditor = useEditor(
    {
      editable: false,
      content: normalizeDocContent(
        (version?.content ?? { type: 'doc', content: [] }) as JSONContent
      ),
      extensions: [
        StarterKit,
        CodeBlockLowlight.configure({ lowlight }),
        ResizableImage.extend({
          addNodeView() {
            return ReactNodeViewRenderer(ImageNodeView);
          },
        }),
        WidgetExtension.extend({
          addNodeView() {
            return ReactNodeViewRenderer(WidgetNodeView);
          },
        }),
        TextAlign.configure({
          types: ['heading', 'paragraph'],
          alignments: ['left', 'center', 'right'],
          defaultAlignment: 'left',
        }),
        Underline,
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        LinkExtension.configure({ openOnClick: true }),
      ],
    },
    [version?.id]
  );

  useEffect(() => {
    if (version && previewEditor) {
      previewEditor.commands.setContent(version.content as JSONContent);
    }
  }, [previewEditor, version]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      title={
        <div>
          <div>Version preview</div>
          {version ? (
            <Text type="secondary" className={styles.previewMeta}>
              v{version.version}
              {version.label ? ` · ${version.label}` : ''} ·{' '}
              {new Date(version.createdAt).toLocaleString()}
            </Text>
          ) : null}
        </div>
      }
    >
      {loading ? (
        <div className={styles.previewLoading}>
          <Spin />
        </div>
      ) : (
        <div className={styles.previewSurface}>
          <EditorContent editor={previewEditor} />
        </div>
      )}
    </Modal>
  );
}

function ConnBadge({ state }: { state: ConnState }) {
  const map: Record<ConnState, { label: string; status: 'processing' | 'success' | 'error' }> = {
    connecting: { label: 'Connecting…', status: 'processing' },
    connected: { label: 'Live', status: 'success' },
    disconnected: { label: 'Offline', status: 'error' },
  };
  const v = map[state];
  return <Badge status={v.status} text={v.label} />;
}

function PeerList({
  peers,
  selfId,
}: {
  peers: Array<{ id: number; name: string; color: string; email?: string; avatarUrl?: string }>;
  selfId: number | undefined;
}) {
  if (peers.length === 0) return null;
  return (
    <Avatar.Group max={{ count: 5 }}>
      {peers.map((p) => (
        <Popover
          key={p.id}
          trigger="hover"
          placement="bottom"
          content={
            <div style={{ minWidth: 200 }}>
              <Space align="start" size={12}>
                <Avatar
                  size={40}
                  src={p.avatarUrl}
                  style={{ background: p.color, fontSize: 18, flexShrink: 0 }}
                >
                  {avatarFallback(p.name)}
                </Avatar>
                <div>
                  <Text strong style={{ fontSize: 14, display: 'block' }}>
                    {p.name}
                    {p.id === selfId ? (
                      <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                        (you)
                      </Text>
                    ) : null}
                  </Text>
                  {p.email ? (
                    <Space size={4} style={{ marginTop: 4 }}>
                      <MailOutlined style={{ fontSize: 12, color: '#999' }} />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {p.email}
                      </Text>
                    </Space>
                  ) : null}
                </div>
              </Space>
            </div>
          }
        >
          <Avatar
            size="small"
            src={p.avatarUrl}
            style={{
              background: p.color,
              border: p.id === selfId ? '2px solid #333' : undefined,
              cursor: 'pointer',
            }}
          >
            {avatarFallback(p.name)}
          </Avatar>
        </Popover>
      ))}
    </Avatar.Group>
  );
}

// ---- tree drag helpers ----

function findNode(tree: TreeNode[], id: string): TreeNode | null {
  for (const n of tree) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

function findParent(tree: TreeNode[], id: string, parent: TreeNode | null = null): TreeNode | null {
  for (const n of tree) {
    if (n.id === id) return parent;
    const found = findParent(n.children, id, n);
    if (found) return found;
  }
  return null;
}

/**
 * Compute the new parentId and index for a dragged node based on AntD Tree onDrop info.
 * - dropToGap=true:  dropped between siblings (before/after dropKey)
 * - dropToGap=false: dropped inside dropKey (only valid if dropKey is a FOLDER)
 */
function computeDropTarget(
  tree: TreeNode[],
  dragKey: string,
  dropKey: string,
  dropToGap: boolean,
  dropPosition: number
): { parentId: string | null; index: number } {
  if (!dropToGap) {
    // dropping inside the drop node — find its children and compute index
    const dropNode = findNode(tree, dropKey);
    const children = dropNode?.children ?? [];
    const filtered = children.filter((c) => c.id !== dragKey);
    return { parentId: dropKey, index: filtered.length };
  }

  // dropping to a gap — find the drop node's parent and position
  const dropParent = findParent(tree, dropKey);
  const parentId = dropParent?.id ?? null;
  const siblings = parentId
    ? (findNode(tree, parentId)?.children ?? []).filter((c) => c.id !== dragKey)
    : tree.filter((c) => c.id !== dragKey);

  const dropIndex = siblings.findIndex((c) => c.id === dropKey);
  // dropPosition: -1 = before the node, 1 = after the node
  const index = dropPosition < 0 ? dropIndex : dropIndex + 1;
  return { parentId, index: Math.max(0, index) };
}
