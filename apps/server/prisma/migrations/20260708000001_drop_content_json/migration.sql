-- Backfill yjsState for rows that have NULL (they only have legacy content).
-- We encode an empty Yjs doc as the fallback.
UPDATE "Node"
SET "yjsState" = '\x010a000210001a0008'::bytea
WHERE "yjsState" IS NULL;

-- Now yjsState is safe to make NOT NULL.
ALTER TABLE "Node" ALTER COLUMN "yjsState" SET NOT NULL;

-- Drop the legacy JSON column.
ALTER TABLE "Node" DROP COLUMN "content";
