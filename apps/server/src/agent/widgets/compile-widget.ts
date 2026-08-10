import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface CompileWidgetResult {
  /** gzip 压缩后的自包含 ESM（已 bundle React），用于入库。 */
  jsCodeGzip: Uint8Array;
  /** 未压缩产物，仅用于调试信息。 */
  size: number;
}

export interface CompileError {
  message: string;
}

/**
 * 把 Agent 产出的 TSX 组件编译为自包含 ESM bundle。
 *
 * 编译入口是服务端拼装的包装文件：import 组件源码 + createRoot 挂载逻辑，
 * react / react-dom/client 一并内联，产物是 iframe 内唯一的 React 副本，
 * 避免 iframe 内出现两份 React 导致 hooks 失效。
 */
export async function compileWidget(sourceCode: string): Promise<CompileWidgetResult> {
  const wrapper = [
    `import * as React from 'react';`,
    `import Widget from './agent-widget.tsx';`,
    `import { createRoot, type Root } from 'react-dom/client';`,
    ``,
    `let root: Root | null = null;`,
    `let currentProps: Record<string, unknown> = {};`,
    `let onPropsChange: ((p: unknown) => void) | null = null;`,
    ``,
    `export function mount(`,
    `  container: HTMLElement,`,
    `  props: unknown,`,
    `  options: { mode: 'edit' | 'read'; editable: boolean },`,
    `  cb: { onPropsChange: (p: unknown) => void } | null`,
    `): void {`,
    `  onPropsChange = cb?.onPropsChange ?? null;`,
    `  currentProps = props as Record<string, unknown>;`,
    `  root = createRoot(container);`,
    `  root.render(React.createElement(Widget, {`,
    `    props: currentProps,`,
    `    updateProps: (next: unknown) => onPropsChange?.(next),`,
    `    mode: options.mode,`,
    `    editable: options.editable,`,
    `  }));`,
    `}`,
    `export function updateProps(props: unknown): void {`,
    `  if (!root) return;`,
    `  currentProps = props as Record<string, unknown>;`,
    `  root.render(React.createElement(Widget, {`,
    `    props: currentProps,`,
    `    updateProps: (next: unknown) => onPropsChange?.(next),`,
    `    mode: 'edit',`,
    `    editable: true,`,
    `  }));`,
    `}`,
    `export function unmount(): void { root?.unmount(); root = null; }`,
  ].join('\n');

  const plugin = {
    name: 'agent-widget-source',
    setup(build: import('esbuild').PluginBuild) {
      build.onResolve({ filter: /^\.\/agent-widget\.tsx$/ }, () => ({
        path: 'agent-widget.tsx',
        namespace: 'agent-widget',
      }));
      build.onLoad({ filter: /.*/, namespace: 'agent-widget' }, () => ({
        contents: sourceCode,
        loader: 'tsx',
        // 关键：虚拟模块需要 resolveDir，否则其内部 import（如 JSX 生成的
        // react/jsx-runtime）无法从 node_modules 解析
        resolveDir: SERVER_ROOT,
      }));
    },
  };

  const result = await build({
    stdin: {
      contents: wrapper,
      resolveDir: SERVER_ROOT,
      loader: 'tsx',
    },
    plugins: [plugin],
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    write: false,
    logLevel: 'silent',
  });

  const js = result.outputFiles[0].text;
  return {
    jsCodeGzip: gzipSync(Buffer.from(js, 'utf8')),
    size: js.length,
  };
}

export function compileErrorOf(err: unknown): CompileError {
  const message = err instanceof Error ? err.message : String(err);
  // esbuild 错误信息很长，取首个 "error:" 段落前两行即可反馈给 Agent 重试。
  const lines = message.split('\n');
  const meaningful = lines
    .filter((l) => l.trim().length > 0)
    .slice(0, 4)
    .join('\n');
  return { message: meaningful };
}
