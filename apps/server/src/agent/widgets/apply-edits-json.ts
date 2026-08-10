/**
 * 服务端 JSON 级 edits 应用，供 context-builder 生成"应用未确认变更后的预览文档"注入 LLM。
 *
 * 与前端评审视图的 applyEditsToJson 同语义：内容锚点（baseContent / insertAfter）在
 * JSON 树中唯一匹配后替换。服务端预览用文本占位表达 widget 插入（不渲染真实节点）。
 */

export interface JsonEdit {
  kind?: 'text' | 'widget';
  baseContent: string;
  newText?: string;
  insertAfter?: string;
  title?: string;
}

export interface JsonEditResult {
  kind: string;
  status: 'ok' | 'not_found' | 'ambiguous';
}

interface TextNode {
  type: 'text';
  text?: string;
  [key: string]: unknown;
}

interface BlockNode {
  type: string;
  content?: JsonNode[];
  [key: string]: unknown;
}

type JsonNode = TextNode | BlockNode;

interface MatchResult {
  nodeIndex: number;
  start: number;
  end: number;
  text: string;
}

/** 在单个文本节点内查找唯一子串。 */
function findUniqueInNode(node: TextNode, needle: string): MatchResult | null {
  const text = node.text ?? '';
  const first = text.indexOf(needle);
  if (first === -1) {
    return null;
  }
  if (text.indexOf(needle, first + 1) !== -1) {
    return { nodeIndex: -1, start: -1, end: -1, text }; // ambiguous
  }
  return { nodeIndex: 0, start: first, end: first + needle.length, text };
}

/**
 * 对 doc JSON 应用 edits。返回值：新 doc 与每个 edit 的匹配结果。
 * 文本替换按位置降序应用避免漂移；widget 插入在锚点文本所在顶层块之后追加占位块。
 */
export function applyEditsToJson(
  doc: BlockNode,
  edits: JsonEdit[]
): { doc: BlockNode; results: JsonEditResult[] } {
  const root: BlockNode = structuredClone(doc);
  const results: JsonEditResult[] = [];

  for (const edit of edits) {
    if (edit.kind === 'widget') {
      const anchor = edit.insertAfter ?? '';
      const placed = insertWidgetPlaceholder(root, anchor, edit.title ?? edit.baseContent);
      results.push({ kind: 'widget', status: placed });
      continue;
    }

    const needle = edit.baseContent;
    const match = findEditTarget(root, needle);
    if (!match) {
      results.push({ kind: 'text', status: 'not_found' });
      continue;
    }
    if (match.ambiguous) {
      results.push({ kind: 'text', status: 'ambiguous' });
      continue;
    }
    replaceTextInNode(match.textNode, match.start, match.end, edit.newText ?? '');
    results.push({ kind: 'text', status: 'ok' });
  }

  return { doc: root, results };
}

interface EditTarget {
  textNode: TextNode;
  start: number;
  end: number;
  ambiguous: boolean;
}

function findEditTarget(root: BlockNode, needle: string): EditTarget | null {
  if (!needle) {
    return null;
  }
  let found: EditTarget | null = null;
  let count = 0;

  const walk = (node: JsonNode): void => {
    if (node.type === 'text') {
      const match = findUniqueInNode(node as TextNode, needle);
      if (match) {
        if (match.nodeIndex === -1) {
          count += 2; // ambiguous
          return;
        }
        count++;
        found = {
          textNode: node as TextNode,
          start: match.start,
          end: match.end,
          ambiguous: false,
        };
      }
      return;
    }
    const block = node as BlockNode;
    for (const child of block.content ?? []) {
      walk(child);
    }
  };

  walk(root);
  if (count === 0) {
    return null;
  }
  if (count > 1) {
    return { textNode: found!.textNode, start: found!.start, end: found!.end, ambiguous: true };
  }
  return found;
}

function replaceTextInNode(node: TextNode, start: number, end: number, replacement: string): void {
  const text = node.text ?? '';
  node.text = text.slice(0, start) + replacement + text.slice(end);
}

/** 在锚点文本所在顶层块之后插入 widget 占位段落。 */
function insertWidgetPlaceholder(
  root: BlockNode,
  anchor: string,
  title: string
): 'ok' | 'not_found' | 'ambiguous' {
  const children = root.content ?? [];
  if (!anchor) {
    return 'not_found';
  }

  let count = 0;
  let targetBlockIndex = -1;

  const findAnchor = (block: BlockNode, blockIndex: number): void => {
    for (const child of block.content ?? []) {
      if (child.type === 'text') {
        const text = (child as TextNode).text ?? '';
        const idx = text.indexOf(anchor);
        if (idx !== -1) {
          count++;
          targetBlockIndex = blockIndex;
        }
      }
    }
  };

  children.forEach((child, index) => findAnchor(child as BlockNode, index));
  if (count === 0) {
    return 'not_found';
  }
  if (count > 1) {
    return 'ambiguous';
  }

  const placeholder: BlockNode = {
    type: 'paragraph',
    content: [{ type: 'text', text: `[widget: ${title}]` }],
  };
  children.splice(targetBlockIndex + 1, 0, placeholder);
  return 'ok';
}
