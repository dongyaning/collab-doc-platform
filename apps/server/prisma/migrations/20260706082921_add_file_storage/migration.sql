-- CreateTable
CREATE TABLE "FileStorage" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageType" TEXT NOT NULL DEFAULT 'local',
    "storagePath" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "nodeId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileStorage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FileStorage_nodeId_idx" ON "FileStorage"("nodeId");

-- CreateIndex
CREATE INDEX "FileStorage_uploadedById_idx" ON "FileStorage"("uploadedById");
