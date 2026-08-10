import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const reviewAddMarkName = 'reviewAdd';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    reviewAdd: {
      /** 给选区包裹评审标记（editId 标识归属）。 */
      setReviewAddMark: (editId: string) => ReturnType;
    };
  }
}

export interface ReviewEditInfo {
  editId: string;
  kind: 'text' | 'widget';
  status: 'ok' | 'not_found' | 'ambiguous';
  baseContent: string;
  from: number;
  to: number;
}

export interface ReviewHighlightOptions {
  /** 应用后的 edit 位置信息，用于 removed 叠加与可编辑判断。 */
  edits: ReviewEditInfo[];
}

/**
 * 评审高亮扩展：added 文本（reviewAdd mark）绿底、removed 原文红底叠加、
 * 仅变更区域可编辑（props.editable 按选区是否落在 reviewAdd mark 内判断）。
 */
export const ReviewHighlightExtension = Extension.create<ReviewHighlightOptions>({
  name: 'reviewHighlight',

  addOptions() {
    return { edits: [] };
  },

  addCommands() {
    return {
      setReviewAddMark:
        (editId: string) =>
        ({ commands }) => {
          return commands.setMark(reviewAddMarkName, { editId });
        },
    };
  },

  addMarks() {
    return [
      {
        name: reviewAddMarkName,
        inclusive: true,
        spanning: true,
        parseHTML() {
          return [{ tag: 'span[data-review-add]' }];
        },
        renderHTML({ mark }: { mark: { attrs: { editId?: string | null } } }) {
          return ['span', { class: 'review-add', 'data-review-add': mark.attrs.editId }];
        },
        addAttributes() {
          return {
            editId: { default: null },
          };
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const key = new PluginKey('reviewHighlight');
    const getEdits = () => this.options.edits;

    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            for (const edit of getEdits()) {
              if (edit.status !== 'ok') {
                continue;
              }
              if (edit.kind === 'text') {
                // removed 原文以 widget decoration 叠加在替换位置前（红底删除线）
                decos.push(
                  Decoration.widget(edit.from, () => {
                    const span = document.createElement('span');
                    span.className = 'review-removed';
                    span.textContent = `− ${edit.baseContent}`;
                    return span;
                  })
                );
              } else {
                decos.push(
                  Decoration.widget(edit.from, () => {
                    const span = document.createElement('span');
                    span.className = 'review-widget-tag';
                    span.textContent = '新增组件';
                    return span;
                  })
                );
              }
            }
            return DecorationSet.create(state.doc, decos);
          },
          editable(state) {
            const { from, to } = state.selection;
            const inMark = (pos: number): boolean => {
              const posResolved = state.doc.resolve(pos);
              const marks = posResolved.marks();
              return marks.some((m) => m.type.name === reviewAddMarkName);
            };
            if (from === to) {
              return inMark(from);
            }
            return inMark(from) && inMark(to - 1);
          },
        },
      }),
    ];
  },
});
