export type Kind = 'problem' | 'option' | 'requirement' | 'pro' | 'con' | 'risk' | 'action' | 'note';

export type Item = {
  id: string;
  parentId: string | null;
  kind: Kind;
  title: string;
  notes: string;
  weight: number; // 1–5, used by pro / con / risk
  met: boolean; // used by requirement
  must?: boolean; // used by requirement: an option missing a must-have is ruled out
  done?: boolean; // used by action
  chosen: boolean; // used by option
  gut?: -1 | 0 | 1; // options: how the path feels (uneasy, neutral, good); undefined = not asked yet
  rationale?: string; // used by problem: why the chosen path won
  decidedAt?: number; // used by problem: when a path was chosen
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

/** In compact view these children of an option show as pills inside the option card. */
export const PILL_KINDS = new Set<Kind>(['requirement', 'pro', 'con', 'risk', 'action']);

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
  actDone: number;
  actTotal: number;
  mustTotal: number;
  mustMissing: number;
  net: number;
};

export function optionStats(children: Item[]): Stats {
  const s: Stats = {
    pro: 0,
    con: 0,
    risk: 0,
    reqMet: 0,
    reqTotal: 0,
    actDone: 0,
    actTotal: 0,
    mustTotal: 0,
    mustMissing: 0,
    net: 0,
  };
  for (const c of children) {
    if (c.kind === 'pro') s.pro += c.weight;
    else if (c.kind === 'con') s.con += c.weight;
    else if (c.kind === 'risk') s.risk += c.weight;
    else if (c.kind === 'requirement') {
      s.reqTotal++;
      if (c.met) s.reqMet++;
      if (c.must) {
        s.mustTotal++;
        if (!c.met) s.mustMissing++;
      }
    } else if (c.kind === 'action') {
      s.actTotal++;
      if (c.done) s.actDone++;
    }
  }
  s.net = s.pro - s.con - s.risk;
  return s;
}

/** An option missing a must-have is ruled out. */
export const isBlocked = (s: Stats | null | undefined) => !!s && s.mustMissing > 0;

/* ---------- verdict ---------- */

/** A lead of this many points or fewer is a close call. */
export const CLOSE_MARGIN = 2;
export type VerdictState = 'none' | 'decided' | 'unscored' | 'allBlocked' | 'onlyViable' | 'tie' | 'close' | 'clear';
export type VerdictRow = { id: string; title: string; net: number; blocked: boolean; chosen: boolean; pct: number; gut?: -1 | 0 | 1 };
export type Verdict = {
  state: VerdictState;
  leaderId: string | null; // drives the "Leading" badge and the green bar
  topIds: string[]; // the two best scored viable options (for tie/close wording)
  margin: number; // leader net − runner-up net
  chosenId: string | null;
  rows: VerdictRow[]; // ranked
  showBars: boolean;
  /** The gut's view next to the numbers' leader (never changes the leader, the order or the bars). */
  gutNote: { kind: 'feelsOff' } | { kind: 'disagree'; favoriteId: string } | null;
};

/** Class-name suffix per gut feeling. */
export const GUT_KEY = { [-1]: 'uneasy', 0: 'neutral', 1: 'good' } as const;

