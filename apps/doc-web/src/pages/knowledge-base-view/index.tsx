import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import dayjs from 'dayjs';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
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
  PlusOutlined,
  SaveOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  knowledgeBasesApi,
  nodesApi,
  type DocumentVersion,
  type DocumentVersionDetail,
  type DocumentRole,
  type KbMemberResponse,
} from '../../lib/endpoints';
import { useAuthStore } from '../../stores/auth.store';
import type { TreeNode, KnowledgeBaseTree } from '@collab/shared';
import styles from './index.module.less';

const { Sider, Content } = Layout;
const { Text } = Typography;

type ConnState = 'connecting' | 'connected' | 'disconnected';
type AssignableRole = Exclude<DocumentRole, 'OWNER'>;

const ASSIGNABLE_ROLES: AssignableRole[] = ['EDITOR', 'COMMENTER', 'VIEWER'];
const ROLE_LABEL: Record<DocumentRole, string> = {
  OWNER: 'Owner',
  EDITOR: 'Editor',
  COMMENTER: 'Commenter',
  VIEWER: 'Viewer',
};
const ROLE_COLOR: Record<DocumentRole, string> = {
  OWNER: 'blue',
  EDITOR: 'green',
  COMMENTER: 'gold',
  VIEWER: 'default',
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

  // resolve role from KB membership
  const userRole: DocumentRole | undefined = treeQuery.data?.kb?.role as DocumentRole | undefined;
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

  // ---- create node ----
  const createMutation = useMutation({
    mutationFn: (data: { title?: string; type?: string; parentId?: string | null }) =>
      nodesApi.create({ kbId: kbId!, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-tree', kbId] });
    },
  });

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
    p.on('status', (e: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      setConnState(e.status);
    });
    const updatePeers = () => {
      const states = Array.from(p.awareness.getStates().entries());
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
        Placeholder.configure({ placeholder: 'Start writing…' }),
        Collaboration.configure({ document: ydoc }),
        ...(provider
          ? [
              CollaborationCursor.configure({
                provider,
                user: {
                  name: (user?.name ?? 'Anonymous').slice(0, 1).toUpperCase(),
                  color: colorFor(user?.id ?? 'anon'),
                },
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
  const versionsQuery = useQuery<DocumentVersion[]>({
    queryKey: ['node-versions', nodeId],
    queryFn: () => nodesApi.listVersions(nodeId!),
    enabled: versionsOpen && !!nodeId,
  });
  const [snapshotPending, setSnapshotPending] = useState(false);

  // ---- members ----
  const [shareOpen, setShareOpen] = useState(false);
  const membersQuery = useQuery<KbMemberResponse>({
    queryKey: ['node-members', nodeId],
    queryFn: () => nodesApi.listMembers(nodeId!),
    enabled: shareOpen && !!nodeId,
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
  const versionPreviewQuery = useQuery<DocumentVersionDetail>({
    queryKey: ['node-version', nodeId, previewVersionId],
    queryFn: () => nodesApi.getVersion(nodeId!, previewVersionId!),
    enabled: !!nodeId && !!previewVersionId,
  });

  const updateTime = useMemo(() => {
    if (!activeDoc.data) return null;
    return dayjs(activeDoc.data.updatedAt).format('YYYY-MM-DD:HH:mm:ss');
  }, [activeDoc.data]);

  const isOwner = userRole === 'OWNER';

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
      <Sider width={280} className={styles.sider}>
        <div className={styles.siderInner}>
          <div className={styles.siderHeader}>
            <Text className={styles.kbTitle} ellipsis>
              {treeQuery.data.kb.title}
            </Text>
            <Space size={4}>
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
            </Space>
          </div>
          <div className={styles.tree}>
            <Tree
              treeData={buildTreeData(treeQuery.data.nodes)}
              onSelect={onSelect}
              defaultExpandAll
              selectedKeys={nodeId ? [nodeId] : []}
              showIcon
            />
          </div>
        </div>
      </Sider>

      <Content className={styles.contentArea}>
        {!nodeId || !activeDoc.data ? (
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

            <div className={styles.paper}>
              <span className={styles.updateTime}>最近更新: {updateTime}</span>
              <Input
                className={styles.titleInput}
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="Untitled"
                readOnly={!editable}
                variant="borderless"
              />
              <div className={styles.editorSurface}>
                <EditorContent editor={editor} />
              </div>
            </div>

            <Drawer
              title="Share"
              open={shareOpen && isOwner}
              onClose={() => setShareOpen(false)}
              width={360}
            >
              <SharePanel
                docId={nodeId!}
                data={membersQuery.data}
                loading={membersQuery.isLoading}
                currentUserId={user?.id ?? ''}
              />
            </Drawer>

            <Drawer
              title="History"
              open={versionsOpen}
              onClose={() => setVersionsOpen(false)}
              width={360}
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
          </div>
        )}
      </Content>
    </Layout>
  );
}

// ---- sub-components (share, versions, preview, conn) ----
// (largely reused from original DocumentEditorPage)

function SharePanel({
  docId,
  data,
  loading,
  currentUserId,
}: {
  docId: string;
  data: KbMemberResponse | undefined;
  loading: boolean;
  currentUserId: string;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('EDITOR');
  const [error, setError] = useState<string | null>(null);
  const invalidate = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ['node-members', docId] })]);

  const addMutation = useMutation({
    mutationFn: () => nodesApi.addMember(docId, email.trim(), role),
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
      nodesApi.updateMemberRole(docId, userId, r),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => nodesApi.removeMember(docId, userId),
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
  versions: DocumentVersion[];
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
  version: DocumentVersionDetail | undefined;
  onClose: () => void;
}) {
  const previewEditor = useEditor(
    {
      editable: false,
      content: (version?.content ?? { type: 'doc', content: [] }) as JSONContent,
      extensions: [StarterKit],
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
                  <Space size={4} style={{ marginTop: 6 }}>
                    <UserOutlined style={{ fontSize: 12, color: '#999' }} />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Collaborator
                    </Text>
                  </Space>
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
