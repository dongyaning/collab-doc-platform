import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  MonitorErrorEvent,
  MonitorEventRecord,
  MonitorSlowDoc,
  MonitorSlowRequest,
  MonitorSummary,
  MonitorTrendPoint,
} from '@wiseflow/shared';
import { PrismaService } from '../prisma/prisma.module.js';
import type { IngestMonitorEventsDto, MonitorEventDto, MonitorQueryDto } from './monitor.dto.js';

const DEFAULT_LIMIT = 50;
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SLOW_REQUEST_THRESHOLD = 1000;
const MAX_INGEST_BATCH = 100;

interface TimeRange {
  from: Date;
  to: Date;
}

function createEventId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `server_${Date.now().toString(36)}_${random}`;
}

function toDate(value: string | undefined, fallback: Date) {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('invalid date range');
  }
  return date;
}

function toLimit(value: number | string | undefined) {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  const limit = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new BadRequestException('invalid limit');
  }
  return limit;
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * ratio) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function toRecord(event: Prisma.MonitorEventGetPayload<object>): MonitorEventRecord {
  return {
    anonymousId: event.anonymousId ?? undefined,
    app: event.app,
    browser: event.browser ?? undefined,
    createdAt: event.createdAt.toISOString(),
    docId: event.docId ?? undefined,
    duration: event.duration ?? undefined,
    errorMessage: event.errorMessage ?? undefined,
    eventId: event.eventId,
    eventType: event.eventType as MonitorEventRecord['eventType'],
    id: event.id,
    metadata: event.metadata as Record<string, unknown> | undefined,
    method: event.method ?? undefined,
    name: event.name,
    os: event.os ?? undefined,
    pageViewId: event.pageViewId ?? undefined,
    route: event.route ?? undefined,
    sessionId: event.sessionId ?? undefined,
    status: event.status as MonitorEventRecord['status'] | undefined,
    statusCode: event.statusCode ?? undefined,
    timestamp: event.occurredAt.getTime(),
    traceId: event.traceId ?? undefined,
    url: event.url ?? undefined,
    userAgent: event.userAgent ?? undefined,
    userId: event.userId ?? undefined,
    value: event.value ?? undefined,
  };
}

