import type { ComponentType } from 'react';

export interface WidgetProps {
  props: Record<string, unknown>;
  updateProps: (next: Record<string, unknown>) => void;
  selected: boolean;
}

export interface WidgetDefinition {
  type: string;
  label: string;
  icon?: React.ReactNode;
  component: ComponentType<WidgetProps>;
  defaultProps?: Record<string, unknown>;
}

const registry = new Map<string, WidgetDefinition>();

export function registerWidget(def: WidgetDefinition): void {
  registry.set(def.type, def);
}

export function getWidget(type: string): WidgetDefinition | undefined {
  return registry.get(type);
}

export function listWidgets(): WidgetDefinition[] {
  return Array.from(registry.values());
}
