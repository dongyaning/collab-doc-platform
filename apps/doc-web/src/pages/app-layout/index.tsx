import { Outlet, useNavigate } from 'react-router-dom';
import { Button, Layout, Space, Tooltip, Typography } from 'antd';
import { DashboardOutlined, LogoutOutlined } from '@ant-design/icons';
import { WiseFlowLogo } from '../../components/wiseflow-logo';
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
          <WiseFlowLogo size={20} />
          <Text className={styles.brandText}>WiseFlow</Text>
        </Space>
        <Space className={styles.topBarRight}>
          <Tooltip title="Performance">
            <Button
              icon={<DashboardOutlined />}
              type="text"
              onClick={() => navigate('/performance')}
            />
          </Tooltip>
          <Text type="secondary">{user?.name}</Text>
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
