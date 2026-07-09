-- Add avatar URL and backfill existing users before enforcing the required field.
ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;

UPDATE "User"
SET "avatarUrl" = 'https://api.dicebear.com/9.x/personas/svg?seed=Dong'
WHERE "avatarUrl" IS NULL OR "avatarUrl" = '' OR "avatarUrl" LIKE '/avatars/%';

ALTER TABLE "User"
ALTER COLUMN "avatarUrl" SET DEFAULT 'https://api.dicebear.com/9.x/personas/svg?seed=Dong';

ALTER TABLE "User" ALTER COLUMN "avatarUrl" SET NOT NULL;