@Injectable()
export class MonitorService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async ingest(dto: IngestMonitorEventsDto) {
    if (dto.events.length > MAX_INGEST_BATCH) {
      throw new BadRequestException(`events cannot exceed ${MAX_INGEST_BATCH}`);
    }
    const data = dto.events.map((event) => this.toCreateInput(dto.app, event));
    if (data.length === 0) {
      return { accepted: 0 };
    }
    const result = await this.prisma.monitorEvent.createMany({ data, skipDuplicates: true });
    return { accepted: result.count };
  }

  async summary(query: MonitorQueryDto): Promise<MonitorSummary> {
    const where = this.buildWhere(query);
    const [eventCount, errorCount, slowRequestCount, docOpenEvents, webVitalEvents] =
      await Promise.all([
        this.prisma.monitorEvent.count({ where }),
        this.prisma.monitorEvent.count({ where: { ...where, eventType: 'error' } }),
        this.prisma.monitorEvent.count({
          where: { ...where, eventType: 'request', duration: { gte: SLOW_REQUEST_THRESHOLD } },
        }),
        this.prisma.monitorEvent.findMany({
          where: { ...where, eventType: 'business', name: 'doc_open' },
          select: { duration: true },
        }),
        this.prisma.monitorEvent.findMany({
          where: {
            ...where,
            eventType: 'web_vital',
            name: { in: ['CLS', 'FCP', 'INP', 'LCP', 'TTFB'] },
          },
          select: { name: true, duration: true, value: true },
        }),
      ]);
    const durations = docOpenEvents
      .map((event) => event.duration)
      .filter((duration): duration is number => duration !== null);
    const webVitals = new Map<string, number[]>();
    for (const event of webVitalEvents) {
      const metricValue = event.value ?? event.duration;
      if (metricValue !== null) {
        const values = webVitals.get(event.name) ?? [];
        values.push(metricValue);
        webVitals.set(event.name, values);
      }
    }
    return {
      eventCount,
      errorCount,
      avgDocOpenDuration: average(durations),
      p75DocOpenDuration: percentile(durations, 0.75),
      p95DocOpenDuration: percentile(durations, 0.95),
      slowRequestCount,
      webVitals: {
        cls: percentile(webVitals.get('CLS') ?? [], 0.75),
        fcp: percentile(webVitals.get('FCP') ?? [], 0.75),
        inp: percentile(webVitals.get('INP') ?? [], 0.75),
        lcp: percentile(webVitals.get('LCP') ?? [], 0.75),
        ttfb: percentile(webVitals.get('TTFB') ?? [], 0.75),
      },
    };
  }

  async trends(query: MonitorQueryDto): Promise<MonitorTrendPoint[]> {
    const where = this.buildWhere(query);
    const events = await this.prisma.monitorEvent.findMany({
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, duration: true, eventType: true, name: true },
      where,
    });
    const buckets = new Map<
      string,
      { docDurations: number[]; errorCount: number; requestCount: number }
    >();
    for (const event of events) {
      const bucket = this.toHourBucket(event.createdAt);
      const current = buckets.get(bucket) ?? { docDurations: [], errorCount: 0, requestCount: 0 };
      if (event.eventType === 'business' && event.name === 'doc_open' && event.duration !== null) {
        current.docDurations.push(event.duration);
      }
      if (event.eventType === 'error') {
        current.errorCount += 1;
      }
      if (event.eventType === 'request') {
        current.requestCount += 1;
      }
      buckets.set(bucket, current);
    }
    return [...buckets.entries()].map(([bucket, value]) => ({
      avgDocOpenDuration: average(value.docDurations),
      bucket,
      errorCount: value.errorCount,
      requestCount: value.requestCount,
    }));
  }

  async slowRequests(query: MonitorQueryDto): Promise<MonitorSlowRequest[]> {
    const where = this.buildWhere(query);
    const limit = toLimit(query.limit);
    const events = await this.prisma.monitorEvent.findMany({
      orderBy: [{ duration: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      where: { ...where, eventType: 'request', duration: { gte: SLOW_REQUEST_THRESHOLD } },
    });
    return events.map((event) => ({
      createdAt: event.createdAt.toISOString(),
      docId: event.docId,
      duration: event.duration,
      id: event.id,
      method: event.method,
      name: event.name,
      route: event.route,
      statusCode: event.statusCode,
      url: event.url,
    }));
  }

  async slowDocs(query: MonitorQueryDto): Promise<MonitorSlowDoc[]> {
    const where = this.buildWhere(query);
    const events = await this.prisma.monitorEvent.findMany({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, docId: true, duration: true },
      where: { ...where, eventType: 'business', name: 'doc_open', docId: { not: null } },
    });
    const byDoc = new Map<string, { durations: number[]; lastSeenAt: Date }>();
    for (const event of events) {
      if (!event.docId || event.duration === null) {
        continue;
      }
      const current = byDoc.get(event.docId) ?? { durations: [], lastSeenAt: event.createdAt };
      current.durations.push(event.duration);
      if (event.createdAt > current.lastSeenAt) {
        current.lastSeenAt = event.createdAt;
      }
      byDoc.set(event.docId, current);
    }
    return [...byDoc.entries()]
      .map(([docId, value]) => ({
        avgDuration: average(value.durations),
        count: value.durations.length,
        docId,
        lastSeenAt: value.lastSeenAt.toISOString(),
        p95Duration: percentile(value.durations, 0.95),
      }))
      .sort((a, b) => (b.p95Duration ?? 0) - (a.p95Duration ?? 0))
      .slice(0, toLimit(query.limit));
  }

  async errors(query: MonitorQueryDto): Promise<MonitorErrorEvent[]> {
    const where = this.buildWhere(query);
    const events = await this.prisma.monitorEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: toLimit(query.limit),
      where: { ...where, eventType: 'error' },
    });
    return events.map((event) => ({
      createdAt: event.createdAt.toISOString(),
      docId: event.docId,
      errorMessage: event.errorMessage,
      id: event.id,
      name: event.name,
      route: event.route,
      userId: event.userId,
    }));
  }

  async findOne(id: string) {
    const event = await this.prisma.monitorEvent.findUnique({ where: { id } });
    return event ? toRecord(event) : null;
  }

  private toCreateInput(app: string, event: MonitorEventDto): Prisma.MonitorEventCreateManyInput {
    return {
      anonymousId: event.anonymousId,
      app: event.app ?? app,
      browser: event.browser,
      docId: event.docId,
      duration: event.duration,
      errorMessage: event.errorMessage,
      eventId: event.eventId ?? createEventId(),
      eventType: event.eventType,
      metadata: this.sanitizeMetadata(event.metadata),
      method: event.method?.toUpperCase(),
      name: event.name,
      occurredAt: event.timestamp ? new Date(event.timestamp) : new Date(),
      os: event.os,
      pageViewId: event.pageViewId,
      route: event.route,
      sessionId: event.sessionId,
      status: event.status,
      statusCode: event.statusCode,
      traceId: event.traceId,
      url: event.url,
      userAgent: event.userAgent,
      userId: event.userId,
      value: event.value,
    };
  }

  private sanitizeMetadata(
    metadata: Record<string, unknown> | undefined
  ): Prisma.InputJsonValue | undefined {
    if (!metadata) {
      return undefined;
    }
    const json = JSON.stringify(metadata, (_key, value: unknown) => {
      if (typeof value === 'string' && value.length > 1000) {
        return `${value.slice(0, 1000)}...`;
      }
      if (typeof value === 'function' || typeof value === 'symbol') {
        return undefined;
      }
      return value;
    });
    return JSON.parse(json) as Prisma.InputJsonValue;
  }

  private buildWhere(query: MonitorQueryDto): Prisma.MonitorEventWhereInput {
    const now = new Date();
    const range = this.getRange(query, now);
    return {
      createdAt: { gte: range.from, lte: range.to },
      ...(query.docId ? { docId: query.docId } : {}),
      ...(query.eventType ? { eventType: query.eventType } : {}),
    };
  }

  private getRange(query: MonitorQueryDto, now: Date): TimeRange {
    const fallbackFrom = new Date(now.getTime() - DEFAULT_LOOKBACK_MS);
    const from = toDate(query.from, fallbackFrom);
    const to = toDate(query.to, now);
    if (from > to) {
      throw new BadRequestException('from cannot be later than to');
    }
    return { from, to };
  }

  private toHourBucket(date: Date) {
    const bucket = new Date(date);
    bucket.setMinutes(0, 0, 0);
    return bucket.toISOString();
  }
}
