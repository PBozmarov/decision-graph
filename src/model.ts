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
  reviewAt?: number; // used by problem: when to look back (start of a local day)
  outcome?: Outcome; // used by problem: how the chosen path turned out
  collapsed: boolean;
};

export type OutcomeRating = -1 | 0 | 1;
export type Outcome = { rating: OutcomeRating; note?: string; at: number };

export const OUTCOME: Record<OutcomeRating, { short: string; long: string; color: string }> = {
  1: { short: 'Better', long: 'Better than expected', color: 'var(--pro)' },
  0: { short: 'As expected', long: 'As expected', color: 'var(--text-2)' },
  [-1]: { short: 'Worse', long: 'Worse than expected', color: 'var(--con)' },
};

/**
 * A decided decision whose check-back date has come and that has no outcome yet.
 * Works for any decision node: a problem, or an option with sub-options (`options` are its children).
 */
export function reviewDue(node: Item, options: Item[], now = Date.now()): boolean {
  return (
    (node.kind === 'problem' || node.kind === 'option') &&
    node.reviewAt !== undefined &&
    node.reviewAt <= now &&
    !node.outcome &&
    options.some((o) => o.kind === 'option' && o.chosen && o.parentId === node.id)
  );
}

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
    children: ['requirement', 'pro', 'con', 'risk', 'action', 'note', 'option', 'problem'],
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

/** An option inside an option is a "sub-option": a variant of that path. */
const isSub = (kind: Kind, parentKind: Kind | null | undefined) => kind === 'option' && parentKind === 'option';
/** The kind's name where it sits (card header, inspector, palette, Markdown, MCP outline). */
export const kindLabel = (kind: Kind, parentKind?: Kind | null) => (isSub(kind, parentKind) ? 'Sub-option' : KINDS[kind].label);
/** What adding this kind under a `parentKind` card is called (the + menu, "Branch out"). */
export const addLabel = (kind: Kind, parentKind?: Kind | null) => (isSub(kind, parentKind) ? 'Sub-option' : KINDS[kind].addLabel);
/** The empty title's placeholder. */
export const placeholderOf = (kind: Kind, parentKind?: Kind | null) =>
  isSub(kind, parentKind) ? 'A variant of this option' : KINDS[kind].placeholder;

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

/** Counts (pro, con, risk, requirements, actions, must-haves) are the option's OWN children; net, via and scored include its sub-options. */
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
  /** pro − con − risk of its own children. */
  ownNet: number;
  /** ownNet plus the net of the counted sub-option (`via`). */
  net: number;
  /** The counted sub-option: the chosen one, else the best viable one, else null. */
  via: string | null;
  /** Direct sub-options. */
  subCount: number;
  /** Has sub-options and every one of them is blocked. */
  subBlocked: boolean;
  /** Something is weighed: its own pros/cons/risks, or those of the counted sub-option. */
  scored: boolean;
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
    ownNet: 0,
    net: 0,
    via: null,
    subCount: 0,
    subBlocked: false,
    scored: false,
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
    } else if (c.kind === 'option') s.subCount++;
  }
  s.ownNet = s.net = s.pro - s.con - s.risk;
  s.scored = s.pro + s.con + s.risk > 0;
  return s;
}

/** An option missing a must-have, or whose sub-options are all blocked, is ruled out. */
export const isBlocked = (s: Stats | null | undefined) => !!s && (s.mustMissing > 0 || s.subBlocked);

/**
 * Stats for every option, bottom-up: an option also counts its chosen sub-option or, when none is
 * chosen, its best viable one (recursively). A chosen sub-option counts even when it's blocked.
 */
export function effectiveStats(items: Item[], kids = groupChildren(items)): Map<string, Stats> {
  const out = new Map<string, Stats>();
  const visit = (o: Item): Stats => {
    const done = out.get(o.id);
    if (done) return done;
    const children = kids.get(o.id) ?? [];
    const s = optionStats(children);
    out.set(o.id, s); // set before recursing: a (corrupt) cycle can't loop forever
    const subs = children.filter((c) => c.kind === 'option');
    const subStats = subs.map(visit);
    const chosen = subs.findIndex((c) => c.chosen);
    let best = chosen;
    if (best < 0)
      subStats.forEach((t, i) => {
        if (!isBlocked(t) && (best < 0 || t.net > subStats[best].net)) best = i; // ties: the first in graph order
      });
    if (best >= 0) {
      s.via = subs[best].id;
      s.net = s.ownNet + subStats[best].net;
      s.scored ||= subStats[best].scored;
    }
    s.subBlocked = subs.length > 0 && subStats.every(isBlocked);
    return s;
  };
  for (const it of items) if (it.kind === 'option') visit(it);
  return out;
}

/** A decision node holds a choice: a problem, or an option with at least one sub-option. */
export const isDecisionNode = (it: Item, children: Item[]) =>
  it.kind === 'problem' || (it.kind === 'option' && children.some((c) => c.kind === 'option'));

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
  const viable = options.filter((o) => !isBlocked(statsOf(o.id)));
  const scored = viable.filter((o) => statsOf(o.id).scored);
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
  problem: 7,
};
/** Under an option, its sub-options sit below its details (after notes) and above its sub-decisions. */
const SUB_OPTION_ORDER = 6;
const H_GAP = 112;
const V_GAP = 16;
const KIND_GAP = 28;
const GROUP_GAP = 44;
const ROOT_GAP = 120;

export function groupChildren(items: Item[]) {
  const map = new Map<string | null, Item[]>();
  const kindOf = new Map<string, Kind>();
  for (const it of items) {
    kindOf.set(it.id, it.kind);
    const list = map.get(it.parentId);
    if (list) list.push(it);
    else map.set(it.parentId, [it]);
  }
  for (const [parentId, list] of map) {
    const underOption = parentId !== null && kindOf.get(parentId) === 'option';
    const rank = (k: Kind) => (underOption && k === 'option' ? SUB_OPTION_ORDER : ORDER[k]);
    list.sort((a, b) => rank(a.kind) - rank(b.kind));
  }
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
