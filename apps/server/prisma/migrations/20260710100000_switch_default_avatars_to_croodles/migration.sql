-- Use Croodles defaults and a stable user-specific seed for generated avatars.
ALTER TABLE "User"
ALTER COLUMN "avatarUrl" SET DEFAULT 'https://api.dicebear.com/9.x/croodles/svg?seed=default-user';

UPDATE "User"
SET "avatarUrl" = 'https://api.dicebear.com/9.x/croodles/svg?seed=' || "id"
WHERE "avatarUrl" IS NULL
  OR "avatarUrl" = ''
  OR "avatarUrl" LIKE '/avatars/%'
  OR "avatarUrl" LIKE 'https://api.dicebear.com/9.x/initials/svg%'
  OR "avatarUrl" LIKE 'https://api.dicebear.com/9.x/personas/svg%'
  OR "avatarUrl" LIKE 'https://api.dicebear.com/9.x/croodles/svg%';
