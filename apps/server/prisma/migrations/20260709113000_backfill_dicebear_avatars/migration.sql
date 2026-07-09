-- Replace obsolete frontend-local avatar URLs with service-backed/default avatar URLs.
UPDATE "User"
SET "avatarUrl" = 'https://api.dicebear.com/9.x/personas/svg?seed=Dong'
WHERE "avatarUrl" IS NULL OR "avatarUrl" = '' OR "avatarUrl" LIKE '/avatars/%';
