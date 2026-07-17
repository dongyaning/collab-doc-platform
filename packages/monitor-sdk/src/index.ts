import type { MonitorEventPayload, MonitorEventType } from '@wiseflow/shared';

export const SDK_VERSION = '0.1.0';

export interface MonitorInitOptions {
  app: string;
  endpoint: string;
  userId?: string;
  release?: string;
  sampleRate?: number;
  batchSize?: number;
  flushInterval?: number;
  maxQueueSize?: number;
  captureFetch?: boolean;
  captureErrors?: boolean;
  captureWebVitals?: boolean;
  ignoreUrls?: Array<string | RegExp>;
}

export interface MonitorSpan {
  traceId: string;
  mark: (name: string, metadata?: Record<string, unknown>) => void;
  end: (metadata?: Record<string, unknown>) => void;
}

type MonitorContext = Record<string, unknown>;

type NormalizedEvent = MonitorEventPayload & {
  app: string;
  eventId: string;
  timestamp: number;
  anonymousId: string;
  sessionId: string;
  pageViewId: string;
};

type Timer = number;

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL = 5000;
const DEFAULT_MAX_QUEUE_SIZE = 200;
const STORAGE_ANONYMOUS_ID = 'wiseflow_monitor_anonymous_id';
const STORAGE_SESSION_ID = 'wiseflow_monitor_session_id';

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function now() {
  return Date.now();
}

function performanceNow() {
  if (!isBrowser() || !window.performance) {
    return now();
  }
  return window.performance.now();
}

function createId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function getStorageValue(storage: Storage | undefined, key: string, prefix: string) {
  if (!storage) {
    return createId(prefix);
  }
  try {
    const existing = storage.getItem(key);
    if (existing) {
      return existing;
    }
    const value = createId(prefix);
    storage.setItem(key, value);
    return value;
  } catch {
    return createId(prefix);
  }
}

function getAnonymousId() {
  return getStorageValue(
    isBrowser() ? window.localStorage : undefined,
    STORAGE_ANONYMOUS_ID,
    'anon'
  );
}

function getSessionId() {
  return getStorageValue(
    isBrowser() ? window.sessionStorage : undefined,
    STORAGE_SESSION_ID,
    'session'
  );
}

function getRoute() {
  if (!isBrowser()) {
    return undefined;
  }
  return `${window.location.pathname}${window.location.search}`;
}

function getNavigatorConnection() {
  if (!isBrowser()) {
    return undefined;
  }
  const nav = window.navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number };
  };
  if (!nav.connection) {
    return undefined;
  }
  return {
    effectiveType: nav.connection.effectiveType,
    downlink: nav.connection.downlink,
    rtt: nav.connection.rtt,
  };
}

function parseBrowser(userAgent: string) {
  if (userAgent.includes('Edg/')) {
    return 'Edge';
  }
  if (userAgent.includes('Chrome/')) {
    return 'Chrome';
  }
  if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) {
    return 'Safari';
  }
  if (userAgent.includes('Firefox/')) {
    return 'Firefox';
  }
  return 'Unknown';
}

function parseOs(userAgent: string) {
  if (userAgent.includes('Mac OS X')) {
    return 'macOS';
  }
  if (userAgent.includes('Windows')) {
    return 'Windows';
  }
  if (userAgent.includes('Android')) {
    return 'Android';
  }
  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    return 'iOS';
  }
  if (userAgent.includes('Linux')) {
    return 'Linux';
  }
  return 'Unknown';
}

function stringifyError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function normalizeUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function normalizeMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) {
    return init.method.toUpperCase();
  }
  if (typeof input !== 'string' && !(input instanceof URL) && input.method) {
    return input.method.toUpperCase();
  }
  return 'GET';
}

function shouldIgnoreUrl(url: string, endpoint: string, ignoreUrls: Array<string | RegExp>) {
  if (url.includes(endpoint)) {
    return true;
  }
  return ignoreUrls.some((rule) => {
    if (typeof rule === 'string') {
      return url.includes(rule);
    }
    return rule.test(url);
  });
}

function toMetadata(value: Record<string, unknown> | undefined) {
  return value && Object.keys(value).length > 0 ? value : undefined;
}

class MonitorCore {
  private options?: Required<
    Pick<
      MonitorInitOptions,
      | 'batchSize'
      | 'captureErrors'
      | 'captureFetch'
      | 'captureWebVitals'
      | 'flushInterval'
      | 'maxQueueSize'
    >
  > &
    MonitorInitOptions;

  private queue: NormalizedEvent[] = [];
  private context: MonitorContext = {};
  private anonymousId = getAnonymousId();
  private sessionId = getSessionId();
  private pageViewId = createId('page');
  private flushTimer?: Timer;
  private originalFetch?: typeof window.fetch;
  private teardownFns: Array<() => void> = [];
  private initialized = false;

