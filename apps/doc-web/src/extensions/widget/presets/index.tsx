import {
  CheckSquareOutlined,
  FileDoneOutlined,
  InfoCircleOutlined,
  LineChartOutlined,
  ProjectOutlined,
} from '@ant-design/icons';
import { registerWidget, type WidgetDefinition } from '../registry';
import { CalloutWidget } from './callout';
import { DecisionRecordWidget } from './decision-record';
import { MetricWidget } from './metric';
import { ProjectStatusWidget } from './project-status';
import { TaskListWidget } from './task-list';

type TaskItem = {
  id: string;
  text: string;
  done: boolean;
};

const DEFAULT_TASK_ITEMS: TaskItem[] = [
  { id: 'task-1', text: 'Clarify owner and deadline', done: false },
  { id: 'task-2', text: 'Record follow-up decision', done: false },
];

function readString(props: Record<string, unknown>, key: string, fallback: string): string {
  return typeof props[key] === 'string' ? props[key] : fallback;
}

function createFallbackTaskId(item: Record<string, unknown>): string {
  const raw = JSON.stringify(item);
  let hash = 0;
  for (const char of raw) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `task-${hash}`;
}

function readTaskItems(props: Record<string, unknown>): TaskItem[] {
  if (!Array.isArray(props.items)) {
    return DEFAULT_TASK_ITEMS;
  }
  return props.items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      id: readString(item, 'id', createFallbackTaskId(item)),
      text: readString(item, 'text', 'New task'),
      done: item.done === true,
    }));
}

function readProgress(props: Record<string, unknown>): number {
  const progress = typeof props.progress === 'number' ? props.progress : Number(props.progress);
  if (!Number.isFinite(progress)) {
    return 65;
  }
  return Math.min(100, Math.max(0, Math.round(progress)));
}

export const PRESET_WIDGETS: WidgetDefinition[] = [
  {
    type: 'task-list',
    label: '任务清单',
    icon: <CheckSquareOutlined />,
    component: TaskListWidget,
    version: 1,
    defaultProps: {
      title: 'Action items',
      items: DEFAULT_TASK_ITEMS,
    },
    normalizeProps: (props) => ({
      title: readString(props, 'title', 'Action items'),
      items: readTaskItems(props),
    }),
  },
  {
    type: 'decision-record',
    label: '决策记录',
    icon: <FileDoneOutlined />,
    component: DecisionRecordWidget,
    version: 1,
    defaultProps: {
      title: 'Decision record',
      status: 'proposed',
      owner: 'Owner',
      date: '2026-07-09',
      context: 'What problem are we solving?',
      decision: 'What decision did we make?',
      impact: 'What changes after this decision?',
    },
    normalizeProps: (props) => ({
      title: readString(props, 'title', 'Decision record'),
      status:
        props.status === 'accepted' || props.status === 'rejected' ? props.status : 'proposed',
      owner: readString(props, 'owner', 'Owner'),
      date: readString(props, 'date', '2026-07-09'),
      context: readString(props, 'context', 'What problem are we solving?'),
      decision: readString(props, 'decision', 'What decision did we make?'),
      impact: readString(props, 'impact', 'What changes after this decision?'),
    }),
  },
  {
    type: 'project-status',
    label: '项目状态',
    icon: <ProjectOutlined />,
    component: ProjectStatusWidget,
    version: 1,
    defaultProps: {
      title: 'Project status',
      owner: 'Owner',
      progress: 65,
      health: 'on-track',
      summary: 'What changed since the last update?',
      risks: 'Main risks or blockers.',
      nextSteps: 'Next steps before the next checkpoint.',
    },
    normalizeProps: (props) => ({
      title: readString(props, 'title', 'Project status'),
      owner: readString(props, 'owner', 'Owner'),
      progress: readProgress(props),
      health: props.health === 'at-risk' || props.health === 'blocked' ? props.health : 'on-track',
      summary: readString(props, 'summary', 'What changed since the last update?'),
      risks: readString(props, 'risks', 'Main risks or blockers.'),
      nextSteps: readString(props, 'nextSteps', 'Next steps before the next checkpoint.'),
    }),
  },
  {
    type: 'callout',
    label: '提示块',
    icon: <InfoCircleOutlined />,
    component: CalloutWidget,
    version: 1,
    defaultProps: { tone: 'info', title: 'Info', body: 'Write a note here.' },
    normalizeProps: (props) => {
      const tone = props.tone === 'success' || props.tone === 'warning' ? props.tone : 'info';
      return {
        tone,
        title: readString(props, 'title', 'Info'),
        body: readString(props, 'body', 'Write a note here.'),
      };
    },
  },
  {
    type: 'metric',
    label: '指标卡',
    icon: <LineChartOutlined />,
    component: MetricWidget,
    version: 1,
    defaultProps: { label: 'Metric', value: '42%', caption: 'Editable card widget' },
    normalizeProps: (props) => ({
      label: readString(props, 'label', 'Metric'),
      value: readString(props, 'value', '42%'),
      caption: readString(props, 'caption', 'Editable card widget'),
    }),
  },
];

let registered = false;

export function registerPresetWidgets(): void {
  if (registered) return;
  PRESET_WIDGETS.forEach(registerWidget);
  registered = true;
}
