import type { WidgetProps } from '../registry';

type TaskItem = {
  id: string;
  text: string;
  done: boolean;
};

function readItems(props: Record<string, unknown>): TaskItem[] {
  return Array.isArray(props.items) ? (props.items as TaskItem[]) : [];
}

function createTask(): TaskItem {
  return {
    id: `task-${Date.now()}`,
    text: 'New task',
    done: false,
  };
}

export function TaskListWidget({ props, updateProps, editable }: WidgetProps) {
  const title = (props.title as string | undefined) ?? 'Action items';
  const items = readItems(props);
  const doneCount = items.filter((item) => item.done).length;

  const updateItem = (itemId: string, next: Partial<TaskItem>) => {
    updateProps({
      ...props,
      title,
      items: items.map((item) => (item.id === itemId ? { ...item, ...next } : item)),
    });
  };

  const removeItem = (itemId: string) => {
    updateProps({ ...props, title, items: items.filter((item) => item.id !== itemId) });
  };

  const addItem = () => {
    updateProps({ ...props, title, items: [...items, createTask()] });
  };

  return (
    <section
      style={{
        border: '1px solid #d9e2ec',
        borderRadius: 6,
        background: '#ffffff',
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        {editable ? (
          <input
            aria-label="Task list title"
            value={title}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => updateProps({ ...props, title: event.target.value, items })}
            style={{
              flex: 1,
              border: 0,
              outline: 'none',
              fontWeight: 700,
              fontSize: 15,
              background: 'transparent',
            }}
          />
        ) : (
          <div style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{title}</div>
        )}
        <span style={{ color: '#64748b', fontSize: 12 }}>
          {doneCount}/{items.length}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((item) => (
          <label
            key={item.id}
            style={{
              display: 'grid',
              gridTemplateColumns: editable ? '18px minmax(0, 1fr) 28px' : '18px minmax(0, 1fr)',
              alignItems: 'center',
              gap: 8,
              color: item.done ? '#64748b' : '#1f2937',
            }}
          >
            <input
              type="checkbox"
              checked={item.done}
              disabled={!editable}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => updateItem(item.id, { done: event.target.checked })}
            />
            {editable ? (
              <input
                aria-label="Task text"
                value={item.text}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => updateItem(item.id, { text: event.target.value })}
                style={{
                  minWidth: 0,
                  border: 0,
                  outline: 'none',
                  background: 'transparent',
                  textDecoration: item.done ? 'line-through' : undefined,
                }}
              />
            ) : (
              <span style={{ textDecoration: item.done ? 'line-through' : undefined }}>
                {item.text}
              </span>
            )}
            {editable ? (
              <button
                type="button"
                aria-label="Remove task"
                onClick={(event) => {
                  event.stopPropagation();
                  removeItem(item.id);
                }}
                style={{
                  width: 24,
                  height: 24,
                  border: '1px solid #e5e7eb',
                  borderRadius: 4,
                  background: '#fff',
                  color: '#64748b',
                  cursor: 'pointer',
                }}
              >
                x
              </button>
            ) : null}
          </label>
        ))}
      </div>

      {editable ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            addItem();
          }}
          style={{
            marginTop: 10,
            border: '1px solid #cbd5e1',
            borderRadius: 4,
            background: '#f8fafc',
            color: '#334155',
            padding: '4px 8px',
            cursor: 'pointer',
          }}
        >
          Add task
        </button>
      ) : null}
    </section>
  );
}