  init(options: MonitorInitOptions) {
    if (!isBrowser()) {
      return;
    }
    this.teardown();
    this.options = {
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      captureErrors: options.captureErrors ?? true,
      captureFetch: options.captureFetch ?? true,
      captureWebVitals: options.captureWebVitals ?? true,
      flushInterval: options.flushInterval ?? DEFAULT_FLUSH_INTERVAL,
      maxQueueSize: options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
      ...options,
    };
    this.initialized = true;
    this.flushTimer = window.setInterval(() => this.flush(), this.options.flushInterval);
    this.setupUnloadFlush();
    this.setupCollectors();
  }

  setUser(userId?: string) {
    this.context.userId = userId;
  }

  setContext(context: MonitorContext) {
    this.context = { ...this.context, ...context };
  }

  clearContext(keys: string[]) {
    for (const key of keys) {
      delete this.context[key];
    }
  }

  track(eventType: MonitorEventType, name: string, payload: Partial<MonitorEventPayload> = {}) {
    this.enqueue({ ...payload, eventType, name });
  }

  measure(name: string, duration: number, payload: Partial<MonitorEventPayload> = {}) {
    this.enqueue({ ...payload, eventType: payload.eventType ?? 'business', name, duration });
  }

  startSpan(name: string, payload: Partial<MonitorEventPayload> = {}): MonitorSpan {
    const startedAt = performanceNow();
    const traceId = payload.traceId ?? createId('trace');
    const marks: Array<{ name: string; duration: number; metadata?: Record<string, unknown> }> = [];
    return {
      traceId,
      mark: (markName, metadata) => {
        const duration = Math.round(performanceNow() - startedAt);
        marks.push({ name: markName, duration, metadata });
        this.measure(`${name}_stage`, duration, {
          ...payload,
          eventType: 'business',
          traceId,
          metadata: { ...metadata, stage: markName },
        });
      },
      end: (metadata) => {
        const duration = Math.round(performanceNow() - startedAt);
        this.measure(name, duration, {
          ...payload,
          eventType: 'business',
          traceId,
          metadata: { ...metadata, marks },
        });
      },
    };
  }

  flush() {
    if (!this.options || this.queue.length === 0) {
      return;
    }
    const events = this.queue.splice(0, this.queue.length);
    const body = JSON.stringify({ app: this.options.app, events });
    window
      .fetch(this.options.endpoint, {
        body,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        method: 'POST',
      })
      .catch(() => {
        // Monitoring must never affect the host application.
      });
  }

  teardown() {
    if (this.flushTimer) {
      window.clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    for (const teardown of this.teardownFns) {
      teardown();
    }
    this.teardownFns = [];
    if (this.originalFetch) {
      window.fetch = this.originalFetch;
      this.originalFetch = undefined;
    }
    this.initialized = false;
  }

  private enqueue(event: MonitorEventPayload) {
    if (!this.options || !this.initialized) {
      return;
    }
    if (this.options.sampleRate !== undefined && Math.random() > this.options.sampleRate) {
      return;
    }
    const userAgent = window.navigator.userAgent;
    const normalized: NormalizedEvent = {
      ...event,
      app: event.app ?? this.options.app,
      eventId: event.eventId ?? createId('event'),
      timestamp: event.timestamp ?? now(),
      anonymousId: event.anonymousId ?? this.anonymousId,
      sessionId: event.sessionId ?? this.sessionId,
      pageViewId: event.pageViewId ?? this.pageViewId,
      route: event.route ?? (this.context.route as string | undefined) ?? getRoute(),
      userId: event.userId ?? (this.context.userId as string | undefined),
      userAgent: event.userAgent ?? userAgent,
      browser: event.browser ?? parseBrowser(userAgent),
      os: event.os ?? parseOs(userAgent),
      metadata: toMetadata({
        release: this.options.release,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        network: getNavigatorConnection(),
        ...this.context,
        ...event.metadata,
      }),
    };
    this.queue.push(normalized);
    if (this.queue.length > this.options.maxQueueSize) {
      this.queue.splice(0, this.queue.length - this.options.maxQueueSize);
    }
    if (this.queue.length >= this.options.batchSize) {
      this.flush();
    }
  }

  private setupCollectors() {
    if (!this.options) {
      return;
    }
    if (this.options.captureFetch) {
      this.setupFetchCollector();
    }
    if (this.options.captureErrors) {
      this.setupErrorCollector();
    }
    if (this.options.captureWebVitals) {
      this.setupWebVitalsCollector();
    }
  }

  private setupUnloadFlush() {
    const handler = () => {
      if (!this.options || this.queue.length === 0) {
        return;
      }
      const events = this.queue.splice(0, this.queue.length);
      const body = JSON.stringify({ app: this.options.app, events });
      const blob = new Blob([body], { type: 'application/json' });
      if (!navigator.sendBeacon(this.options.endpoint, blob)) {
        this.queue.unshift(...events);
      }
    };
    window.addEventListener('pagehide', handler);
    this.teardownFns.push(() => window.removeEventListener('pagehide', handler));
  }

  private setupFetchCollector() {
    if (!this.options || this.originalFetch) {
      return;
    }
    const originalFetch = window.fetch.bind(window);
    this.originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = normalizeUrl(input);
      const method = normalizeMethod(input, init);
      const ignoreUrls = this.options?.ignoreUrls ?? [];
      const shouldIgnore = this.options
        ? shouldIgnoreUrl(url, this.options.endpoint, ignoreUrls)
        : true;
      if (shouldIgnore) {
        return originalFetch(input, init);
      }
      const startedAt = performanceNow();
      try {
        const response = await originalFetch(input, init);
        this.measure('fetch_request', Math.round(performanceNow() - startedAt), {
          eventType: 'request',
          metadata: { responseType: response.type },
          method,
          status: response.ok ? 'ok' : 'error',
          statusCode: response.status,
          url,
        });
        return response;
      } catch (error) {
        this.measure('fetch_request', Math.round(performanceNow() - startedAt), {
          errorMessage: stringifyError(error),
          eventType: 'request',
          method,
          status: 'error',
          url,
        });
        throw error;
      }
    };
  }

