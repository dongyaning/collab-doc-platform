import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_OUT_DIR = join(SERVER_ROOT, 'assets/widget-shared');

/**
 * 共享 React 资源入口。
 *
 * React 18 官方只发布 CJS/UMD，没有可直接给浏览器用的 ESM 单文件，
 * 这里用 esbuild 把 react / react-dom / react/jsx-runtime 全部打进一个
 * ESM 文件（react-all.esm.js），供所有 Agent widget 的 iframe 通过
 * importmap 共享。importmap 把三个裸模块名都映射到同一 URL，浏览器只
 * 加载执行一次，模块实例唯一，保证 iframe 内只有一份 React（避免 hooks
 * 失效），同时 widget 编译产物只保留裸 import，不再内嵌 React。
 *
 * 注意：react-dom 的 CJS 内部存在动态 require，若 external 掉 react 再单独
 * 打包，产物会保留无法在浏览器执行的 require shim，因此必须整体 bundle。
 */

const SHARED_ENTRY = [
  `import React from 'react';`,
  `import ReactDOMClient from 'react-dom/client';`,
  `import JSXRuntime from 'react/jsx-runtime';`,
  `const {`,
  `  Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense,`,
  `  cloneElement, createContext, createElement, createFactory, createRef, forwardRef,`,
  `  isValidElement, lazy, memo, useCallback, useContext, useDebugValue, useEffect,`,
  `  useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useReducer,`,
  `  useRef, useState, useSyncExternalStore, useTransition, startTransition, version,`,
  `} = React;`,
  `export {`,
  `  Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense,`,
  `  cloneElement, createContext, createElement, createFactory, createRef, forwardRef,`,
  `  isValidElement, lazy, memo, useCallback, useContext, useDebugValue, useEffect,`,
  `  useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useReducer,`,
  `  useRef, useState, useSyncExternalStore, useTransition, startTransition, version,`,
  `};`,
  `export default React;`,
  `export const createRoot = ReactDOMClient.createRoot;`,
  `export const hydrateRoot = ReactDOMClient.hydrateRoot;`,
  `export const jsx = JSXRuntime.jsx;`,
  `export const jsxs = JSXRuntime.jsxs;`,
].join('\n');

/**
 * 构建共享 React 的 ESM 资源到指定目录。
 *
 * 服务端启动时调用一次，esbuild 构建耗时几十毫秒，
 * 产物作为静态资源由 /shared 路由提供，缓存头 immutable。
 */
export async function buildSharedReactAssets(outDir: string = DEFAULT_OUT_DIR): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const result = await build({
    stdin: { contents: SHARED_ENTRY, resolveDir: SERVER_ROOT, loader: 'js' },
    bundle: true,
    format: 'esm',
    minify: true,
    write: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  writeFileSync(join(outDir, 'react-all.esm.js'), result.outputFiles[0].text);
}
