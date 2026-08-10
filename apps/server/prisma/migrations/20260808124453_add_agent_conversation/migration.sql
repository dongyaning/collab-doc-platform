-- CreateTable
CREATE TABLE "AgentConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kbId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '新会话',
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentConversation_userId_kbId_lastMessageAt_idx" ON "AgentConversation"("userId", "kbId", "lastMessageAt");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
