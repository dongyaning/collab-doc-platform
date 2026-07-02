import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Button,
  Empty,
  Input,
  Layout,
  List,
  Modal,
  Popconfirm,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import { knowledgeBasesApi } from '../../lib/endpoints';
import type { KnowledgeBaseSummary } from '@collab/shared';
import styles from './index.module.less';

const { Content } = Layout;
const { Text } = Typography;

export function KnowledgeBaseListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: knowledgeBasesApi.list,
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

  const owned = (data ?? []).filter((kb) => kb.role === 'OWNER');
  const shared = (data ?? []).filter((kb) => kb.role !== 'OWNER');

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

          {isLoading ? (
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
              <KbSection
                title="Shared with me"
                kbs={shared}
                empty="Nothing shared with you yet."
                showOwner
              />
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

  return (
    <div className={styles.section}>
      <Text type="secondary" className={styles.sectionTitle}>
        {title}
      </Text>
      {kbs.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} className={styles.empty} />
      ) : (
        <List
          className={styles.list}
          bordered
          dataSource={kbs}
          renderItem={(kb) => (
            <List.Item
              actions={
                onDelete
                  ? [
                      <Popconfirm
                        key="delete"
                        title="Delete this knowledge base?"
                        description="All documents within it will be deleted."
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => onDelete(kb.id)}
                      >
                        <Button type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>,
                    ]
                  : undefined
              }
            >
              <List.Item.Meta
                avatar={<Avatar icon={<TeamOutlined />} />}
                title={
                  <a onClick={() => navigate(`/kb/${kb.id}`)}>{kb.title || 'Untitled Space'}</a>
                }
                description={
                  <Text type="secondary">
                    {showOwner ? `Owned by ${kb.owner.name} · ` : ''}
                    {kb.nodeCount} document{kb.nodeCount !== 1 ? 's' : ''} ·{' '}
                    {new Date(kb.updatedAt).toLocaleString()}
                  </Text>
                }
              />
              <Tag>{showOwner ? 'Member' : 'Owner'}</Tag>
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
