import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface CompileWidgetResult {
  /** gzip 压缩后的 ESM 产物（React 已 external，iframe 内经 importmap 共享），用于入库。 */
  jsCodeGzip: Uint8Array;
  /** 未压缩产物，仅用于调试信息。 */
  size: number;
}

export interface CompileError {
  message: string;
}

/**
 * 把 Agent 产出的 TSX 组件编译为 ESM bundle。
 *
 * 编译入口是服务端拼装的包装文件：import 组件源码 + createRoot 挂载逻辑。
 * react / react-dom / react/jsx-runtime 不打包进产物（external），iframe 内通过
 * importmap 解析到服务端提供的共享 React ESM（见 build-shared-react.ts），
 * 保证 iframe 内只有一份 React（避免 hooks 失效），同时让 widget 产物只包含业务代码。
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
    // React 相关模块不打包，产物保留裸 import，iframe 内经 importmap 解析到共享 React。
    external: ['react', 'react-dom/client', 'react/jsx-runtime'],
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
