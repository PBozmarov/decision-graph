// Pure functions on a decision's `Item[]`, mirroring the app's store rules (src/store.ts).
// No I/O here: tools.ts reads a decision, applies one of these, and writes the result back.
import {
  KINDS,
  canMoveTo,
  effectiveStats,
  groupChildren,
  isBlocked,
  isDecisionNode,
  kindLabel,
  makeItem,
  reviewDue,
  verdictOf,
  type Item,
  type Kind,
  type OutcomeRating,
  type Stats,
  type Verdict,
} from '../../src/model.ts';

export type { Item, Kind };

/* ---------- limits ---------- */

export const LIMITS = {
  title: 300,
  notes: 5000,
  cardsPerCall: 300,
  depth: 8, // nesting levels of `cards` in one call (top-level cards are level 1)
} as const;

export const ALL_KINDS = Object.keys(KINDS) as Kind[];

/** A mistake in a tool call. The message tells Claude how to fix the call. */
export class GraphError extends Error {}

/* ---------- inputs ---------- */

export type Gut = 'uneasy' | 'neutral' | 'good';
export type Rating = 'worse' | 'as_expected' | 'better';

export type CardInput = {
  kind: Kind;
  title: string;
  notes?: string;
  impact?: number;
  met?: boolean;
  must_have?: boolean;
  done?: boolean;
  gut?: Gut | null;
  children?: CardInput[];
};

export type CardFields = {
  title?: string;
  notes?: string;
  impact?: number;
  met?: boolean;
  must_have?: boolean;
  done?: boolean;
  gut?: Gut | null;
  collapsed?: boolean;
  rationale?: string;
  review_on?: string | null;
  outcome?: { rating: Rating; note?: string } | null;
};

const GUT_IN: Record<Gut, -1 | 0 | 1> = { uneasy: -1, neutral: 0, good: 1 };
const GUT_OUT = { [-1]: 'uneasy', 0: 'neutral', 1: 'good' } as const;
const RATING_IN: Record<Rating, OutcomeRating> = { worse: -1, as_expected: 0, better: 1 };
const RATING_OUT = { [-1]: 'worse', 0: 'as_expected', 1: 'better' } as const;

/** Which card kinds each optional field applies to. */
const FIELD_KINDS: Record<string, Kind[] | 'all'> = {
  title: 'all',
  notes: 'all',
  collapsed: 'all',
  impact: ['pro', 'con', 'risk'],
  met: ['requirement'],
  must_have: ['requirement'],
  done: ['action'],
  gut: ['option'],
  // Decision-card fields: a decision, or an option with sub-options (checked in updateCard).
  rationale: ['problem', 'option'],
  review_on: ['problem', 'option'],
  outcome: ['problem', 'option'],
};
const DECISION_FIELDS = new Set(['rationale', 'review_on', 'outcome']);

const label = (k: Kind) => (k === 'problem' ? 'decision' : k);
const an = (k: Kind) => (/^[aeiou]/.test(label(k)) ? `an ${label(k)}` : `a ${label(k)}`);
const kindList = (ks: Kind[]) => (ks.length ? ks.map(label).join(', ') : 'nothing');

function checkFieldKind(field: string, kind: Kind, where: string) {
  const ok = FIELD_KINDS[field];
  if (!ok) throw new GraphError(`${where}: unknown field "${field}".`);
  if (DECISION_FIELDS.has(field) && kind !== 'problem') {
    throw new GraphError(
      `${where}: "${field}" doesn't apply to ${an(kind)}${kind === 'option' ? ' without sub-options' : ''}; it is only for decision cards (a decision, or an option with sub-options).`,
    );
  }
  if (ok !== 'all' && !ok.includes(kind)) {
    throw new GraphError(
      `${where}: "${field}" doesn't apply to ${an(kind)}; it is only for ${ok.map(label).join(' / ')} cards.`,
    );
  }
}

function checkText(value: string, max: number, what: string) {
  if (value.length > max) throw new GraphError(`${what} is ${value.length} characters; the limit is ${max}.`);
}

function checkImpact(n: number, where: string) {
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new GraphError(`${where}: impact must be a whole number from 1 to 5 (got ${n}).`);
}

