import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { compileWidget, compileErrorOf } from './compile-widget.js';

describe('compileWidget', () => {
  it('compiles JSX with hooks into a self-contained ESM bundle', async () => {
    const source = [
      `import { useState } from 'react';`,
      `export default function Counter(props: any) {`,
      `  const p = props.props ?? {};`,
      `  const [n] = useState(Number(p.value ?? 0));`,
      `  return <div><span>{n}</span></div>;`,
      `}`,
    ].join('\n');

    const result = await compileWidget(source);
    const js = gunzipSync(result.jsCodeGzip).toString('utf8');

    // 自包含：产物不应残留对外部模块的 import（react/jsx-runtime 等已内联）
    expect(js).not.toMatch(/^\s*import\s/m);
    expect(js.length).toBeGreaterThan(1000);
  });

  it('reports a structured error for invalid TSX', async () => {
    await expect(compileWidget('export default function Broken( {')).rejects.toBeDefined();
    const err = compileErrorOf(
      new Error(
        'Build failed with 1 error:\nerror: Expected ")" but found "{"\n  agent-widget:agent-widget.tsx:1:38:'
      )
    );
    expect(err.message).toContain('Build failed');
  });
});