  private setupErrorCollector() {
    const errorHandler = (event: ErrorEvent) => {
      this.track('error', 'runtime_error', {
        errorMessage: event.message,
        metadata: {
          colno: event.colno,
          filename: event.filename,
          lineno: event.lineno,
          stack: event.error instanceof Error ? event.error.stack : undefined,
        },
        status: 'error',
      });
    };
    const rejectionHandler = (event: PromiseRejectionEvent) => {
      this.track('error', 'unhandled_rejection', {
        errorMessage: stringifyError(event.reason),
        metadata: { reason: stringifyError(event.reason) },
        status: 'error',
      });
    };
    const resourceHandler = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const url =
        target instanceof HTMLImageElement || target instanceof HTMLScriptElement
          ? target.src
          : target instanceof HTMLLinkElement
            ? target.href
            : undefined;
      this.track('resource', 'resource_error', {
        metadata: { tagName: target.tagName.toLowerCase() },
        status: 'error',
        url,
      });
    };
    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', rejectionHandler);
    window.addEventListener('error', resourceHandler, true);
    this.teardownFns.push(() => window.removeEventListener('error', errorHandler));
    this.teardownFns.push(() => window.removeEventListener('unhandledrejection', rejectionHandler));
    this.teardownFns.push(() => window.removeEventListener('error', resourceHandler, true));
  }

  private setupWebVitalsCollector() {
    this.captureNavigationTiming();
    this.observePerformance('paint', (entry) => {
      if (entry.name === 'first-contentful-paint') {
        this.measure('FCP', Math.round(entry.startTime), { eventType: 'web_vital' });
      }
    });
    this.observePerformance('largest-contentful-paint', (entry) => {
      this.measure('LCP', Math.round(entry.startTime), { eventType: 'web_vital' });
    });
    this.observePerformance('layout-shift', (entry) => {
      const layoutEntry = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
      if (!layoutEntry.hadRecentInput && layoutEntry.value !== undefined) {
        this.track('web_vital', 'CLS', { value: layoutEntry.value });
      }
    });
    this.observePerformance('event', (entry) => {
      const interaction = entry as PerformanceEntry & { duration?: number; interactionId?: number };
      if (interaction.interactionId && interaction.duration !== undefined) {
        this.track('web_vital', 'INP', { value: Math.round(interaction.duration) });
      }
    });
  }

  private captureNavigationTiming() {
    window.setTimeout(() => {
      const [navigation] = performance.getEntriesByType(
        'navigation'
      ) as PerformanceNavigationTiming[];
      if (!navigation) {
        return;
      }
      this.measure('TTFB', Math.round(navigation.responseStart - navigation.requestStart), {
        eventType: 'web_vital',
      });
      this.measure('page_load', Math.round(navigation.loadEventEnd - navigation.startTime), {
        eventType: 'web_vital',
      });
    }, 0);
  }

  private observePerformance(type: string, onEntry: (entry: PerformanceEntry) => void) {
    if (!('PerformanceObserver' in window)) {
      return;
    }
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          onEntry(entry);
        }
      });
      observer.observe({ buffered: true, type });
      this.teardownFns.push(() => observer.disconnect());
    } catch {
      // Some browsers do not support every entry type.
    }
  }
}

export const monitor = new MonitorCore();

export function init(options: MonitorInitOptions) {
  monitor.init(options);
}

export function setUser(userId?: string) {
  monitor.setUser(userId);
}

export function setContext(context: MonitorContext) {
  monitor.setContext(context);
}

export function clearContext(keys: string[]) {
  monitor.clearContext(keys);
}

export function track(
  eventType: MonitorEventType,
  name: string,
  payload?: Partial<MonitorEventPayload>
) {
  monitor.track(eventType, name, payload);
}

export function measure(name: string, duration: number, payload?: Partial<MonitorEventPayload>) {
  monitor.measure(name, duration, payload);
}

export function startSpan(name: string, payload?: Partial<MonitorEventPayload>) {
  return monitor.startSpan(name, payload);
}

export function flush() {
  monitor.flush();
}
