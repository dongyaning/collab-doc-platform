import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  type NodeVersion,
  type NodeVersionDetail,
  type NodeRole,
  type NodeMembersResponse,
} from '../../lib/endpoints';
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

function buildCursorLabel(user: { name: string; color: string }): HTMLElement {
  const cursor = document.createElement('span');
  cursor.classList.add('collaboration-cursor__caret');
  cursor.setAttribute('style', `border-color: ${user.color}`);
  const label = document.createElement('div');
  label.classList.add('collaboration-cursor__label');
  label.setAttribute('style', `background-color: ${user.color}`);
  label.textContent = user.name.slice(0, 1).toUpperCase();
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

export function KnowledgeBaseViewPage() {
  const { kbId, nodeId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { modal } = AntdApp.useApp();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const treeQuery = useQuery<KnowledgeBaseTree>({
    queryKey: ['kb-tree', kbId],
    queryFn: () => knowledgeBasesApi.getTree(kbId!),
    enabled: !!kbId,
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
  const editable = canEdit(userRole);

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
      navigate(`/kb/${kbId}/${keys[0]}`);
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
    Array<{ id: number; name: string; color: string; email?: string }>
  >([]);

  useEffect(() => {
    if (!nodeId || !token || !user) {
      return undefined;
    }
    const url = new URL(COLLAB_WS_URL);
    const p = new WebsocketProvider(url.toString(), nodeId, ydoc, {
      params: { token, docId: nodeId },
      connect: true,
    });
    p.awareness.setLocalStateField('user', {
      name: user.name,
      color: colorFor(user.id),
      email: user.email,
    });

    console.log('[aware] self clientId (set):', p.awareness.clientID, 'name:', user.name);
    console.log('[aware] states after set:', Array.from(p.awareness.getStates().entries()));

    p.on('status', (e: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      setConnState(e.status);
    });
    const updatePeers = () => {
      const states = Array.from(p.awareness.getStates().entries());
      console.log(
        '[aware] updatePeers self clientId:',
        p.awareness.clientID,
        'states:',
        JSON.parse(JSON.stringify(states))
      );
      setPeers(
        states.map(
          ([clientId, state]: [
            number,
            { user?: { name?: string; color?: string; email?: string } },
          ]) => ({
            id: clientId,
            name: state.user?.name ?? 'Anonymous',
            color: state.user?.color ?? '#888',
            email: state.user?.email,
          })
        )
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
  }, [nodeId, token, user, ydoc]);

  const editor = useEditor(
    {
      editable,
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
          types: ['heading', 'paragraph', 'image'],
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
        Collaboration.configure({ document: ydoc }),
        ...(provider
          ? [
              CollaborationCursor.configure({
                provider,
                user: {
                  name: user?.name ?? 'A',
                  color: colorFor(user?.id ?? 'anon'),
                  email: user?.email,
                },
                render: buildCursorLabel,
              }),
            ]
          : []),
      ],
    },
    [ydoc, provider, editable]
  );

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

  const isOwner = userRole === 'OWNER';
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
        collapsedWidth={48}
        className={styles.sider}
        collapsible
        collapsed={siderCollapsed}
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
                <PeerList peers={peers} selfId={provider?.awareness.clientID} />
                <ConnBadge state={connState} />
              </Space>
              <Space wrap>
                {editable ? (
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

            <EditorToolbar editor={editor} editable={editable} />

            <div className={styles.paper}>
              <span className={styles.updateTime}>recently update: {updateTime}</span>
              <div className={styles.titleRow}>
                <Input
                  className={styles.titleInput}
                  value={title}
                  onChange={(e) => onTitleChange(e.target.value)}
                  placeholder="Untitled"
                  readOnly={!editable}
                  variant="borderless"
                />
              </div>
              <div className={styles.editorSurface}>
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
}: {
  kbId: string;
  data: NodeMembersResponse | undefined;
  loading: boolean;
  currentUserId: string;
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
      content: (version?.content ?? { type: 'doc', content: [] }) as JSONContent,
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
          types: ['heading', 'paragraph', 'image'],
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
  peers: Array<{ id: number; name: string; color: string; email?: string }>;
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
                <Avatar size={40} style={{ background: p.color, fontSize: 18, flexShrink: 0 }}>
                  {p.name.slice(0, 1).toUpperCase()}
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
            style={{
              background: p.color,
              border: p.id === selfId ? '2px solid #333' : undefined,
              cursor: 'pointer',
            }}
          >
            {p.name.slice(0, 1).toUpperCase()}
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
