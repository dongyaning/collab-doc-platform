import type { WidgetProps } from '../registry';

type CalloutTone = 'info' | 'success' | 'warning';

const TONE_STYLE: Record<CalloutTone, { border: string; background: string; title: string }> = {
  info: { border: '#91caff', background: '#e6f4ff', title: 'Info' },
  success: { border: '#95de64', background: '#f6ffed', title: 'Success' },
  warning: { border: '#ffd666', background: '#fffbe6', title: 'Warning' },
};

export function CalloutWidget({ props, updateProps, selected, editable }: WidgetProps) {
  const tone = (props.tone as CalloutTone | undefined) ?? 'info';
  const title = (props.title as string | undefined) ?? TONE_STYLE[tone].title;
  const body = (props.body as string | undefined) ?? 'Write a note here.';
  const style = TONE_STYLE[tone];

  return (
    <section
      style={{
        border: `1px solid ${style.border}`,
        background: style.background,
        borderRadius: 6,
        padding: 12,
      }}
    >
      {editable ? (
        <>
          <input
            aria-label="Callout title"
            value={title}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => updateProps({ ...props, title: e.target.value, tone })}
            style={{
              width: '100%',
              border: 0,
              background: 'transparent',
              fontWeight: 600,
              fontSize: 14,
              outline: selected ? undefined : 'none',
              marginBottom: 6,
            }}
          />
          <textarea
            aria-label="Callout body"
            value={body}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => updateProps({ ...props, body: e.target.value, tone })}
            style={{
              width: '100%',
              minHeight: 54,
              border: 0,
              resize: 'vertical',
              background: 'transparent',
              outline: selected ? undefined : 'none',
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: 'inherit',
            }}
          />
        </>
      ) : (
        <>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{title}</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{body}</div>
        </>
      )}
    </section>
  );
}
