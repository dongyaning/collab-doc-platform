-- CreateEnum
CREATE TYPE "AccessRequestScope" AS ENUM ('KNOWLEDGE_BASE', 'NODE');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED');

-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL,
    "kbId" TEXT NOT NULL,
    "nodeId" TEXT,
    "scope" "AccessRequestScope" NOT NULL,
    "requesterId" TEXT NOT NULL,
    "requestedRole" "NodeRole" NOT NULL DEFAULT 'VIEWER',
    "requestedIncludeChildren" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "approvedRole" "NodeRole",
    "approvedScope" "AccessRequestScope",
    "approvedNodeId" TEXT,
    "approvedIncludeChildren" BOOLEAN,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessRequest_kbId_status_idx" ON "AccessRequest"("kbId", "status");

-- CreateIndex
CREATE INDEX "AccessRequest_nodeId_idx" ON "AccessRequest"("nodeId");

-- CreateIndex
CREATE INDEX "AccessRequest_requesterId_status_idx" ON "AccessRequest"("requesterId", "status");

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_kbId_fkey"
    FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_nodeId_fkey"
    FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_requesterId_fkey"
    FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
