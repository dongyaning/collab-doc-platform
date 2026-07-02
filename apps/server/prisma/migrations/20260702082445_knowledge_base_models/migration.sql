-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('DOC', 'FOLDER');

-- CreateTable
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled',
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "kbId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "NodeType" NOT NULL DEFAULT 'DOC',
    "title" TEXT NOT NULL DEFAULT 'Untitled',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "content" JSONB NOT NULL DEFAULT '{}',
    "yjsState" BYTEA,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeVersion" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "yjsState" BYTEA NOT NULL,
    "createdById" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbMember" (
    "kbId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "DocumentRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbMember_pkey" PRIMARY KEY ("kbId","userId")
);

-- CreateIndex
CREATE INDEX "KnowledgeBase_ownerId_idx" ON "KnowledgeBase"("ownerId");

-- CreateIndex
CREATE INDEX "KnowledgeBase_updatedAt_idx" ON "KnowledgeBase"("updatedAt");

-- CreateIndex
CREATE INDEX "Node_kbId_parentId_idx" ON "Node"("kbId", "parentId");

-- CreateIndex
CREATE INDEX "Node_kbId_sortOrder_idx" ON "Node"("kbId", "sortOrder");

-- CreateIndex
CREATE INDEX "Node_updatedAt_idx" ON "Node"("updatedAt");

-- CreateIndex
CREATE INDEX "NodeVersion_nodeId_createdAt_idx" ON "NodeVersion"("nodeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NodeVersion_nodeId_version_key" ON "NodeVersion"("nodeId", "version");

-- CreateIndex
CREATE INDEX "KbMember_userId_idx" ON "KbMember"("userId");

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_kbId_fkey" FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeVersion" ADD CONSTRAINT "NodeVersion_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbMember" ADD CONSTRAINT "KbMember_kbId_fkey" FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbMember" ADD CONSTRAINT "KbMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
