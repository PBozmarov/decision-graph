export type Kind = 'problem' | 'option' | 'requirement' | 'pro' | 'con' | 'risk' | 'action' | 'note';

export type Item = {
  id: string;
  parentId: string | null;
  kind: Kind;
  title: string;
  notes: string;
  weight: number; // 1–5, used by pro / con / risk
  met: boolean; // used by requirement
  done?: boolean; // used by action
  chosen: boolean; // used by option
  collapsed: boolean;
};

export const KINDS: Record<
  Kind,
  { label: string; addLabel: string; children: Kind[]; placeholder: string }
> = {
  problem: {
    label: 'Decision',
    addLabel: 'Sub-decision',
    children: ['option', 'note'],
    placeholder: 'What are you deciding?',
  },
  option: {
    label: 'Option',
    addLabel: 'Option',
    children: ['requirement', 'pro', 'con', 'risk', 'action', 'note', 'problem'],
    placeholder: 'A path you could take',
  },
  requirement: {
    label: 'Requirement',
    addLabel: 'Requirement',
    children: ['action', 'note'],
    placeholder: 'What this path needs to succeed',
  },
  pro: { label: 'Pro', addLabel: 'Pro', children: ['note'], placeholder: 'Why this path is good' },
  con: { label: 'Con', addLabel: 'Con', children: ['note'], placeholder: 'What you give up' },
  risk: { label: 'Risk', addLabel: 'Risk', children: ['note'], placeholder: 'What could go wrong' },
  action: { label: 'Action', addLabel: 'Action', children: ['note'], placeholder: 'Something to do or check' },
  note: { label: 'Note', addLabel: 'Note', children: [], placeholder: 'Write a note…' },
};

export const isWeighted = (k: Kind) => k === 'pro' || k === 'con' || k === 'risk';

export const SIZE: Record<Kind, { w: number; h: number }> = {
  problem: { w: 300, h: 132 },
  option: { w: 272, h: 140 },
  requirement: { w: 252, h: 96 },
  pro: { w: 252, h: 96 },
  con: { w: 252, h: 96 },
  risk: { w: 252, h: 96 },
  action: { w: 252, h: 96 },
  note: { w: 252, h: 96 },
};

export function makeItem(parentId: string | null, kind: Kind, title = ''): Item {
  return {
    id: crypto.randomUUID(),
    parentId,
    kind,
    title,
    notes: '',
    weight: 3,
    met: false,
    chosen: false,
    collapsed: false,
  };
}

/* ---------- stats ---------- */

export type Stats = {
  pro: number;
  con: number;
  risk: number;
  reqMet: number;
  reqTotal: number;
  net: number;
};

export function optionStats(children: Item[]): Stats {
  const s: Stats = { pro: 0, con: 0, risk: 0, reqMet: 0, reqTotal: 0, net: 0 };
  for (const c of children) {
    if (c.kind === 'pro') s.pro += c.weight;
    else if (c.kind === 'con') s.con += c.weight;
    else if (c.kind === 'risk') s.risk += c.weight;
    else if (c.kind === 'requirement') {
      s.reqTotal++;
      if (c.met) s.reqMet++;
    }
  }
  s.net = s.pro - s.con - s.risk;
  return s;
}

/* ---------- layout (left → right tidy tree) ---------- */

const ORDER: Record<Kind, number> = {
  option: 0,
  requirement: 0,
  pro: 1,
  con: 2,
  risk: 3,
  action: 4,
  note: 5,
  problem: 6,
};
const H_GAP = 112;
const V_GAP = 16;
const KIND_GAP = 28;
const GROUP_GAP = 44;
const ROOT_GAP = 120;

export function groupChildren(items: Item[]) {
  const map = new Map<string | null, Item[]>();
  for (const it of items) {
    const list = map.get(it.parentId);
    if (list) list.push(it);
    else map.set(it.parentId, [it]);
  }
  for (const list of map.values()) list.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  return map;
}

