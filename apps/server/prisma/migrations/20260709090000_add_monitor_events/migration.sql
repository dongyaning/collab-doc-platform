-- CreateTable
CREATE TABLE "MonitorEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "value" DOUBLE PRECISION,
    "duration" INTEGER,
    "userId" TEXT,
    "anonymousId" TEXT,
    "sessionId" TEXT,
    "pageViewId" TEXT,
    "traceId" TEXT,
    "route" TEXT,
    "docId" TEXT,
    "url" TEXT,
    "method" TEXT,
    "statusCode" INTEGER,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "userAgent" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonitorEvent_eventId_key" ON "MonitorEvent"("eventId");

-- CreateIndex
CREATE INDEX "MonitorEvent_app_createdAt_idx" ON "MonitorEvent"("app", "createdAt");

-- CreateIndex
CREATE INDEX "MonitorEvent_eventType_createdAt_idx" ON "MonitorEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "MonitorEvent_docId_createdAt_idx" ON "MonitorEvent"("docId", "createdAt");

-- CreateIndex
CREATE INDEX "MonitorEvent_traceId_idx" ON "MonitorEvent"("traceId");

-- CreateIndex
CREATE INDEX "MonitorEvent_sessionId_idx" ON "MonitorEvent"("sessionId");

-- CreateIndex
CREATE INDEX "MonitorEvent_status_createdAt_idx" ON "MonitorEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MonitorEvent_duration_idx" ON "MonitorEvent"("duration");
