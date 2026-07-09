export type MonitorEventType =
  | 'web_vital'
  | 'resource'
  | 'request'
  | 'error'
  | 'business'
  | 'custom';

export type MonitorEventStatus = 'ok' | 'error';

export interface MonitorEventPayload {
  eventId?: string;
  eventType: MonitorEventType;
  name: string;
  app?: string;
  timestamp?: number;
  status?: MonitorEventStatus;
  value?: number;
  duration?: number;
  userId?: string;
  anonymousId?: string;
  sessionId?: string;
  pageViewId?: string;
  traceId?: string;
  route?: string;
  docId?: string;
  url?: string;
  method?: string;
  statusCode?: number;
  errorMessage?: string;
  userAgent?: string;
  browser?: string;
  os?: string;
  metadata?: Record<string, unknown>;
}

export interface MonitorEventRecord extends MonitorEventPayload {
  id: string;
  eventId: string;
  app: string;
  timestamp: number;
  createdAt: string;
}

export interface MonitorIngestRequest {
  app: string;
  events: MonitorEventPayload[];
}

export interface MonitorSummary {
  eventCount: number;
  avgDocOpenDuration: number | null;
  p75DocOpenDuration: number | null;
  p95DocOpenDuration: number | null;
  errorCount: number;
  slowRequestCount: number;
}

export interface MonitorTrendPoint {
  bucket: string;
  avgDocOpenDuration: number | null;
  errorCount: number;
  requestCount: number;
}

export interface MonitorSlowRequest {
  id: string;
  name: string;
  url: string | null;
  method: string | null;
  statusCode: number | null;
  duration: number | null;
  route: string | null;
  docId: string | null;
  createdAt: string;
}

export interface MonitorSlowDoc {
  docId: string;
  count: number;
  avgDuration: number | null;
  p95Duration: number | null;
  lastSeenAt: string;
}

export interface MonitorErrorEvent {
  id: string;
  name: string;
  errorMessage: string | null;
  route: string | null;
  docId: string | null;
  userId: string | null;
  createdAt: string;
}
