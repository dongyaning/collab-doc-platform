import { Node, type CommandProps } from '@tiptap/core';
import { getWidget } from './registry';

type WidgetAttrs = {
  widgetType?: string | null;
  props?: Record<string, unknown>;
};

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
          const def = getWidget(widgetType);
          return commands.insertContent({
            type: this.name,
            attrs: { widgetType, props: props ?? def?.defaultProps ?? {} },
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
        'data-widget-props': JSON.stringify(node.attrs.props),
      },
    ];
  },
});
