import type { WidgetProps } from '../registry';

export function MetricWidget({ props, updateProps, selected }: WidgetProps) {
  const label = (props.label as string | undefined) ?? 'Metric';
  const value = (props.value as string | undefined) ?? '42%';
  const caption = (props.caption as string | undefined) ?? 'Editable card widget';

  return (
    <section
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        padding: 14,
        background: '#fff',
        maxWidth: 280,
        boxShadow: selected ? '0 4px 14px rgba(0,0,0,0.06)' : undefined,
      }}
    >
      <input
        aria-label="Metric label"
        value={label}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => updateProps({ ...props, label: e.target.value })}
        style={{
          width: '100%',
          border: 0,
          outline: selected ? undefined : 'none',
          color: '#6b7280',
          fontSize: 12,
          background: 'transparent',
        }}
      />
      <input
        aria-label="Metric value"
        value={value}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => updateProps({ ...props, value: e.target.value })}
        style={{
          width: '100%',
          border: 0,
          outline: selected ? undefined : 'none',
          color: '#111827',
          fontWeight: 700,
          fontSize: 30,
          lineHeight: 1.2,
          background: 'transparent',
          margin: '4px 0',
        }}
      />
      <input
        aria-label="Metric caption"
        value={caption}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => updateProps({ ...props, caption: e.target.value })}
        style={{
          width: '100%',
          border: 0,
          outline: selected ? undefined : 'none',
          color: '#6b7280',
          fontSize: 12,
          background: 'transparent',
        }}
      />
    </section>
  );
}
