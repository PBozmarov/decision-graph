import type { Doc } from './store';

/** Shared by the sidebar and the ⌘K palette. */
export function ago(ts: number) {
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

export function summary(doc: Doc) {
  const root = doc.items.find((i) => i.parentId === null && i.kind === 'problem');
  const options = root ? doc.items.filter((i) => i.parentId === root.id && i.kind === 'option') : [];
  const chosen = options.find((o) => o.chosen);
  return {
    title: root?.title || (doc.items.length ? 'Untitled decision' : 'New decision'),
    chosen: chosen ? chosen.title || 'Untitled option' : null,
    options: options.length,
    outcome: chosen ? root?.outcome : undefined,
  };
}
