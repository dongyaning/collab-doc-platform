import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Button,
  Empty,
  Input,
  Layout,
  Modal,
  Popconfirm,
  Spin,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, FileOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import { knowledgeBasesApi, nodesApi, type SharedNode } from '../../lib/endpoints';
import type { KnowledgeBaseSummary } from '@wiseflow/shared';
import styles from './index.module.less';

const { Content } = Layout;
const { Text } = Typography;

export function KnowledgeBaseListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: kbData, isLoading: kbLoading } = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: knowledgeBasesApi.list,
  });

  const { data: sharedNodes, isLoading: sharedLoading } = useQuery({
    queryKey: ['nodes-shared'],
    queryFn: nodesApi.listShared,
  });

  const createMutation = useMutation({
    mutationFn: ({ title, description }: { title: string; description?: string }) =>
      knowledgeBasesApi.create(title, description),
    onSuccess: (kb) => {
      qc.invalidateQueries({ queryKey: ['knowledge-bases'] });
      navigate(`/kb/${kb.id}`);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => knowledgeBasesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-bases'] }),
  });

  function onCreate() {
    let title = '';
    Modal.confirm({
      title: 'Create knowledge base',
      content: (
        <div style={{ marginTop: 8 }}>
          <Input
            placeholder="Knowledge base name"
            onChange={(e) => {
              title = e.target.value;
            }}
            onPressEnter={() => {
              if (title.trim()) {
                Modal.destroyAll();
                createMutation.mutate({ title: title.trim() });
              }
            }}
          />
        </div>
      ),
      okText: 'Create',
      onOk: () => {
        if (title.trim()) {
          createMutation.mutate({ title: title.trim() });
        }
      },
    });
  }

  const owned = (kbData ?? []).filter((kb) => kb.role === 'OWNER');
  const sharedKbs = (kbData ?? []).filter((kb) => kb.role !== 'OWNER');

  const sharedTabItems = [
    {
      key: 'kb',
      label: 'Knowledge Bases',
      children: (
        <KbSection title="" kbs={sharedKbs} empty="No knowledge bases shared with you." showOwner />
      ),
    },
    {
      key: 'documents',
      label: 'Documents',
      children: <SharedNodeList nodes={sharedNodes ?? []} loading={sharedLoading} />,
    },
  ];

  return (
    <Layout className={styles.layout}>
      <Content className={styles.content}>
        <div className={styles.contentInner}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={onCreate}
            loading={createMutation.isPending}
          >
            New knowledge base
          </Button>

          {kbLoading ? (
            <div className={styles.loading}>
              <Spin />
            </div>
          ) : (
            <>
              <KbSection
                title="My knowledge bases"
                kbs={owned}
                empty="No knowledge bases yet."
                onDelete={(id) => removeMutation.mutate(id)}
              />
              <div className={styles.section}>
                <Text type="secondary" className={styles.sectionTitle}>
                  Shared with me
                </Text>
                <Tabs items={sharedTabItems} />
              </div>
            </>
          )}
        </div>
      </Content>
    </Layout>
  );
}

function KbSection({
  title,
  kbs,
  empty,
  showOwner,
  onDelete,
}: {
  title: string;
  kbs: KnowledgeBaseSummary[];
  empty: string;
  showOwner?: boolean;
  onDelete?: (id: string) => void;
}) {
  const navigate = useNavigate();

  if (kbs.length === 0) {
    return (
      <div className={styles.section}>
        <Text type="secondary" className={styles.sectionTitle}>
          {title}
        </Text>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} className={styles.empty} />
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <Text type="secondary" className={styles.sectionTitle}>
        {title}
      </Text>
      <div className={styles.list}>
        {kbs.map((kb) => (
          <div key={kb.id} className={styles.listItem}>
            <Avatar icon={<TeamOutlined />} />
            <div className={styles.listItemContent}>
              <button
                type="button"
                className={styles.itemLink}
                onClick={() => navigate(`/kb/${kb.id}`)}
              >
                {kb.title || 'Untitled Space'}
              </button>
              <Text type="secondary">
                {showOwner ? `Owned by ${kb.owner.name} · ` : ''}
                {kb.nodeCount} document{kb.nodeCount !== 1 ? 's' : ''} ·{' '}
                {new Date(kb.updatedAt).toLocaleString()}
              </Text>
            </div>
            <div className={styles.listItemActions}>
              <Tag>{showOwner ? 'Member' : 'Owner'}</Tag>
              {onDelete ? (
                <Popconfirm
                  title="Delete this knowledge base?"
                  description="All documents within it will be deleted."
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => onDelete(kb.id)}
                >
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`Delete ${kb.title || 'Untitled Space'}`}
                  />
                </Popconfirm>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SharedNodeList({ nodes, loading }: { nodes: SharedNode[]; loading: boolean }) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className={styles.loading}>
        <Spin />
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="No documents have been shared with you directly."
        className={styles.empty}
      />
    );
  }

  // Group by KB
  const byKb = new Map<string, { title: string; nodes: SharedNode[] }>();
  for (const n of nodes) {
    const group = byKb.get(n.kb.id);
    if (group) {
      group.nodes.push(n);
    } else {
      byKb.set(n.kb.id, { title: n.kb.title, nodes: [n] });
    }
  }

  return (
    <div>
      {Array.from(byKb.entries()).map(([kbId, group]) => (
        <div key={kbId} className={styles.sharedGroup}>
          <Text type="secondary" className={styles.sectionTitle}>
            In {group.title}
          </Text>
          <div className={styles.list}>
            {group.nodes.map((item) => (
              <div key={item.node.id} className={styles.listItem}>
                <Avatar icon={<FileOutlined />} />
                <div className={styles.listItemContent}>
                  <Text strong>{item.node.title || 'Untitled'}</Text>
                  <Text type="secondary">
                    {item.node.type === 'FOLDER' ? 'Folder' : 'Document'}
                  </Text>
                </div>
                <div className={styles.listItemActions}>
                  <Tag>{item.role}</Tag>
                  <Button type="link" onClick={() => navigate(`/kb/${kbId}/${item.node.id}`)}>
                    Open
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
