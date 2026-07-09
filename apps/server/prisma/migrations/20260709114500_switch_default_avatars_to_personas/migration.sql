-- Switch default avatars from initials placeholders to DiceBear Personas.
ALTER TABLE "User"
ALTER COLUMN "avatarUrl" SET DEFAULT 'https://api.dicebear.com/9.x/personas/svg?seed=Dong';

UPDATE "User"
SET "avatarUrl" = 'https://api.dicebear.com/9.x/personas/svg?seed=Dong'
WHERE "avatarUrl" IS NULL
  OR "avatarUrl" = ''
  OR "avatarUrl" LIKE '/avatars/%'
  OR "avatarUrl" LIKE 'https://api.dicebear.com/9.x/initials/svg%';
