import { InfoCircleOutlined, LineChartOutlined } from '@ant-design/icons';
import { registerWidget, type WidgetDefinition } from '../registry';
import { CalloutWidget } from './callout';
import { MetricWidget } from './metric';

export const PRESET_WIDGETS: WidgetDefinition[] = [
  {
    type: 'callout',
    label: '提示块',
    icon: <InfoCircleOutlined />,
    component: CalloutWidget,
    defaultProps: { tone: 'info', title: 'Info', body: 'Write a note here.' },
  },
  {
    type: 'metric',
    label: '指标卡',
    icon: <LineChartOutlined />,
    component: MetricWidget,
    defaultProps: { label: 'Metric', value: '42%', caption: 'Editable card widget' },
  },
];

let registered = false;

export function registerPresetWidgets(): void {
  if (registered) return;
  PRESET_WIDGETS.forEach(registerWidget);
  registered = true;
}
