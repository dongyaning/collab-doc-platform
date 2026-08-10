import { useAuthStore } from '../../stores/auth.store';

export interface AgentWidgetMeta {
  widgetType: string;
  title: string;
  version: number;
  propsSchema: unknown;
  jsCode: string;
  status: string;
}

/** 会话级缓存，同版本组件只拉取一次（服务端另有 immutable 缓存）。 */
const cache = new Map<string, Promise<AgentWidgetMeta>>();

export function loadAgentWidget(widgetType: string, nodeId: string): Promise<AgentWidgetMeta> {
  const key = widgetType;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchWidget(widgetType, nodeId).catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
  }
  return pending;
}

async function fetchWidget(widgetType: string, nodeId: string): Promise<AgentWidgetMeta> {
  const token = useAuthStore.getState().token;
  const response = await fetch(
    `/api/agent/widgets/${encodeURIComponent(widgetType)}?nodeId=${encodeURIComponent(nodeId)}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }
  );
  if (!response.ok) {
    throw new Error(`Widget load failed with status ${response.status}`);
  }
  return (await response.json()) as AgentWidgetMeta;
}
