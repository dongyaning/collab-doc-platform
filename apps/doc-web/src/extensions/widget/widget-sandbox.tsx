import { useEffect, useRef, useState } from 'react';

export interface WidgetSandboxProps {
  jsCode: string;
  props: Record<string, unknown>;
  mode: 'edit' | 'read';
  editable: boolean;
  onPropsChange: (props: Record<string, unknown>) => void;
}

const SANDBOX_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent}
  #root{min-height:40px}
  *{box-sizing:border-box}
</style>
<script type="importmap">
{
  "imports": {
    "react": "/shared/react-all.esm.js",
    "react-dom/client": "/shared/react-all.esm.js",
    "react/jsx-runtime": "/shared/react-all.esm.js"
  }
}
</script>
</head><body><div id="root"></div>
<script type="module">
  const host = window.parent;
  const container = document.getElementById('root');
  let moduleRef = null;
  let pendingProps = null;
  let ready = false;

  window.addEventListener('message', async (e) => {
    if (e.source !== host) return;
    const data = e.data;
    if (!data || typeof data !== 'object' || data.target !== 'agent-widget') return;

    if (data.type === 'init') {
      const { jsCode, props, mode, editable } = data.payload;
      pendingProps = props;
      const blob = new Blob([jsCode], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        moduleRef = await import(url);
        moduleRef.mount(container, pendingProps, { mode, editable }, {
          onPropsChange: (next) => host.postMessage({ target: 'agent-widget-host', type: 'props-update', props: next }, '*'),
        });
        ready = true;
        const ro = new ResizeObserver(() => {
          host.postMessage({ target: 'agent-widget-host', type: 'resize', height: container.offsetHeight }, '*');
        });
        ro.observe(container);
        host.postMessage({ target: 'agent-widget-host', type: 'ready' }, '*');
      } catch (err) {
        host.postMessage({ target: 'agent-widget-host', type: 'render-error', message: String(err) }, '*');
      } finally {
        URL.revokeObjectURL(url);
      }
    } else if (data.type === 'update-props' && data.props !== undefined) {
      pendingProps = data.props;
      if (ready && moduleRef && moduleRef.updateProps) {
        moduleRef.updateProps(pendingProps);
      }
    }
  });
</script></body></html>`;

/**
 * 在 sandbox iframe 中渲染 Agent 生成的组件。
 *
 * 隔离：sandbox="allow-scripts"（不带 allow-same-origin），iframe 为 opaque origin。
 * 通信：postMessage 白名单协议，props 下发 / updateProps 回写 / 高度上报 / 错误上报。
 * React：widget 产物 external 掉 React，iframe 内 importmap 把 react / react-dom/client
 * 解析到服务端共享 ESM（/shared/*），所有 iframe 共用同一份 React，只下载一次。
 * 首次 init 携带 jsCode（iframe 内 import blob 加载），后续 props 变化走 update-props，
 * 避免重新 import 导致组件重挂载丢状态。
 */
export function WidgetSandbox(props: WidgetSandboxProps) {
  const { jsCode, props: widgetProps, mode, editable, onPropsChange } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const initSentRef = useRef(false);
  const [height, setHeight] = useState(200);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const onPropsChangeRef = useRef(onPropsChange);
  onPropsChangeRef.current = onPropsChange;

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== 'null') {
        return;
      }
      const data = event.data;
      if (!data || typeof data !== 'object' || data.target !== 'agent-widget-host') {
        return;
      }
      switch (data.type) {
        case 'ready':
          initSentRef.current = true;
          setStatus('ready');
          break;
        case 'props-update':
          onPropsChangeRef.current(data.props as Record<string, unknown>);
          break;
        case 'resize':
          if (typeof data.height === 'number') {
            setHeight(data.height);
          }
          break;
        case 'render-error':
          setStatus('error');
          setError(String(data.message ?? 'Widget render failed'));
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win || !jsCode) {
      return;
    }
    if (!initSentRef.current) {
      win.postMessage(
        {
          target: 'agent-widget',
          type: 'init',
          payload: { jsCode, props: widgetProps, mode, editable },
        },
        '*'
      );
    } else {
      win.postMessage({ target: 'agent-widget', type: 'update-props', props: widgetProps }, '*');
    }
  }, [jsCode, widgetProps, mode, editable]);

  const retry = () => {
    initSentRef.current = false;
    setStatus('loading');
    setError('');
  };

  if (status === 'error') {
    return (
      <div
        style={{
          padding: '16px',
          border: '1px dashed #d9d9d9',
          borderRadius: 6,
          color: '#c62828',
          fontSize: 13,
        }}
      >
        <div>组件渲染失败：{error}</div>
        <button type="button" onClick={retry} style={{ marginTop: 8 }}>
          重试
        </button>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      srcDoc={SANDBOX_HTML}
      style={{ width: '100%', border: 'none', height, display: 'block' }}
      title="agent-widget-sandbox"
    />
  );
}
