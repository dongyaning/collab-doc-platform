import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { authApi } from '../../lib/endpoints';
import { useAuthStore } from '../../stores/auth.store';
import styles from './index.module.less';

const { Title, Paragraph, Text } = Typography;

interface LoginValues {
  email: string;
  password: string;
}

export function LoginPage() {
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onFinish(values: LoginValues) {
    setLoading(true);
    setError(null);
    try {
      const { accessToken, user } = await authApi.login(values.email, values.password);
      setSession(accessToken, user);
      navigate('/documents', { replace: true });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Login failed';
      setError(String(message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <Title level={3} className={styles.title}>
          Sign in
        </Title>
        <Paragraph type="secondary" className={styles.hint}>
          Seeded accounts: <Text code>demo@collab.dev / demo1234</Text> or{' '}
          <Text code>reviewer@collab.dev / reviewer1234</Text>
        </Paragraph>
        <Form<LoginValues>
          layout="vertical"
          initialValues={{ email: 'demo@collab.dev', password: 'demo1234' }}
          onFinish={onFinish}
          requiredMark={false}
        >
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
              Sign in
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
