import { KINDS, makeItem, type Item, type Kind } from './model';
import type { Doc } from './store';

const FORMAT = 'decision-graph-backup';

/** All decisions as a JSON file the app can restore from. */
export function toBackup(docs: Doc[]): string {
  const keep = docs.filter((d) => d.items.length);
  return JSON.stringify({ format: FORMAT, version: 1, exportedAt: Date.now(), docs: keep }, null, 2);
}

export type Restored = Pick<Doc, 'items' | 'createdAt' | 'updatedAt'>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Clean up one item; null if it isn't a usable card. */
function readItem(v: unknown): Item | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.kind !== 'string' || !(v.kind in KINDS)) return null;
  const parentId = typeof v.parentId === 'string' ? v.parentId : null;
  const base = makeItem(parentId, v.kind as Kind);
  const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : undefined);
  const bool = (k: string) => (typeof v[k] === 'boolean' ? (v[k] as boolean) : undefined);
  const weight = typeof v.weight === 'number' ? Math.min(5, Math.max(1, Math.round(v.weight))) : base.weight;
  const it: Item = {
    ...base,
    id: v.id,
    title: str('title') ?? '',
    notes: str('notes') ?? '',
    weight,
    met: bool('met') ?? false,
    chosen: bool('chosen') ?? false,
    collapsed: bool('collapsed') ?? false,
  };
  if (bool('done') !== undefined) it.done = bool('done');
  if (bool('must') !== undefined) it.must = bool('must');
  if (str('rationale') !== undefined) it.rationale = str('rationale');
  if (typeof v.decidedAt === 'number') it.decidedAt = v.decidedAt;
  if (v.gut === -1 || v.gut === 0 || v.gut === 1) it.gut = v.gut;
  if (typeof v.reviewAt === 'number' && Number.isFinite(v.reviewAt)) it.reviewAt = v.reviewAt;
  const o = v.outcome;
  if (isObj(o) && (o.rating === -1 || o.rating === 0 || o.rating === 1) && typeof o.at === 'number' && Number.isFinite(o.at)) {
    it.outcome = { rating: o.rating, at: o.at };
    if (typeof o.note === 'string') it.outcome.note = o.note;
  }
  return it;
}

/** Keep only items that hang off a root problem through allowed parent → child links. */
function connected(items: Item[]): Item[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const ok = new Map<string, boolean>();
  const check = (it: Item, seen: Set<string>): boolean => {
    const known = ok.get(it.id);
    if (known !== undefined) return known;
    if (seen.has(it.id)) return false; // cycle
    seen.add(it.id);
    let res: boolean;
    if (it.parentId === null) res = it.kind === 'problem';
    else {
      const p = byId.get(it.parentId);
      res = !!p && KINDS[p.kind].children.includes(it.kind) && check(p, seen);
    }
    ok.set(it.id, res);
    return res;
  };
  return items.filter((i) => check(i, new Set()));
}

/** Read a backup file. Throws with a short, user-facing message when it isn't one. */
export function parseBackup(text: string): Restored[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t a Decision Graph backup');
  }
  if (!isObj(data) || data.format !== FORMAT || !Array.isArray(data.docs)) {
    throw new Error('That file isn’t a Decision Graph backup');
  }
  const now = Date.now();
  const out: Restored[] = [];
  for (const d of data.docs) {
    if (!isObj(d) || !Array.isArray(d.items)) continue;
    const seen = new Set<string>();
    const items = connected(
      d.items.map(readItem).filter((i): i is Item => !!i && !seen.has(i.id) && !!seen.add(i.id)),
    );
    if (!items.length) continue;
    const createdAt = typeof d.createdAt === 'number' ? d.createdAt : now;
    const updatedAt = typeof d.updatedAt === 'number' ? d.updatedAt : now;
    out.push({ items, createdAt, updatedAt });
  }
  if (!out.length) throw new Error('No decisions found in that backup');
  return out;
}
