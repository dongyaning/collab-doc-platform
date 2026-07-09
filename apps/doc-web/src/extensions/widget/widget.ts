import { Node, type CommandProps } from '@tiptap/core';
import { DEFAULT_WIDGET_VERSION, createWidgetAttrs, type WidgetAttrs } from './registry';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    widget: {
      insertWidget: (widgetType: string, props?: Record<string, unknown>) => ReturnType;
    };
  }
}

export const WidgetExtension = Node.create({
  name: 'widget',

  group: 'block',

  atom: true,

  selectable: true,

  draggable: true,

  addAttributes() {
    return {
      widgetType: {
        default: null,
        renderHTML: (attrs: WidgetAttrs) => {
          if (!attrs.widgetType) return {};
          return { 'data-widget-type': attrs.widgetType };
        },
        parseHTML: (el: HTMLElement) => el.getAttribute('data-widget-type'),
      },
      version: {
        default: DEFAULT_WIDGET_VERSION,
        renderHTML: (attrs: WidgetAttrs) => ({
          'data-widget-version': String(attrs.version ?? DEFAULT_WIDGET_VERSION),
        }),
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute('data-widget-version');
          const version = Number(raw);
          return Number.isFinite(version) && version > 0 ? version : DEFAULT_WIDGET_VERSION;
        },
      },
      props: {
        default: {},
        renderHTML: (attrs: WidgetAttrs) => {
          if (!attrs.props || Object.keys(attrs.props).length === 0) {
            return {};
          }
          return { 'data-widget-props': JSON.stringify(attrs.props) };
        },
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute('data-widget-props');
          if (!raw) return {};
          try {
            return JSON.parse(raw);
          } catch {
            return {};
          }
        },
      },
    };
  },

  addCommands() {
    return {
      insertWidget:
        (widgetType: string, props?: Record<string, unknown>) =>
        ({ commands }: CommandProps) => {
          return commands.insertContent({
            type: this.name,
            attrs: createWidgetAttrs(widgetType, props),
          });
        },
    };
  },

  parseHTML() {
    return [{ tag: `div[data-widget-type]` }];
  },

  renderHTML({ node }: { node: { attrs: WidgetAttrs } }) {
    return [
      'div',
      {
        'data-widget-type': node.attrs.widgetType,
        'data-widget-version': String(node.attrs.version ?? DEFAULT_WIDGET_VERSION),
        'data-widget-props': JSON.stringify(node.attrs.props),
      },
    ];
  },
});
