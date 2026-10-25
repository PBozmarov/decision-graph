import type { Doc } from './store';
import { IconCheck, IconPlus, IconSparkle, IconTrash } from './icons';

function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function summary(doc: Doc) {
  const root = doc.items.find((i) => i.parentId === null && i.kind === 'problem');
  const options = root ? doc.items.filter((i) => i.parentId === root.id && i.kind === 'option') : [];
  const chosen = options.find((o) => o.chosen);
  return {
    title: root?.title || (doc.items.length ? 'Untitled decision' : 'New decision'),
    chosen: chosen ? chosen.title || 'Untitled option' : null,
    options: options.length,
  };
}

export function Sidebar({
  docs,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onTemplate,
}: {
  docs: Doc[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onTemplate: () => void;
}) {
  const sorted = [...docs].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <aside className="sidebar glass">
      <header className="side-head">
        <span>Decisions</span>
        <button className="icon-btn side-new" onClick={onNew} title="New decision" aria-label="New decision">
          <IconPlus size={15} />
        </button>
      </header>

      <div className="side-list">
        {sorted.map((d) => {
          const s = summary(d);
          return (
            <div
              key={d.id}
              role="button"
              tabIndex={0}
              className={`side-row ${d.id === activeId ? 'is-active' : ''}`}
              onClick={() => onSelect(d.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(d.id);
              }}
            >
              <div className="side-title">{s.title}</div>
              <div className="side-meta">
                {s.chosen ? (
                  <span className="side-chosen">
                    <IconCheck size={11} /> {s.chosen}
                  </span>
                ) : (
                  <span>{s.options ? `${s.options} option${s.options === 1 ? '' : 's'}` : 'No options yet'}</span>
                )}
                <span className="side-dot" />
                <span>{ago(d.updatedAt)}</span>
              </div>
              <button
                className="side-del"
                title="Delete decision"
                aria-label="Delete decision"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!d.items.length || confirm(`Delete “${s.title}”? You can't undo this.`)) onDelete(d.id);
                }}
              >
                <IconTrash size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <footer className="side-foot">
        <button className="side-example" onClick={onTemplate}>
          <IconSparkle size={13} /> Start from a template
        </button>
      </footer>
    </aside>
  );
}
