import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Button,
  Empty,
  Layout,
  List,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, FileTextOutlined, LogoutOutlined, PlusOutlined } from '@ant-design/icons';
import { documentsApi, type DocumentSummary, type DocumentRole } from '../../lib/endpoints';
import { useAuthStore } from '../../stores/auth.store';
import styles from './index.module.less';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

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
    <Layout className={styles.layout}>
      <Header className={styles.header}>
        <Space>
          <FileTextOutlined className={styles.brandIcon} />
          <Title level={4} className={styles.title}>
            Documents
          </Title>
        </Space>
        <Space>
          <Text type="secondary">{user?.email}</Text>
          <Button icon={<LogoutOutlined />} onClick={logout}>
            Sign out
          </Button>
        </Space>
      </Header>
      <Content className={styles.content}>
        <div className={styles.contentInner}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => createMutation.mutate()}
            loading={createMutation.isPending}
          >
            New document
          </Button>

          {isLoading ? (
            <div className={styles.loading}>
              <Spin />
            </div>
          ) : (
            <>
              <DocSection
                title="My documents"
                docs={owned}
                empty="No documents yet."
                onDelete={(id) => removeMutation.mutate(id)}
              />
              <DocSection
                title="Shared with me"
                docs={shared}
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

function DocSection({
  title,
  docs,
  empty,
  showOwner,
  onDelete,
}: {
  title: string;
  docs: DocumentSummary[];
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
      {docs.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} className={styles.empty} />
      ) : (
        <List
          className={styles.list}
          bordered
          dataSource={docs}
          renderItem={(doc) => (
            <List.Item
              actions={
                onDelete
                  ? [
                      <Popconfirm
                        key="delete"
                        title="Delete this document?"
                        description={doc.title || 'Untitled'}
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => onDelete(doc.id)}
                      >
                        <Button type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>,
                    ]
                  : undefined
              }
            >
              <List.Item.Meta
                avatar={<Avatar icon={<FileTextOutlined />} />}
                title={
                  <a onClick={() => navigate(`/documents/${doc.id}`)}>{doc.title || 'Untitled'}</a>
                }
                description={
                  <Text type="secondary" className={styles.description}>
                    {showOwner ? `Shared by ${doc.owner.name} · ` : ''}
                    {new Date(doc.updatedAt).toLocaleString()}
                  </Text>
                }
              />
              <Tag color={ROLE_COLOR[doc.role]}>{ROLE_LABEL[doc.role]}</Tag>
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
