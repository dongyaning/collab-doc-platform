import { Outlet, useNavigate } from 'react-router-dom';
import { Button, Layout, Space, Typography } from 'antd';
import { LogoutOutlined, TeamOutlined } from '@ant-design/icons';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import styles from './index.module.less';

const { Header, Content } = Layout;
const { Text } = Typography;

export function AppLayout() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  if (!token) return <Navigate to="/login" replace />;

  return (
    <Layout className={styles.layout}>
      <Header className={styles.topBar}>
        <Space
          className={styles.topBarLeft}
          onClick={() => navigate('/kb')}
          style={{ cursor: 'pointer' }}
        >
          <TeamOutlined className={styles.brandIcon} />
          <Text className={styles.brandText}>Knowledge Base</Text>
        </Space>
        <Space className={styles.topBarRight}>
          <Text type="secondary">{user?.email}</Text>
          <Button
            icon={<LogoutOutlined />}
            type="text"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          />
        </Space>
      </Header>
      <Content className={styles.content}>
        <Outlet />
      </Content>
    </Layout>
  );
}
