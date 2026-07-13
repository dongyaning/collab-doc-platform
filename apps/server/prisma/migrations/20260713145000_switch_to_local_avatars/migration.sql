-- Switch from DiceBear URLs to self-hosted local avatar SVG files.
ALTER TABLE "User"
ALTER COLUMN "avatarUrl" SET DEFAULT '/uploads/avatars/croodles-atlas.svg';

-- Map known Croodles preset seeds to local file paths.
DO $$
BEGIN
  UPDATE "User"
  SET "avatarUrl" = CASE
    WHEN "avatarUrl" = 'https://api.dicebear.com/9.x/croodles/svg?seed=Atlas' THEN '/uploads/avatars/croodles-atlas.svg'
    WHEN "avatarUrl" = 'https://api.dicebear.com/9.x/croodles/svg?seed=Juniper' THEN '/uploads/avatars/croodles-juniper.svg'
    WHEN "avatarUrl" = 'https://api.dicebear.com/9.x/croodles/svg?seed=Marigold' THEN '/uploads/avatars/croodles-marigold.svg'
    WHEN "avatarUrl" = 'https://api.dicebear.com/9.x/croodles/svg?seed=Sol' THEN '/uploads/avatars/croodles-sol.svg'
    WHEN "avatarUrl" = 'https://api.dicebear.com/9.x/croodles/svg?seed=Indigo' THEN '/uploads/avatars/croodles-indigo.svg'
    WHEN "avatarUrl" = 'https://api.dicebear.com/9.x/croodles/svg?seed=Tide' THEN '/uploads/avatars/croodles-tide.svg'
    WHEN "avatarUrl" LIKE 'https://api.dicebear.com/9.x/croodles/svg?seed=%' THEN '/uploads/avatars/croodles-user-' || substring("avatarUrl" FROM 'seed=([^&]+)') || '.svg'
    WHEN "avatarUrl" = 'https://api.dicebear.com/9.x/croodles/svg?seed=default-user' THEN '/uploads/avatars/croodles-atlas.svg'
    ELSE "avatarUrl"
  END
  WHERE "avatarUrl" LIKE 'https://api.dicebear.com/9.x/croodles/svg%';
END
$$;
