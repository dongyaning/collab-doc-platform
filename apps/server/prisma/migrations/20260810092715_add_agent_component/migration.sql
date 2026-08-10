-- CreateEnum
CREATE TYPE "AgentComponentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "AgentComponent" (
    "id" TEXT NOT NULL,
    "widgetType" TEXT NOT NULL,
    "kbId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceCode" TEXT NOT NULL,
    "jsCodeGzip" BYTEA NOT NULL,
    "propsSchema" JSONB,
    "status" "AgentComponentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentComponent_kbId_status_idx" ON "AgentComponent"("kbId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentComponent_widgetType_version_key" ON "AgentComponent"("widgetType", "version");