function checkChildKind(parent: Item, kind: Kind, where: string) {
  const allowed = KINDS[parent.kind].children;
  if (!allowed.includes(kind)) {
    throw new GraphError(
      `${where}: ${an(kind)} can't go under ${an(parent.kind)} ("${parent.title || 'untitled'}"). ` +
        `${cap(an(parent.kind))} can hold: ${kindList(allowed)}.`,
    );
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function find(items: Item[], id: string, what = 'card'): Item {
  const it = items.find((i) => i.id === id);
  if (!it) throw new GraphError(`No ${what} with id "${id}" in this decision. Call get_decision to see the current ids.`);
  return it;
}

/** Every card in the branch rooted at `id` (including it). */
export function branchIds(items: Item[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of items)
      if (p.parentId && ids.has(p.parentId) && !ids.has(p.id)) {
        ids.add(p.id);
        grew = true;
      }
  }
  return ids;
}

/* ---------- building cards ---------- */

function countCards(cards: CardInput[], depth: number, where: string): number {
  if (cards.length && depth > LIMITS.depth) throw new GraphError(`${where}: cards are nested more than ${LIMITS.depth} levels deep.`);
  let n = 0;
  for (const c of cards) n += 1 + countCards(c.children ?? [], depth + 1, where);
  return n;
}

/** Turn nested CardInput under `parent` into flat Items (depth-first, in the given order). */
function build(parent: Item, cards: CardInput[], path: string): Item[] {
  const out: Item[] = [];
  cards.forEach((c, i) => {
    const where = `${path}[${i}]`;
    if (!ALL_KINDS.includes(c.kind)) throw new GraphError(`${where}: unknown kind "${c.kind}". Use one of: ${ALL_KINDS.join(', ')}.`);
    checkChildKind(parent, c.kind, where);
    if (typeof c.title !== 'string') throw new GraphError(`${where}: title is required.`);
    checkText(c.title, LIMITS.title, `${where}.title`);
    const it = makeItem(parent.id, c.kind, c.title);
    if (c.notes !== undefined) {
      checkText(c.notes, LIMITS.notes, `${where}.notes`);
      it.notes = c.notes;
    }
    if (c.impact !== undefined) {
      checkFieldKind('impact', c.kind, where);
      checkImpact(c.impact, where);
      it.weight = c.impact;
    }
    if (c.met !== undefined) {
      checkFieldKind('met', c.kind, where);
      it.met = c.met;
    }
    if (c.must_have !== undefined) {
      checkFieldKind('must_have', c.kind, where);
      it.must = c.must_have;
    }
    if (c.done !== undefined) {
      checkFieldKind('done', c.kind, where);
      it.done = c.done;
    }
    if (c.gut !== undefined) {
      checkFieldKind('gut', c.kind, where);
      if (c.gut !== null) it.gut = GUT_IN[c.gut];
    }
    out.push(it, ...build(it, c.children ?? [], `${where}.children`));
  });
  return out;
}

/** A new decision: the root decision card plus any nested cards under it. */
export function createDecision(title: string, notes: string | undefined, cards: CardInput[] = []): Item[] {
  checkText(title, LIMITS.title, 'title');
  if (notes !== undefined) checkText(notes, LIMITS.notes, 'notes');
  const n = countCards(cards, 1, 'cards');
  if (n > LIMITS.cardsPerCall) throw new GraphError(`That's ${n} cards; at most ${LIMITS.cardsPerCall} can be added per call. Split it into several add_cards calls.`);
  const root = makeItem(null, 'problem', title);
  if (notes) root.notes = notes;
  return [root, ...build(root, cards, 'cards')];
}

/**
 * Add nested cards under `parentId`. Each top-level card goes after the last existing sibling of
 * the same kind (or at the end), or right after `afterId` when given, like the app's store `add`.
 * A collapsed parent is expanded so the new cards are visible.
 */
export function addCards(items: Item[], parentId: string, cards: CardInput[], afterId?: string): { items: Item[]; ids: string[] } {
  const parent = find(items, parentId, 'parent card');
  if (!cards.length) throw new GraphError('cards is empty: pass at least one card to add.');
  const n = countCards(cards, 1, 'cards');
  if (n > LIMITS.cardsPerCall) throw new GraphError(`That's ${n} cards; at most ${LIMITS.cardsPerCall} can be added per call. Split it into several calls.`);
  if (afterId !== undefined) {
    const after = find(items, afterId, 'after_id card');
    if (after.parentId !== parentId) throw new GraphError(`after_id "${afterId}" is not a child of parent_id "${parentId}". Pass a sibling, or leave after_id out.`);
  }
  const fresh = build(parent, cards, 'cards');
  const tops = fresh.filter((f) => f.parentId === parentId);
  let next = items.map((p) => (p.id === parentId && p.collapsed ? { ...p, collapsed: false } : p));

  if (afterId !== undefined) {
    const at = next.findIndex((p) => p.id === afterId);
    next = [...next.slice(0, at + 1), ...fresh, ...next.slice(at + 1)];
  } else {
    for (const top of tops) {
      const block = [...branchIds(fresh, top.id)].map((id) => fresh.find((f) => f.id === id)!);
      let at = -1;
      next.forEach((p, i) => {
        if (p.parentId === parentId && p.kind === top.kind) at = i;
      });
      next = at >= 0 ? [...next.slice(0, at + 1), ...block, ...next.slice(at + 1)] : [...next, ...block];
    }
  }
  return { items: next, ids: fresh.map((f) => f.id) };
}

/* ---------- dates ---------- */

/** Milliseconds `timeZone` is ahead of UTC at instant `t`. */
function tzOffset(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const v = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return wall - Math.floor(t / 1000) * 1000;
}

/** `YYYY-MM-DD` → the instant that day starts in `timeZone` (like the app's local startOfDay). */
export function startOfLocalDay(date: string, timeZone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new GraphError(`review_on must be a date like 2026-12-31 (got "${date}").`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = Date.UTC(y, mo - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new GraphError(`review_on "${date}" is not a real calendar date.`);
  }
  let t = utc - tzOffset(utc, timeZone);
  t = utc - tzOffset(t, timeZone); // settle across a DST change
  return t;
}

/** An instant → `YYYY-MM-DD` in `timeZone`. */
export function localDate(t: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/* ---------- updates ---------- */

const hasChosen = (items: Item[], problemId: string) => items.some((o) => o.parentId === problemId && o.kind === 'option' && o.chosen);

/** Change fields on one card. Fields that don't apply to its kind are rejected. */
export function updateCard(items: Item[], cardId: string, fields: CardFields, opts: { timeZone: string; now?: number }): Item[] {
  const card = find(items, cardId);
  const keys = Object.keys(fields).filter((k) => (fields as Record<string, unknown>)[k] !== undefined);
  if (!keys.length) throw new GraphError('fields is empty: pass at least one field to change.');
  // An option with sub-options is a decision card too: it holds the sub-option choice.
  const decisionCard = isDecisionNode(card, items.filter((i) => i.parentId === card.id));
  for (const k of keys) checkFieldKind(k, decisionCard && DECISION_FIELDS.has(k) ? 'problem' : card.kind, `fields.${k}`);

  const next: Item = { ...card };
  const f = fields;
  if (f.title !== undefined) {
    checkText(f.title, LIMITS.title, 'title');
    next.title = f.title;
  }
  if (f.notes !== undefined) {
    checkText(f.notes, LIMITS.notes, 'notes');
    next.notes = f.notes;
  }
  if (f.collapsed !== undefined) next.collapsed = f.collapsed;
  if (f.impact !== undefined) {
    checkImpact(f.impact, 'fields');
    next.weight = f.impact;
  }
  if (f.met !== undefined) next.met = f.met;
  if (f.must_have !== undefined) next.must = f.must_have;
  if (f.done !== undefined) next.done = f.done;
  if (f.gut !== undefined) {
    if (f.gut === null) delete next.gut;
    else next.gut = GUT_IN[f.gut];
  }
  if (f.rationale !== undefined) {
    checkText(f.rationale, LIMITS.notes, 'rationale');
    if (f.rationale) next.rationale = f.rationale;
    else delete next.rationale;
  }
  if (f.review_on !== undefined) {
    if (f.review_on === null) delete next.reviewAt;
    else {
      if (!hasChosen(items, card.id)) throw new GraphError('review_on needs a decided decision: choose an option first (choose_option).');
      next.reviewAt = startOfLocalDay(f.review_on, opts.timeZone);
    }
  }
  if (f.outcome !== undefined) {
    if (f.outcome === null) delete next.outcome;
    else {
      if (!hasChosen(items, card.id)) throw new GraphError('outcome needs a decided decision: choose an option first (choose_option).');
      const rating = RATING_IN[f.outcome.rating];
      if (rating === undefined) throw new GraphError('outcome.rating must be one of: worse, as_expected, better.');
      const note = f.outcome.note?.trim();
      if (note) checkText(note, LIMITS.notes, 'outcome.note');
      next.outcome = { rating, ...(note ? { note } : {}), at: opts.now ?? Date.now() };
    }
  }
  return items.map((p) => (p.id === cardId ? next : p));
}

/* ---------- choose / move / delete ---------- */

/**
 * Choose an option: the decision card is its parent (a decision, or an option for a sub-option).
 * `optionId` null un-chooses `problemId` (any decision card; default: the root decision).
 */
export function chooseOption(items: Item[], optionId: string | null, problemId?: string, now = Date.now()): Item[] {
  if (optionId === null) {
    const problem = problemId ? find(items, problemId, 'decision card') : rootOf(items);
    if (!isDecisionNode(problem, items.filter((i) => i.parentId === problem.id))) {
      throw new GraphError(
        `"${problem.id}" is ${an(problem.kind)}${problem.kind === 'option' ? ' without sub-options' : ''}, not a decision card (a decision, or an option with sub-options).`,
      );
    }
    const decided =
      hasChosen(items, problem.id) || problem.decidedAt !== undefined || problem.reviewAt !== undefined || problem.outcome !== undefined;
    if (!decided) return items; // nothing to clear
    return items.map((p) =>
      p.parentId === problem.id && p.kind === 'option' && p.chosen
        ? { ...p, chosen: false }
        : p.id === problem.id
          ? clearDecided(p)
          : p,
    );
  }
  const target = find(items, optionId, 'option');
  if (target.kind !== 'option') throw new GraphError(`"${optionId}" is ${an(target.kind)}; only options can be chosen.`);
  if (problemId !== undefined && problemId !== target.parentId) {
    throw new GraphError(`Option "${optionId}" belongs to decision card "${target.parentId}", not "${problemId}".`);
  }
  if (target.chosen) return items; // already the choice: keep its date, check-back and outcome
  return items.map((p) =>
    p.id === optionId
      ? { ...p, chosen: true }
      : p.parentId === target.parentId && p.kind === 'option'
        ? p.chosen
          ? { ...p, chosen: false }
          : p
        : p.id === target.parentId
          ? // An outcome (and its check-back date) belongs to one specific choice.
            { ...clearDecided(p), decidedAt: now }
          : p,
  );
}

function clearDecided(p: Item): Item {
  const { decidedAt: _d, reviewAt: _r, outcome: _o, ...rest } = p;
  return rest;
}

/** Move a card (with its branch) under another parent, like the app's store `reparent`. */
export function moveCard(items: Item[], cardId: string, newParentId: string, afterId?: string): Item[] {
  const it = find(items, cardId);
  const target = find(items, newParentId, 'new parent card');
  if (!canMoveTo(items, cardId, newParentId)) {
    if (it.parentId === null) throw new GraphError("The root decision card can't be moved.");
    if (target.id === it.id) throw new GraphError("A card can't be moved under itself.");
    if (it.parentId === target.id) throw new GraphError(`The card is already under "${newParentId}".`);
    checkChildKind(target, it.kind, 'move_card');
    throw new GraphError("A card can't be moved into its own branch.");
  }
  if (afterId !== undefined) {
    const after = find(items, afterId, 'after_id card');
    if (after.parentId !== newParentId) throw new GraphError(`after_id "${afterId}" is not a child of new_parent_id "${newParentId}".`);
  }
  // A chosen option leaving its decision: that decision is undecided again.
  const unchoose = it.kind === 'option' && it.chosen;
  const rest = items
    .filter((p) => p.id !== cardId)
    .map((p) =>
      p.id === newParentId && p.collapsed
        ? { ...p, collapsed: false }
        : unchoose && p.id === it.parentId
          ? clearDecided(p)
          : p,
    );
  const moved: Item = { ...it, parentId: newParentId, ...(unchoose ? { chosen: false } : {}) };
  if (afterId === undefined) return [...rest, moved];
  const at = rest.findIndex((p) => p.id === afterId);
  return [...rest.slice(0, at + 1), moved, ...rest.slice(at + 1)];
}

/** Delete a card and its whole branch. The root decision card can't be deleted here. */
export function deleteCard(items: Item[], cardId: string): { items: Item[]; removed: number } {
  const it = find(items, cardId);
  if (it.parentId === null) throw new GraphError("The root decision card can't be deleted with delete_card; delete whole decisions in the app.");
  const doomed = branchIds(items, cardId);
  return { items: items.filter((p) => !doomed.has(p.id)), removed: doomed.size };
}

/* ---------- reading ---------- */

export function rootOf(items: Item[]): Item {
  const root = items.find((i) => i.parentId === null && i.kind === 'problem') ?? items.find((i) => i.parentId === null);
  if (!root) throw new GraphError('This decision has no cards yet.');
  return root;
}

export const titleOf = (items: Item[]) => items.find((i) => i.parentId === null && i.kind === 'problem')?.title || 'Untitled decision';

function verdictFor(node: Item, kids: Map<string | null, Item[]>, stats: Map<string, Stats>): { v: Verdict; options: Item[] } {
  const options = (kids.get(node.id) ?? []).filter((k) => k.kind === 'option');
  return { v: verdictOf(options, (id) => stats.get(id)!), options };
}

/** One line on which option is ahead, worded like the app's verdict headline (`noun`: "sub-option" for an option's own). */
export function verdictSentence(v: Verdict, outcome?: Item['outcome'], noun = 'option'): string {
  const name = (id: string | null) => v.rows.find((r) => r.id === id)?.title || `Untitled ${noun}`;
  const pts = v.margin === 1 ? 'point' : 'points';
  let s: string;
  switch (v.state) {
    case 'none':
      return `Add at least two ${noun}s to compare.`;
    case 'decided':
      s = `Chose ${name(v.chosenId)}`;
      if (outcome) s += ` · outcome: ${{ [-1]: 'worse than expected', 0: 'as expected', 1: 'better than expected' }[outcome.rating]}`;
      return s + '.';
    case 'clear':
      s = `${name(v.leaderId)} leads by ${v.margin} ${pts}`;
      break;
    case 'close':
      s = `Close call: ${name(v.leaderId)} ahead by ${v.margin} ${pts}`;
      break;
    case 'tie':
      return `Tied: ${name(v.topIds[0])} and ${name(v.topIds[1])}.`;
    case 'onlyViable':
      s = `Only ${name(v.leaderId)} meets every must-have`;
      break;
    case 'allBlocked':
      return `Every ${noun} is missing a must-have.`;
    case 'unscored':
      return 'Weigh pros, cons and risks to see a leader.';
  }
  if (v.gutNote?.kind === 'disagree') s += `, but the gut favors ${name(v.gutNote.favoriteId)}`;
  else if (v.gutNote?.kind === 'feelsOff') s += ', but it feels off';
  return s + '.';
}

export type CardJson = {
  id: string;
  kind: Kind;
  title: string;
  notes?: string;
  impact?: number;
  met?: boolean;
  must_have?: boolean;
  done?: boolean;
  chosen?: boolean;
  gut?: Gut;
  collapsed?: boolean;
  net?: number;
  /** Options counting a sub-option: their own net, and the counted sub-option's id. */
  own_net?: number;
  via?: string;
  leading?: boolean;
  blocked?: boolean;
  rationale?: string;
  decided_at?: string;
  review_on?: string;
  review_due?: boolean;
  outcome?: { rating: Rating; note?: string; at: string };
  verdict?: string;
  children?: CardJson[];
};

const iso = (t: number) => new Date(t).toISOString();

/** A readable outline (one line per card) plus a compact snake_case JSON tree. */
export function describe(items: Item[], opts: { timeZone: string; now?: number }): { outline: string; tree: CardJson[] } {
  const kids = groupChildren(items);
  const stats = effectiveStats(items, kids);
  const byId = new Map(items.map((i) => [i.id, i]));
  const lines: string[] = [];
  const now = opts.now ?? Date.now();
  const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

  const walk = (it: Item, depth: number, leaderId: string | null): CardJson => {
    const badges: string[] = [];
    const json: CardJson = { id: it.id, kind: it.kind, title: it.title };
    if (it.notes) json.notes = it.notes;
    if (it.collapsed) json.collapsed = true;
    let verdictLine: string | null = null;

    if (it.kind === 'pro' || it.kind === 'con' || it.kind === 'risk') {
      badges.push(`impact ${it.weight}/5`);
      json.impact = it.weight;
    } else if (it.kind === 'requirement') {
      if (it.must) badges.push('must-have');
      badges.push(it.met ? 'met' : 'not met');
      json.met = it.met;
      json.must_have = !!it.must;
    } else if (it.kind === 'action') {
      badges.push(it.done ? 'done' : 'to do');
      json.done = !!it.done;
    }
    if (it.kind === 'option') {
      const s = stats.get(it.id)!;
      const via = s.via ? byId.get(s.via) : undefined;
      badges.push(
        `net ${signed(s.net)}${via ? ` (own ${signed(s.ownNet)} · incl. ${via.title ? JSON.stringify(via.title) : '(untitled)'} ${signed(stats.get(via.id)!.net)})` : ''}`,
      );
      json.net = s.net;
      if (via) {
        json.own_net = s.ownNet;
        json.via = via.id;
      }
      if (it.chosen) badges.push('chosen');
      json.chosen = it.chosen;
      if (leaderId === it.id) {
        badges.push('Leading');
        json.leading = true;
      }
      if (isBlocked(s)) {
        badges.push(s.mustMissing > 0 ? 'Blocked (missing a must-have)' : 'Blocked (every sub-option is blocked)');
        json.blocked = true;
      }
      if (it.gut !== undefined) {
        badges.push(`gut: ${GUT_OUT[it.gut]}`);
        json.gut = GUT_OUT[it.gut];
      }
    }
    // Decision nodes: a decision, or an option with sub-options. Their children get this verdict's leader.
    let childLeader: string | null = null;
    if (isDecisionNode(it, kids.get(it.id) ?? [])) {
      const { v, options } = verdictFor(it, kids, stats);
      verdictLine = verdictSentence(v, it.outcome, it.kind === 'option' ? 'sub-option' : 'option');
      json.verdict = verdictLine;
      if (it.decidedAt !== undefined && v.state === 'decided') {
        badges.push(`decided ${localDate(it.decidedAt, opts.timeZone)}`);
        json.decided_at = iso(it.decidedAt);
      }
      if (it.reviewAt !== undefined) {
        json.review_on = localDate(it.reviewAt, opts.timeZone);
        badges.push(`check back ${json.review_on}`);
        if (reviewDue(it, options, now)) {
          badges.push('review due');
          json.review_due = true;
        }
      }
      if (it.outcome) {
        json.outcome = { rating: RATING_OUT[it.outcome.rating], ...(it.outcome.note ? { note: it.outcome.note } : {}), at: iso(it.outcome.at) };
        badges.push(`outcome: ${json.outcome.rating}`);
      }
      if (it.rationale) json.rationale = it.rationale;
      childLeader = v.state === 'decided' ? null : v.leaderId;
    }
    if (it.collapsed) badges.push('collapsed');

    const pad = '  '.repeat(depth);
    const title = it.title ? JSON.stringify(it.title) : '(untitled)';
    const label = kindLabel(it.kind, byId.get(it.parentId ?? '')?.kind);
    lines.push(`${pad}- ${label} ${title} [${it.id}]${badges.length ? ' · ' + badges.join(' · ') : ''}`);
    if (it.notes) lines.push(`${pad}  notes: ${clip(it.notes)}`);
    if (verdictLine && it.rationale) lines.push(`${pad}  why: ${clip(it.rationale)}`);
    if (verdictLine && it.outcome?.note) lines.push(`${pad}  learned: ${clip(it.outcome.note)}`);
    if (verdictLine) lines.push(`${pad}  verdict: ${verdictLine}`);

    const children = (kids.get(it.id) ?? []).map((c) => walk(c, depth + 1, childLeader));
    if (children.length) json.children = children;
    return json;
  };

  const tree = (kids.get(null) ?? []).map((r) => walk(r, 0, null));
  // Cards whose parent is missing (shouldn't happen) are still shown, so nothing is invisible.
  const known = new Set(items.map((i) => i.id));
  for (const orphan of items.filter((i) => i.parentId !== null && !known.has(i.parentId))) tree.push(walk(orphan, 0, null));
  return { outline: lines.join('\n'), tree };
}

const clip = (s: string, n = 240) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
};

/** One row of list_decisions. */
export function summarize(items: Item[], now = Date.now()) {
  const root = items.find((i) => i.parentId === null && i.kind === 'problem');
  const options = root ? items.filter((i) => i.parentId === root.id && i.kind === 'option') : [];
  const chosen = options.find((o) => o.chosen);
  const due = items.some((it) => reviewDue(it, items.filter((o) => o.parentId === it.id), now));
  return {
    title: root?.title || 'Untitled decision',
    status: chosen ? `decided: ${chosen.title || 'Untitled option'}` : 'open',
    options: options.length,
    cards: items.length,
    review_due: due,
  };
}
