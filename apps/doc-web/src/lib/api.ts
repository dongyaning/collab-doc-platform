import axios, { type InternalAxiosRequestConfig } from 'axios';
import { measure } from '@wiseflow/monitor-sdk';
import { useAuthStore } from '../stores/auth.store';

type TimedRequestConfig = InternalAxiosRequestConfig & {
  metadata?: {
    startedAt?: number;
  };
};

export const api = axios.create({
  baseURL: '/api',
});

function shouldIgnoreMonitor(url: string | undefined) {
  return !url || url.includes('/monitor/events');
}

function recordRequest(
  config: InternalAxiosRequestConfig | undefined,
  statusCode?: number,
  error?: unknown
) {
  const timedConfig = config as TimedRequestConfig | undefined;
  if (!timedConfig || shouldIgnoreMonitor(timedConfig.url)) {
    return;
  }
  const startedAt = timedConfig.metadata?.startedAt;
  if (!startedAt) {
    return;
  }
  const duration = Math.round(performance.now() - startedAt);
  measure('axios_request', duration, {
    errorMessage: error instanceof Error ? error.message : undefined,
    eventType: 'request',
    method: (timedConfig.method ?? 'get').toUpperCase(),
    status: statusCode && statusCode >= 400 ? 'error' : 'ok',
    statusCode,
    url: timedConfig.url,
  });
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const timedConfig = config as TimedRequestConfig;
  timedConfig.metadata = { ...(timedConfig.metadata ?? {}), startedAt: performance.now() };
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

api.interceptors.response.use(
  (res) => {
    recordRequest(res.config, res.status);
    return res;
  },
  (err) => {
    recordRequest(err?.config, err?.response?.status, err);
    if (err?.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  }
);
