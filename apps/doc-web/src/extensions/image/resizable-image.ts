import Image from '@tiptap/extension-image';

export interface ResizableImageOptions {
  /** Default width when no width attribute is set */
  defaultWidth: string;
}

export const ResizableImage = Image.extend<ResizableImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      defaultWidth: '320px',
      inline: true,
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: this.options.defaultWidth,
        renderHTML: (attrs) => {
          if (!attrs.width) {
            return {};
          }
          return { style: `width: ${attrs.width}` };
        },
        parseHTML: (el) => el.style.width || el.getAttribute('width') || this.options.defaultWidth,
      },
    };
  },
});
