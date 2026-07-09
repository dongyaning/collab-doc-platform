import type { ComponentType, ReactNode } from 'react';

export const DEFAULT_WIDGET_VERSION = 1;

export type WidgetMode = 'edit' | 'read';

export type WidgetAttrs = {
  widgetType?: string | null;
  version?: number;
  props?: Record<string, unknown>;
};

export interface WidgetProps {
  props: Record<string, unknown>;
  updateProps: (next: Record<string, unknown>) => void;
  selected: boolean;
  mode: WidgetMode;
  editable: boolean;
}

export interface WidgetDefinition {
  type: string;
  label: string;
  icon?: ReactNode;
  component: ComponentType<WidgetProps>;
  version?: number;
  defaultProps?: Record<string, unknown>;
  normalizeProps?: (props: Record<string, unknown>) => Record<string, unknown>;
}

const registry = new Map<string, WidgetDefinition>();

function toPlainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

export function normalizeWidgetProps(
  def: WidgetDefinition | undefined,
  props: unknown
): Record<string, unknown> {
  const next = toPlainRecord(props);
  if (!def?.normalizeProps) {
    return next;
  }
  return def.normalizeProps(next);
}

export function createWidgetAttrs(
  widgetType: string,
  props?: Record<string, unknown>
): WidgetAttrs {
  const def = getWidget(widgetType);
  const rawProps = props ?? def?.defaultProps ?? {};
  return {
    widgetType,
    version: def?.version ?? DEFAULT_WIDGET_VERSION,
    props: normalizeWidgetProps(def, rawProps),
  };
}

export function registerWidget(def: WidgetDefinition): void {
  registry.set(def.type, def);
}

export function getWidget(type: string): WidgetDefinition | undefined {
  return registry.get(type);
}

export function listWidgets(): WidgetDefinition[] {
  return Array.from(registry.values());
}
