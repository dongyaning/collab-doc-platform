import * as Y from 'yjs';

/** The shared fragment name that @tiptap/extension-collaboration uses. */
export const TIPTAP_FRAGMENT_NAME = 'default';

/** Decode a Yjs state vector (binary) into ProseMirror JSON. */
export function decodeYjsStateToProseMirror(yjsState: Uint8Array): unknown {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, yjsState);
  const result = fromYXmlFragment(ydoc.getXmlFragment(TIPTAP_FRAGMENT_NAME));
  ydoc.destroy();
  return result;
}

function fromYXmlFragment(fragment: Y.XmlFragment): { type: string; content: unknown[] } {
  return {
    type: 'doc',
    content: fragment.toArray().flatMap((child) => fromYXmlNode(child)),
  };
}

function fromYXmlNode(node: Y.XmlElement | Y.XmlText | Y.XmlHook): unknown[] {
  if (node instanceof Y.XmlText) {
    return [{ type: 'text', text: node.toString() }];
  }
  if (!(node instanceof Y.XmlElement)) return [];

  const rawAttrs = node.getAttributes();
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawAttrs)) {
    if (value === undefined) continue;
    attrs[key] = coerceAttr(value);
  }

  const children = node.toArray().flatMap((child) => fromYXmlNode(child));
  return [
    {
      type: node.nodeName,
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
      ...(children.length > 0 ? { content: children } : {}),
    },
  ];
}

/** Yjs XML attributes are always strings; coerce numeric-looking ones back for Tiptap JSON. */
function coerceAttr(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}
