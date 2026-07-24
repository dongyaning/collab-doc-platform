-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM (
    'QUEUED',
    'PREPARING_CONTEXT',
    'REASONING',
    'AWAITING_TOOL',
    'AWAITING_CONFIRMATION',
    'APPLYING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'BUDGET_EXHAUSTED'
);

-- CreateEnum
CREATE TYPE "AgentProposalStatus" AS ENUM (
    'PENDING',
    'CONFIRMED',
    'APPLYING',
    'APPLIED',
    'REJECTED',
    'EXPIRED',
    'STALE'
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kbId" TEXT NOT NULL,
    "nodeId" TEXT,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "message" TEXT NOT NULL,
    "modelName" TEXT NOT NULL DEFAULT 'mock',
    "budgetJson" JSONB,
    "finalAnswer" TEXT,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentProposal" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "patch" JSONB NOT NULL,
    "affectedRange" JSONB,
    "status" "AgentProposalStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_conversationId_createdAt_idx" ON "AgentRun"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_userId_createdAt_idx" ON "AgentRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_kbId_createdAt_idx" ON "AgentRun"("kbId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentProposal_runId_idx" ON "AgentProposal"("runId");

-- CreateIndex
CREATE INDEX "AgentProposal_nodeId_status_idx" ON "AgentProposal"("nodeId", "status");

-- CreateIndex
CREATE INDEX "AgentProposal_status_expiresAt_idx" ON "AgentProposal"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "AgentProposal"
ADD CONSTRAINT "AgentProposal_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "AgentRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
