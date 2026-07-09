import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Avatar, Button, Card, Form, Input, Typography } from 'antd';
import { CameraOutlined, LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { DEFAULT_AVATAR_URL, DEFAULT_AVATARS } from '@wiseflow/shared';
import { authApi, filesApi } from '../../lib/endpoints';
import { useAuthStore } from '../../stores/auth.store';
import { WiseFlowLogo } from '../../components/wiseflow-logo';
import styles from './index.module.less';

const { Text, Title } = Typography;
const ACCEPTED_AVATAR_TYPES = 'image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml';

interface RegisterValues {
  name: string;
  email: string;
  password: string;
}

export function RegisterPage() {
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState(DEFAULT_AVATAR_URL);
  const [avatarUploadLoading, setAvatarUploadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleAvatarFile(file: File | undefined) {
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file for your avatar');
      return;
    }
    setAvatarUploadLoading(true);
    setError(null);
    try {
      const uploaded = await filesApi.uploadAvatar(file);
      setAvatarUrl(uploaded.url);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Avatar upload failed';
      setError(String(message));
    } finally {
      setAvatarUploadLoading(false);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = '';
      }
    }
  }

  async function onFinish(values: RegisterValues) {
    setLoading(true);
    setError(null);
    try {
      const { accessToken, user } = await authApi.register(
        values.email,
        values.password,
        values.name,
        avatarUrl
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
        <Form<RegisterValues> layout="vertical" onFinish={onFinish} requiredMark={false}>
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
          <Form.Item label="Avatar">
            <div className={styles.avatarPicker}>
              <Avatar size={56} src={avatarUrl} className={styles.avatarPreview}>
                <UserOutlined />
              </Avatar>
              <div className={styles.avatarOptions}>
                <div className={styles.defaultAvatars}>
                  {DEFAULT_AVATARS.map((avatar) => (
                    <button
                      key={avatar.id}
                      type="button"
                      className={styles.avatarOption}
                      data-selected={avatarUrl === avatar.url}
                      onClick={() => setAvatarUrl(avatar.url)}
                      aria-label={`Choose ${avatar.label} avatar`}
                    >
                      <Avatar
                        size={32}
                        src={avatar.url}
                        style={{ backgroundColor: avatar.color }}
                      />
                    </button>
                  ))}
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept={ACCEPTED_AVATAR_TYPES}
                  className={styles.avatarFileInput}
                  style={{ display: 'none' }}
                  onChange={(event) => void handleAvatarFile(event.target.files?.[0])}
                />
                <Button
                  icon={<CameraOutlined />}
                  loading={avatarUploadLoading}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  Upload image
                </Button>
                <Text type="secondary" className={styles.avatarHint}>
                  A default avatar is selected for you.
                </Text>
              </div>
            </div>
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
