import type { WidgetProps } from '../registry';

function readProgress(value: unknown): number {
  const raw = typeof value === 'string' ? value.replace('%', '') : value;
  const progress = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(progress)));
}

export function MetricWidget({ props, updateProps, selected, editable }: WidgetProps) {
  const label = (props.label as string | undefined) ?? 'Launch readiness';
  const value = readProgress(props.value ?? 72);
  const caption =
    (props.caption as string | undefined) ?? 'Core flows completed, polish in progress.';
  const target = (props.target as string | undefined) ?? 'Target: portfolio demo ready';

  const updateField = (key: string, next: string | number) => {
    updateProps({ ...props, [key]: next });
  };

  return (
    <section
      style={{
        border: '1px solid #d8dee9',
        borderRadius: 6,
        padding: 14,
        background: '#fff',
        boxShadow: selected ? '0 4px 14px rgba(0,0,0,0.06)' : undefined,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          {editable ? (
            <input
              aria-label="Metric label"
              value={label}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => updateField('label', event.target.value)}
              style={{
                width: '100%',
                border: 0,
                outline: 'none',
                color: '#111827',
                fontWeight: 700,
                fontSize: 15,
                background: 'transparent',
              }}
            />
          ) : (
            <div style={{ color: '#111827', fontWeight: 700, fontSize: 15 }}>{label}</div>
          )}
          {editable ? (
            <input
              aria-label="Metric target"
              value={target}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => updateField('target', event.target.value)}
              style={{
                width: '100%',
                border: 0,
                outline: 'none',
                color: '#64748b',
                fontSize: 12,
                background: 'transparent',
                marginTop: 2,
              }}
            />
          ) : (
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{target}</div>
          )}
        </div>
        <div style={{ color: '#2563eb', fontWeight: 800, fontSize: 28, lineHeight: 1 }}>
          {value}%
        </div>
      </div>

      <div style={{ margin: '12px 0 10px' }}>
        <div style={{ height: 8, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden' }}>
          <div style={{ width: `${value}%`, height: '100%', background: '#2563eb' }} />
        </div>
        {editable ? (
          <input
            aria-label="Metric progress"
            type="range"
            min={0}
            max={100}
            value={value}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => updateField('value', Number(event.target.value))}
            style={{ width: '100%', marginTop: 8 }}
          />
        ) : null}
      </div>

      {editable ? (
        <textarea
          aria-label="Metric caption"
          value={caption}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => updateField('caption', event.target.value)}
          style={{
            width: '100%',
            minHeight: 48,
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            padding: 8,
            resize: 'vertical',
            color: '#475569',
            fontSize: 13,
            lineHeight: 1.5,
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <div style={{ color: '#475569', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {caption}
        </div>
      )}
    </section>
  );
}
