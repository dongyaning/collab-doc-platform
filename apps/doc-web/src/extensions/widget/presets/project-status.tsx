import type { WidgetProps } from '../registry';

type Health = 'on-track' | 'at-risk' | 'blocked';

const HEALTH_LABEL: Record<Health, string> = {
  'on-track': 'On track',
  'at-risk': 'At risk',
  blocked: 'Blocked',
};

const HEALTH_STYLE: Record<Health, { background: string; color: string; border: string }> = {
  'on-track': { background: '#ecfdf5', color: '#047857', border: '#a7f3d0' },
  'at-risk': { background: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  blocked: { background: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
};

function readHealth(value: unknown): Health {
  if (value === 'at-risk' || value === 'blocked') {
    return value;
  }
  return 'on-track';
}

function readProgress(value: unknown): number {
  const progress = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(progress)) {
    return 65;
  }
  return Math.min(100, Math.max(0, Math.round(progress)));
}

function TextAreaField({
  label,
  value,
  editable,
  onChange,
}: {
  label: string;
  value: string;
  editable: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ color: '#64748b', fontSize: 12, fontWeight: 600 }}>{label}</div>
      {editable ? (
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
        <div style={{ color: '#1f2937', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {value}
        </div>
      )}
    </div>
  );
}

export function ProjectStatusWidget({ props, updateProps, editable }: WidgetProps) {
  const title = (props.title as string | undefined) ?? 'Project status';
  const owner = (props.owner as string | undefined) ?? 'Owner';
  const progress = readProgress(props.progress);
  const health = readHealth(props.health);
  const summary = (props.summary as string | undefined) ?? 'What changed since the last update?';
  const risks = (props.risks as string | undefined) ?? 'Main risks or blockers.';
  const nextSteps =
    (props.nextSteps as string | undefined) ?? 'Next steps before the next checkpoint.';
  const healthStyle = HEALTH_STYLE[health];

  const updateField = (key: string, value: string | number) => {
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
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          {editable ? (
            <input
              aria-label="Project title"
              value={title}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => updateField('title', event.target.value)}
              style={{
                width: '100%',
                border: 0,
                outline: 'none',
                fontWeight: 700,
                fontSize: 15,
                background: 'transparent',
              }}
            />
          ) : (
            <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          )}
          {editable ? (
            <input
              aria-label="Project owner"
              value={owner}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => updateField('owner', event.target.value)}
              style={{
                width: '100%',
                border: 0,
                outline: 'none',
                color: '#64748b',
                marginTop: 2,
              }}
            />
          ) : (
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{owner}</div>
          )}
        </div>

        {editable ? (
          <select
            aria-label="Project health"
            value={health}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => updateField('health', event.target.value)}
            style={{
              height: 28,
              border: `1px solid ${healthStyle.border}`,
              borderRadius: 999,
              padding: '2px 8px',
            }}
          >
            {Object.entries(HEALTH_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          <span
            style={{
              height: 24,
              border: `1px solid ${healthStyle.border}`,
              borderRadius: 999,
              background: healthStyle.background,
              color: healthStyle.color,
              padding: '2px 8px',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {HEALTH_LABEL[health]}
          </span>
        )}
      </div>

      <div style={{ margin: '12px 0' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            color: '#64748b',
            fontSize: 12,
          }}
        >
          <span>Progress</span>
          <span>{progress}%</span>
        </div>
        <div
          style={{
            height: 8,
            borderRadius: 999,
            background: '#e5e7eb',
            overflow: 'hidden',
            marginTop: 6,
          }}
        >
          <div style={{ width: `${progress}%`, height: '100%', background: '#2563eb' }} />
        </div>
        {editable ? (
          <input
            aria-label="Project progress"
            type="range"
            min={0}
            max={100}
            value={progress}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => updateField('progress', Number(event.target.value))}
            style={{ width: '100%', marginTop: 8 }}
          />
        ) : null}
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <TextAreaField
          label="Summary"
          value={summary}
          editable={editable}
          onChange={(next) => updateField('summary', next)}
        />
        <TextAreaField
          label="Risks"
          value={risks}
          editable={editable}
          onChange={(next) => updateField('risks', next)}
        />
        <TextAreaField
          label="Next steps"
          value={nextSteps}
          editable={editable}
          onChange={(next) => updateField('nextSteps', next)}
        />
      </div>
    </section>
  );
}
