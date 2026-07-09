import type { WidgetProps } from '../registry';

type DecisionStatus = 'proposed' | 'accepted' | 'rejected';

const STATUS_LABEL: Record<DecisionStatus, string> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

const STATUS_STYLE: Record<DecisionStatus, { background: string; color: string; border: string }> =
  {
    proposed: { background: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
    accepted: { background: '#ecfdf5', color: '#047857', border: '#a7f3d0' },
    rejected: { background: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
  };

function readStatus(value: unknown): DecisionStatus {
  if (value === 'accepted' || value === 'rejected') {
    return value;
  }
  return 'proposed';
}

function TextField({
  label,
  value,
  editable,
  multiline,
  onChange,
}: {
  label: string;
  value: string;
  editable: boolean;
  multiline?: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ color: '#64748b', fontSize: 12, fontWeight: 600 }}>{label}</div>
      {editable ? (
        multiline ? (
          <textarea
            aria-label={label}
            value={value}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onChange(event.target.value)}
            style={{
              width: '100%',
              minHeight: 58,
              border: '1px solid #e5e7eb',
              borderRadius: 4,
              padding: 8,
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
        ) : (
          <input
            aria-label={label}
            value={value}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onChange(event.target.value)}
            style={{
              width: '100%',
              border: '1px solid #e5e7eb',
              borderRadius: 4,
              padding: '6px 8px',
            }}
          />
        )
      ) : (
        <div style={{ color: '#1f2937', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {value}
        </div>
      )}
    </div>
  );
}

export function DecisionRecordWidget({ props, updateProps, editable }: WidgetProps) {
  const title = (props.title as string | undefined) ?? 'Decision record';
  const status = readStatus(props.status);
  const owner = (props.owner as string | undefined) ?? 'Owner';
  const date = (props.date as string | undefined) ?? '2026-07-09';
  const context = (props.context as string | undefined) ?? 'What problem are we solving?';
  const decision = (props.decision as string | undefined) ?? 'What decision did we make?';
  const impact = (props.impact as string | undefined) ?? 'What changes after this decision?';
  const statusStyle = STATUS_STYLE[status];

  const updateField = (key: string, value: string) => {
    updateProps({ ...props, [key]: value });
  };

  return (
    <section
      style={{
        border: '1px solid #d8dee9',
        borderRadius: 6,
        background: '#ffffff',
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        {editable ? (
          <input
            aria-label="Decision title"
            value={title}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => updateField('title', event.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              border: 0,
              outline: 'none',
              fontWeight: 700,
              fontSize: 15,
              background: 'transparent',
            }}
          />
        ) : (
          <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 15 }}>{title}</div>
        )}
        {editable ? (
          <select
            aria-label="Decision status"
            value={status}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => updateField('status', event.target.value)}
            style={{
              border: `1px solid ${statusStyle.border}`,
              borderRadius: 999,
              padding: '2px 8px',
            }}
          >
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          <span
            style={{
              border: `1px solid ${statusStyle.border}`,
              borderRadius: 999,
              background: statusStyle.background,
              color: statusStyle.color,
              padding: '2px 8px',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {STATUS_LABEL[status]}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <TextField
          label="Owner"
          value={owner}
          editable={editable}
          onChange={(next) => updateField('owner', next)}
        />
        <TextField
          label="Date"
          value={date}
          editable={editable}
          onChange={(next) => updateField('date', next)}
        />
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <TextField
          label="Context"
          value={context}
          editable={editable}
          multiline
          onChange={(next) => updateField('context', next)}
        />
        <TextField
          label="Decision"
          value={decision}
          editable={editable}
          multiline
          onChange={(next) => updateField('decision', next)}
        />
        <TextField
          label="Impact"
          value={impact}
          editable={editable}
          multiline
          onChange={(next) => updateField('impact', next)}
        />
      </div>
    </section>
  );
}
