import { useEffect, useState } from 'react';
import { Avatar, type AvatarProps } from 'antd';

type UserAvatarProps = Omit<AvatarProps, 'children' | 'onError' | 'src'> & {
  avatarUrl?: string;
  fallbackName?: string;
  fallbackBackground?: string;
};

function avatarFallback(name: string | undefined): string {
  return (name?.trim().slice(0, 1) || 'A').toUpperCase();
}

export function UserAvatar({
  avatarUrl,
  fallbackName,
  fallbackBackground = '#3b5bdb',
  style,
  ...props
}: UserAvatarProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const hasAvatar = Boolean(avatarUrl && failedAvatarUrl !== avatarUrl);

  useEffect(() => {
    setFailedAvatarUrl(null);
  }, [avatarUrl]);

  return (
    <Avatar
      {...props}
      src={hasAvatar ? avatarUrl : undefined}
      style={{
        ...style,
        backgroundColor: hasAvatar ? 'transparent' : fallbackBackground,
      }}
      onError={() => {
        setFailedAvatarUrl(avatarUrl ?? null);
        return false;
      }}
    >
      {avatarFallback(fallbackName)}
    </Avatar>
  );
}