/** Which option of a decision is ahead, and how clearly. Shared by the card, inspector, compare and export. */
export function verdictOf(options: Item[], statsOf: (id: string) => Stats): Verdict {
  const net = (o: Item) => statsOf(o.id).net;
  const viable = options.filter((o) => statsOf(o.id).mustMissing === 0);
  const scored = viable.filter((o) => {
    const s = statsOf(o.id);
    return s.pro + s.con + s.risk > 0;
  });
  const byNet = (list: Item[]) => [...list].sort((a, b) => net(b) - net(a)); // Array.sort is stable

  let state: VerdictState;
  let leaderId: string | null = null;
  let topIds: string[] = [];
  let margin = 0;
  if (options.length < 2) state = 'none';
  else if (!viable.length) state = 'allBlocked';
  else if (viable.length === 1) {
    state = 'onlyViable';
    leaderId = viable[0].id;
  } else if (scored.length < 2) state = 'unscored';
  else {
    const ranked = byNet(scored);
    topIds = [ranked[0].id, ranked[1].id];
    margin = net(ranked[0]) - net(ranked[1]);
    if (margin === 0) state = 'tie';
    else {
      state = margin <= CLOSE_MARGIN ? 'close' : 'clear';
      leaderId = ranked[0].id;
    }
  }
  const chosen = options.find((o) => o.chosen);
  if (chosen) state = 'decided';

  let gutNote: Verdict['gutNote'] = null;
  const leader = state !== 'decided' && leaderId ? options.find((o) => o.id === leaderId) : undefined;
  if (leader?.gut === -1) gutNote = { kind: 'feelsOff' };
  else if (leader && leader.gut !== 1) {
    const favorites = viable.filter((o) => o.id !== leader.id && o.gut === 1);
    if (favorites.length === 1) gutNote = { kind: 'disagree', favoriteId: favorites[0].id };
  }

  const nets = viable.map(net);
  const lo = Math.min(0, ...nets);
  const hi = Math.max(...nets);
  const row = (o: Item, blocked: boolean): VerdictRow => ({
    id: o.id,
    title: o.title,
    net: net(o),
    blocked,
    chosen: o.chosen,
    pct: blocked ? 0 : hi === lo ? 100 : 14 + (86 * (net(o) - lo)) / (hi - lo),
    gut: o.gut,
  });
  const rows = [
    ...byNet(viable).map((o) => row(o, false)),
    ...options.filter((o) => !viable.includes(o)).map((o) => row(o, true)),
  ];
  const showBars = options.length >= 2 && (scored.length >= 1 || viable.length < options.length);
  return { state, leaderId, topIds, margin, chosenId: chosen?.id ?? null, rows, showBars, gutNote };
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

export type Size = { w: number; h: number };
export type LayoutOptions = {
  /** Card size per item (defaults to the fixed SIZE table). */
  size?: (it: Item) => Size;
  /** Items drawn inside their parent card instead of as their own card. */
  hidden?: Set<string>;
};

export function layout(items: Item[], opts: LayoutOptions = {}) {
  const sizeOf = opts.size ?? ((it: Item) => SIZE[it.kind]);
  const hidden = opts.hidden;
  const kids = groupChildren(items);
  const visKids = (it: Item) =>
    it.collapsed ? [] : (kids.get(it.id) ?? []).filter((k) => !hidden?.has(k.id));
  const subH = new Map<string, number>();
  const pos = new Map<string, { x: number; y: number }>();

  const gap = (a: Item, b: Item) =>
    visKids(a).length || visKids(b).length ? GROUP_GAP : a.kind !== b.kind ? KIND_GAP : V_GAP;

  const blockHeight = (ks: Item[]) =>
    ks.reduce((t, k, i) => t + subH.get(k.id)! + (i ? gap(ks[i - 1], k) : 0), 0);

  const measure = (it: Item): number => {
    const ks = visKids(it);
    ks.forEach(measure);
    const h = Math.max(sizeOf(it).h, blockHeight(ks));
    subH.set(it.id, h);
    return h;
  };

  const place = (it: Item, x: number, top: number) => {
    const { w, h } = sizeOf(it);
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

/* ---------- move ---------- */

/** Can `id` (with its branch) move under `targetId`? Shared by drag-and-drop and "Move to…". */
export function canMoveTo(items: Item[], id: string, targetId: string): boolean {
  const byId = new Map(items.map((i) => [i.id, i]));
  const it = byId.get(id);
  const target = byId.get(targetId);
  if (!it || !target || target.id === it.id || it.parentId === target.id) return false;
  if (!KINDS[target.kind].children.includes(it.kind)) return false;
  // Not into its own branch.
  for (let p = target.parentId; p; p = byId.get(p)?.parentId ?? null) if (p === id) return false;
  return true;
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
  add(pg, 'requirement', 'Team already knows SQL', { met: true, must: true });
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
  add(dyn, 'requirement', 'Access patterns known up front', { met: false, must: true });
  add(dyn, 'pro', 'Zero ops, scales effortlessly', { weight: 5 });
  add(dyn, 'con', 'Vendor lock-in to AWS', { weight: 4 });
  add(dyn, 'con', 'Ad-hoc reporting queries are hard', { weight: 4 });
  add(dyn, 'action', 'Check pricing for our expected load');
  const sub = add(dyn, 'problem', 'Single-table design or one table per entity?');
  add(sub, 'option', 'Single-table design');
  add(sub, 'option', 'Table per entity');

  return out;
}