export function layout(items: Item[]) {
  const kids = groupChildren(items);
  const visKids = (it: Item) => (it.collapsed ? [] : kids.get(it.id) ?? []);
  const subH = new Map<string, number>();
  const pos = new Map<string, { x: number; y: number }>();

  const gap = (a: Item, b: Item) =>
    visKids(a).length || visKids(b).length ? GROUP_GAP : a.kind !== b.kind ? KIND_GAP : V_GAP;

  const blockHeight = (ks: Item[]) =>
    ks.reduce((t, k, i) => t + subH.get(k.id)! + (i ? gap(ks[i - 1], k) : 0), 0);

  const measure = (it: Item): number => {
    const ks = visKids(it);
    ks.forEach(measure);
    const h = Math.max(SIZE[it.kind].h, blockHeight(ks));
    subH.set(it.id, h);
    return h;
  };

  const place = (it: Item, x: number, top: number) => {
    const { w, h } = SIZE[it.kind];
    const sh = subH.get(it.id)!;
    pos.set(it.id, { x, y: top + sh / 2 - h / 2 });
    const ks = visKids(it);
    let y = top + (sh - blockHeight(ks)) / 2;
    ks.forEach((k, i) => {
      if (i) y += gap(ks[i - 1], k);
      place(k, x + w + H_GAP, y);
      y += subH.get(k.id)!;
    });
  };

  let top = 0;
  for (const r of kids.get(null) ?? []) {
    measure(r);
    place(r, 0, top);
    top += subH.get(r.id)! + ROOT_GAP;
  }
  return pos;
}

/* ---------- reorder ---------- */

/** Move `id` to position `index` among its siblings of the same kind. */
export function applyMove(items: Item[], id: string, index: number): Item[] {
  const it = items.find((i) => i.id === id);
  if (!it) return items;
  const rest = items.filter((i) => i.id !== id);
  const group = rest.filter((i) => i.parentId === it.parentId && i.kind === it.kind);
  const current = items
    .filter((i) => i.parentId === it.parentId && i.kind === it.kind)
    .findIndex((i) => i.id === id);
  if (current === index) return items;
  if (!group.length) return items;
  const at =
    index >= group.length
      ? rest.indexOf(group[group.length - 1]) + 1
      : rest.indexOf(group[Math.max(0, index)]);
  return [...rest.slice(0, at), it, ...rest.slice(at)];
}

/* ---------- sample ---------- */

export function sampleItems(): Item[] {
  const out: Item[] = [];
  const add = (parent: Item | null, kind: Kind, title: string, extra: Partial<Item> = {}) => {
    const it = { ...makeItem(parent?.id ?? null, kind, title), ...extra };
    out.push(it);
    return it;
  };

  const root = add(null, 'problem', 'Which database should power the new orders service?', {
    notes: 'Needs to handle ~5k writes/sec at peak and support reporting queries.',
  });

  const pg = add(root, 'option', 'PostgreSQL');
  add(pg, 'requirement', 'Team already knows SQL', { met: true });
  add(pg, 'requirement', 'Managed hosting on RDS', { met: true });
  add(pg, 'pro', 'Strong consistency and real transactions', { weight: 5 });
  add(pg, 'pro', 'Mature ecosystem and tooling', { weight: 4 });
  add(pg, 'con', 'Horizontal scaling takes real effort', { weight: 3 });
  add(pg, 'risk', 'Schema migrations slow down releases', { weight: 2 });

  const mongo = add(root, 'option', 'MongoDB');
  const budget = add(mongo, 'requirement', 'Budget approval for Atlas', { met: false });
  add(budget, 'action', 'Ask finance for the Atlas budget');
  add(mongo, 'pro', 'Flexible schema while the domain evolves', { weight: 3 });
  add(mongo, 'pro', 'Easy horizontal scaling', { weight: 3 });
  add(mongo, 'con', 'Weaker multi-document transactions', { weight: 4 });
  add(mongo, 'risk', 'Inconsistent data creeping in', { weight: 3 });

  const dyn = add(root, 'option', 'DynamoDB');
  add(dyn, 'requirement', 'Access patterns known up front', { met: false });
  add(dyn, 'pro', 'Zero ops, scales effortlessly', { weight: 5 });
  add(dyn, 'con', 'Vendor lock-in to AWS', { weight: 4 });
  add(dyn, 'con', 'Ad-hoc reporting queries are hard', { weight: 4 });
  add(dyn, 'action', 'Check pricing for our expected load');
  const sub = add(dyn, 'problem', 'Single-table design or one table per entity?');
  add(sub, 'option', 'Single-table design');
  add(sub, 'option', 'Table per entity');

  return out;
}
