import { getViewportForBounds, type Rect } from '@xyflow/react';
import { toPng } from 'html-to-image';
import { KINDS, groupChildren, optionStats, type Item, type Kind } from './model';

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

export const docTitle = (items: Item[]) =>
  items.find((i) => i.parentId === null && i.kind === 'problem')?.title || 'Untitled decision';

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'decision';

/* ---------- Markdown ---------- */

const SECTIONS: { kind: Kind; title: string }[] = [
  { kind: 'requirement', title: 'Requirements' },
  { kind: 'pro', title: 'Pros' },
  { kind: 'con', title: 'Cons' },
  { kind: 'risk', title: 'Risks' },
  { kind: 'action', title: 'Actions' },
  { kind: 'note', title: 'Notes' },
];

export function toMarkdown(items: Item[]): string {
  const kids = groupChildren(items);
  const out: string[] = [];
  const line = (s = '') => out.push(s);
  const quote = (s: string) => s.split('\n').map((l) => `> ${l}`).join('\n');

  const bullet = (it: Item, depth: number) => {
    const pad = '  '.repeat(depth);
    const title = it.title || `Untitled ${KINDS[it.kind].label.toLowerCase()}`;
    let text: string;
    if (it.kind === 'requirement') text = `[${it.met ? 'x' : ' '}] ${title}`;
    else if (it.kind === 'action') text = `[${it.done ? 'x' : ' '}] ${title}`;
    else if (it.kind === 'pro' || it.kind === 'con' || it.kind === 'risk') text = `${title} _(impact ${it.weight}/5)_`;
    else text = title;
    line(`${pad}- ${text}`);
    if (it.notes) line(`${pad}  ${it.notes.replace(/\n/g, ' ')}`);
    // Children of leaves (e.g. an action under a requirement) nest underneath.
    for (const c of kids.get(it.id) ?? []) bullet(c, depth + 1);
  };

  const problem = (p: Item, level: number) => {
    const h = '#'.repeat(Math.min(level, 6));
    line(`${h} ${p.title || 'Untitled decision'}`);
    line();
    const options = (kids.get(p.id) ?? []).filter((k) => k.kind === 'option');
    const chosen = options.find((o) => o.chosen);
    if (chosen) {
      line(`**Decision:** ${chosen.title || 'Untitled option'}${p.decidedAt ? ` — ${fmtDate(p.decidedAt)}` : ''}`);
      line();
      if (p.rationale) {
        line(quote(`**Why:** ${p.rationale}`));
        line();
      }
    }
    if (p.notes) {
      line(p.notes);
      line();
    }
    for (const n of (kids.get(p.id) ?? []).filter((k) => k.kind === 'note')) bullet(n, 0);
    if (options.length) line();

    for (const o of options) {
      const s = optionStats(kids.get(o.id) ?? []);
      const badges = [o.chosen && '✅ Chosen', `net ${s.net > 0 ? '+' : ''}${s.net}`].filter(Boolean).join(' · ');
      line(`${'#'.repeat(Math.min(level + 1, 6))} ${o.title || 'Untitled option'} (${badges})`);
      line();
      if (o.notes) {
        line(o.notes);
        line();
      }
      const children = kids.get(o.id) ?? [];
      for (const sec of SECTIONS) {
        const list = children.filter((c) => c.kind === sec.kind);
        if (!list.length) continue;
        const extra =
          sec.kind === 'requirement'
            ? ` (${list.filter((c) => c.met).length}/${list.length} met)`
            : sec.kind === 'action'
              ? ` (${list.filter((c) => c.done).length}/${list.length} done)`
              : '';
        line(`**${sec.title}**${extra}`);
        line();
        for (const c of list) bullet(c, 0);
        line();
      }
      for (const sub of children.filter((c) => c.kind === 'problem')) problem(sub, level + 2);
    }
  };

  for (const r of kids.get(null) ?? []) problem(r, 1);
  line('---');
  line(`_Exported from Decision Graph on ${fmtDate(Date.now())}_`);
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

/* ---------- files ---------- */

export function downloadBlob(data: Blob | string, filename: string) {
  const url = typeof data === 'string' ? data : URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Render every card and line on the canvas to a PNG (independent of the current pan/zoom). */
export async function graphToPng(bounds: Rect): Promise<string> {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewport || !bounds.width) throw new Error('Nothing to export');
  const pad = 64;
  const width = Math.ceil(bounds.width + pad * 2);
  const height = Math.ceil(bounds.height + pad * 2);
  const vp = getViewportForBounds(bounds, width, height, 1, 1, 0);
  const bg = getComputedStyle(document.body).backgroundColor;
  return toPng(viewport, {
    backgroundColor: bg,
    width,
    height,
    pixelRatio: 2,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
    },
  });
}
