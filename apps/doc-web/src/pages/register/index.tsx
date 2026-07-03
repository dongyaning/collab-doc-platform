import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { authApi } from '../../lib/endpoints';
import { useAuthStore } from '../../stores/auth.store';
import { WiseFlowLogo } from '../../components/wiseflow-logo';
import styles from './index.module.less';

const { Title } = Typography;

interface RegisterValues {
  name: string;
  email: string;
  password: string;
}

export function RegisterPage() {
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onFinish(values: RegisterValues) {
    setLoading(true);
    setError(null);
    try {
      const { accessToken, user } = await authApi.register(
        values.email,
        values.password,
        values.name
      );
      setSession(accessToken, user);
      navigate('/documents', { replace: true });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Registration failed';
      setError(String(message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <div className={styles.brand}>
          <WiseFlowLogo size={28} />
          <Title level={3} className={styles.title}>
            WiseFlow
          </Title>
        </div>
        <Form<RegisterValues>
          layout="vertical"
          onFinish={onFinish}
          requiredMark={false}
        >
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Please enter your name' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="Your name" />
          </Form.Item>
          <Form.Item
            label="Email"
            name="email"
            rules={[{ required: true, type: 'email', message: 'Please enter a valid email' }]}
          >
            <Input prefix={<MailOutlined />} type="email" placeholder="you@example.com" />
          </Form.Item>
          <Form.Item
            label="Password"
            name="password"
            rules={[{ required: true, min: 6, message: 'At least 6 characters' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Password" />
          </Form.Item>
          {error ? (
            <Form.Item>
              <Alert type="error" message={error} showIcon />
            </Form.Item>
          ) : null}
          <Form.Item className={styles.submitItem}>
            <Button type="primary" htmlType="submit" block loading={loading}>
              Sign up
            </Button>
          </Form.Item>
        </Form>
        <div className={styles.loginLink}>
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </Card>
    </div>
  );
}
