import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleItems, makeItem } from '../../src/model.ts';
import {
  addCards,
  chooseOption,
  createDecision,
  deleteCard,
  describe,
  moveCard,
  startOfLocalDay,
  localDate,
  summarize,
  updateCard,
  GraphError,
} from '../src/graph.ts';

const TZ = 'Europe/Sofia';
const by = (items, title) => items.find((i) => i.title === title);
const kids = (items, id) => items.filter((i) => i.parentId === id);

/** The sample decision, with a check-back date and outcome on the root to see them cleared. */
function sample() {
  return sampleItems();
}

test('createDecision builds nested cards under a new root', () => {
  const items = createDecision('Which laptop?', 'For travel', [
    {
      kind: 'option',
      title: 'MacBook Air',
      gut: 'good',
      children: [
        { kind: 'pro', title: 'Light', impact: 5 },
        { kind: 'requirement', title: 'Under 1.5 kg', met: true, must_have: true, children: [{ kind: 'action', title: 'Weigh it', done: true }] },
      ],
    },
    { kind: 'option', title: 'ThinkPad' },
    { kind: 'note', title: 'Ask Sam' },
  ]);
  assert.equal(items.length, 7);
  const root = items[0];
  assert.equal(root.parentId, null);
  assert.equal(root.kind, 'problem');
  assert.equal(root.notes, 'For travel');
  const air = by(items, 'MacBook Air');
  assert.equal(air.parentId, root.id);
  assert.equal(air.gut, 1);
  assert.equal(by(items, 'Light').weight, 5);
  const req = by(items, 'Under 1.5 kg');
  assert.equal(req.met, true);
  assert.equal(req.must, true);
  assert.equal(by(items, 'Weigh it').parentId, req.id);
  assert.equal(by(items, 'Weigh it').done, true);
  // defaults from makeItem
  assert.equal(by(items, 'ThinkPad').weight, 3);
  assert.equal(by(items, 'ThinkPad').chosen, false);
  assert.equal('gut' in by(items, 'ThinkPad'), false);
});

test('createDecision / addCards validation errors are clear', () => {
  const bad = (fn, re) => assert.throws(fn, (e) => e instanceof GraphError && re.test(e.message));
  bad(() => createDecision('x', undefined, [{ kind: 'pro', title: 'p' }]), /a pro can't go under a decision.*can hold: option, note/i);
  bad(() => createDecision('x', undefined, [{ kind: 'option', title: 'o', impact: 3 }]), /"impact" doesn't apply to an option; it is only for pro \/ con \/ risk/);
  bad(() => createDecision('x', undefined, [{ kind: 'option', title: 'o', children: [{ kind: 'con', title: 'c', impact: 6 }] }]), /impact must be a whole number from 1 to 5/);
  bad(() => createDecision('x', undefined, [{ kind: 'option', title: 'o', children: [{ kind: 'pro', title: 'c', impact: 2.5 }] }]), /whole number/);
  bad(() => createDecision('t'.repeat(301)), /title is 301 characters; the limit is 300/);
  bad(() => createDecision('x', 'n'.repeat(5001)), /notes is 5001 characters; the limit is 5000/);
  bad(() => createDecision('x', undefined, [{ kind: 'wizard', title: 'w' }]), /unknown kind "wizard"/);
  bad(() => createDecision('x', undefined, [{ kind: 'option', title: 'o', children: [{ kind: 'requirement', title: 'r', done: true }] }]), /"done" doesn't apply to a requirement/);
  const many = Array.from({ length: 301 }, (_, i) => ({ kind: 'option', title: `o${i}` }));
  bad(() => createDecision('x', undefined, many), /301 cards; at most 300/);
  // 9 levels: option > problem > option > problem > ...
  let deep = { kind: 'option', title: 'leaf' };
  for (let i = 0; i < 8; i++) deep = i % 2 === 0 ? { kind: 'problem', title: `p${i}`, children: [deep] } : { kind: 'option', title: `o${i}`, children: [deep] };
  bad(() => createDecision('x', undefined, [deep]), /nested more than 8 levels/);
  // exactly 8 levels is fine
  let ok = { kind: 'note', title: 'leaf' };
  for (let i = 0; i < 7; i++) ok = i % 2 === 0 ? { kind: 'option', title: `o${i}`, children: [ok] } : { kind: 'problem', title: `p${i}`, children: [ok] };
  assert.equal(createDecision('x', undefined, [ok]).length, 9);

  const items = sample();
  bad(() => addCards(items, 'nope', [{ kind: 'note', title: 'n' }]), /No parent card with id "nope"/);
  bad(() => addCards(items, by(items, 'PostgreSQL').id, []), /cards is empty/);
  bad(() => addCards(items, by(items, 'PostgreSQL').id, [{ kind: 'pro', title: 'x' }], by(items, 'MongoDB').id), /after_id .* is not a child of parent_id/);
});

test('addCards: after the last same-kind sibling, or after after_id; expands a collapsed parent', () => {
  let items = sample();
  const pg = by(items, 'PostgreSQL');
  items = items.map((i) => (i.id === pg.id ? { ...i, collapsed: true } : i));
  const r = addCards(items, pg.id, [
    { kind: 'pro', title: 'New pro', impact: 2, children: [{ kind: 'note', title: 'why' }] },
    { kind: 'con', title: 'New con' },
  ]);
  assert.equal(r.ids.length, 3);
  const next = r.items;
  assert.equal(by(next, 'PostgreSQL').collapsed, false);
  const pros = kids(next, pg.id).filter((i) => i.kind === 'pro').map((i) => i.title);
  assert.deepEqual(pros, ['Strong consistency and real transactions', 'Mature ecosystem and tooling', 'New pro']);
  // placed right after the last existing pro in the array
  const idx = next.findIndex((i) => i.title === 'New pro');
  assert.equal(next[idx - 1].title, 'Mature ecosystem and tooling');
  assert.equal(next[idx + 1].title, 'why');
  const cons = kids(next, pg.id).filter((i) => i.kind === 'con').map((i) => i.title);
  assert.deepEqual(cons, ['Horizontal scaling takes real effort', 'New con']);
  assert.equal(by(next, 'why').parentId, by(next, 'New pro').id);

  // after_id
  const first = kids(items, pg.id).find((i) => i.kind === 'pro');
  const r2 = addCards(items, pg.id, [{ kind: 'pro', title: 'Second' }], first.id);
  const pros2 = kids(r2.items, pg.id).filter((i) => i.kind === 'pro').map((i) => i.title);
  assert.equal(pros2[1], 'Second');

  // a kind with no siblings yet goes to the end
  const r3 = addCards(items, pg.id, [{ kind: 'action', title: 'Benchmark' }]);
  assert.equal(r3.items.at(-1).title, 'Benchmark');
});

test('updateCard: kind-specific fields, rejections, gut, collapsed', () => {
  const items = sample();
  const pg = by(items, 'PostgreSQL');
  const pro = by(items, 'Mature ecosystem and tooling');
  const req = by(items, 'Managed hosting on RDS');
  const act = by(items, 'Ask finance for the Atlas budget');
  const root = items[0];
  let next = updateCard(items, pro.id, { impact: 1, title: 'Tooling', notes: 'meh' }, { timeZone: TZ });
  assert.equal(by(next, 'Tooling').weight, 1);
  assert.equal(by(next, 'Tooling').notes, 'meh');
  next = updateCard(next, req.id, { met: false, must_have: true }, { timeZone: TZ });
  assert.equal(by(next, 'Managed hosting on RDS').met, false);
  assert.equal(by(next, 'Managed hosting on RDS').must, true);
  next = updateCard(next, act.id, { done: true, collapsed: true }, { timeZone: TZ });
  assert.equal(by(next, 'Ask finance for the Atlas budget').done, true);
  assert.equal(by(next, 'Ask finance for the Atlas budget').collapsed, true);
  next = updateCard(next, pg.id, { gut: 'uneasy' }, { timeZone: TZ });
  assert.equal(by(next, 'PostgreSQL').gut, -1);
  next = updateCard(next, pg.id, { gut: null }, { timeZone: TZ });
  assert.equal('gut' in by(next, 'PostgreSQL'), false);
  next = updateCard(next, root.id, { rationale: 'Because' }, { timeZone: TZ });
  assert.equal(next[0].rationale, 'Because');
  next = updateCard(next, root.id, { rationale: '' }, { timeZone: TZ });
  assert.equal('rationale' in next[0], false);

  const bad = (fn, re) => assert.throws(fn, (e) => e instanceof GraphError && re.test(e.message));
  bad(() => updateCard(items, pg.id, { impact: 3 }, { timeZone: TZ }), /"impact" doesn't apply to an option/);
  bad(() => updateCard(items, pro.id, { met: true }, { timeZone: TZ }), /"met" doesn't apply to a pro; it is only for requirement/);
  bad(() => updateCard(items, pro.id, { gut: 'good' }, { timeZone: TZ }), /"gut" doesn't apply to a pro/);
  bad(() => updateCard(items, pg.id, { rationale: 'x' }, { timeZone: TZ }), /"rationale" doesn't apply to an option without sub-options; it is only for decision cards/);
  bad(() => updateCard(items, root.id, { review_on: '2026-12-01' }, { timeZone: TZ }), /choose an option first/);
  bad(() => updateCard(items, root.id, { outcome: { rating: 'better' } }, { timeZone: TZ }), /choose an option first/);
  bad(() => updateCard(items, pro.id, { impact: 0 }, { timeZone: TZ }), /1 to 5/);
  bad(() => updateCard(items, pro.id, {}, { timeZone: TZ }), /fields is empty/);
  bad(() => updateCard(items, 'missing', { title: 'x' }, { timeZone: TZ }), /No card with id "missing"/);
  bad(() => updateCard(items, pro.id, { title: 'x'.repeat(301) }, { timeZone: TZ }), /limit is 300/);
});

test('review_on and outcome conversions', () => {
  const base = sample();
  const decided = chooseOption(base, by(base, 'PostgreSQL').id, undefined, 1_000);
  const root = decided[0];
  // Sofia is UTC+2 in winter, UTC+3 in summer: local midnight is the previous day 22:00 / 21:00 UTC.
  let next = updateCard(decided, root.id, { review_on: '2026-12-31' }, { timeZone: TZ });
  assert.equal(new Date(next[0].reviewAt).toISOString(), '2026-12-30T22:00:00.000Z');
  next = updateCard(decided, root.id, { review_on: '2026-07-01' }, { timeZone: TZ });
  assert.equal(new Date(next[0].reviewAt).toISOString(), '2026-06-30T21:00:00.000Z');
  assert.equal(localDate(next[0].reviewAt, TZ), '2026-07-01');
  // Other time zones and DST edges
  assert.equal(new Date(startOfLocalDay('2026-03-29', TZ)).toISOString(), '2026-03-28T22:00:00.000Z'); // DST starts at 03:00
  assert.equal(new Date(startOfLocalDay('2026-10-25', TZ)).toISOString(), '2026-10-24T21:00:00.000Z'); // DST ends at 04:00
  assert.equal(new Date(startOfLocalDay('2026-01-15', 'America/New_York')).toISOString(), '2026-01-15T05:00:00.000Z');
  assert.equal(new Date(startOfLocalDay('2026-01-15', 'UTC')).toISOString(), '2026-01-15T00:00:00.000Z');
  assert.throws(() => startOfLocalDay('2026-02-30', TZ), /not a real calendar date/);
  assert.throws(() => startOfLocalDay('31/12/2026', TZ), /like 2026-12-31/);
  next = updateCard(next, root.id, { review_on: null }, { timeZone: TZ });
  assert.equal('reviewAt' in next[0], false);

  next = updateCard(decided, root.id, { outcome: { rating: 'better', note: '  Fast enough  ' } }, { timeZone: TZ, now: 42 });
  assert.deepEqual(next[0].outcome, { rating: 1, note: 'Fast enough', at: 42 });
  next = updateCard(decided, root.id, { outcome: { rating: 'worse' } }, { timeZone: TZ, now: 43 });
  assert.deepEqual(next[0].outcome, { rating: -1, at: 43 });
  next = updateCard(decided, root.id, { outcome: { rating: 'as_expected', note: '' } }, { timeZone: TZ, now: 44 });
  assert.deepEqual(next[0].outcome, { rating: 0, at: 44 });
  next = updateCard(next, root.id, { outcome: null }, { timeZone: TZ });
  assert.equal('outcome' in next[0], false);
});

test('chooseOption: one choice, decidedAt set, reviewAt/outcome cleared; null un-chooses', () => {
  const items = sample();
  const root = items[0];
  const pg = by(items, 'PostgreSQL');
  const mongo = by(items, 'MongoDB');
  let next = chooseOption(items, pg.id, undefined, 1000);
  assert.equal(by(next, 'PostgreSQL').chosen, true);
  assert.equal(next[0].decidedAt, 1000);
  next = next.map((i) => (i.id === root.id ? { ...i, reviewAt: 5, outcome: { rating: 1, at: 6 } } : i));
  // choosing the same option again changes nothing
  assert.equal(chooseOption(next, pg.id, undefined, 2000), next);
  // switching clears the old choice, the check-back date and the outcome
  next = chooseOption(next, mongo.id, undefined, 3000);
  assert.equal(by(next, 'PostgreSQL').chosen, false);
  assert.equal(by(next, 'MongoDB').chosen, true);
  assert.equal(next[0].decidedAt, 3000);
  assert.equal('reviewAt' in next[0], false);
  assert.equal('outcome' in next[0], false);
  // un-choose
  next = next.map((i) => (i.id === root.id ? { ...i, reviewAt: 5, outcome: { rating: 1, at: 6 } } : i));
  next = chooseOption(next, null);
  assert.equal(next.filter((i) => i.chosen).length, 0);
  for (const k of ['decidedAt', 'reviewAt', 'outcome']) assert.equal(k in next[0], false);
  assert.equal(chooseOption(next, null), next); // nothing to clear
  // sub-decision
  const sub = by(items, 'Single-table design or one table per entity?');
  const single = by(items, 'Single-table design');
  next = chooseOption(items, single.id, undefined, 7);
  assert.equal(by(next, sub.title).decidedAt, 7);
  assert.equal('decidedAt' in next[0], false); // the root is untouched
  next = chooseOption(next, null, sub.id);
  assert.equal(by(next, 'Single-table design').chosen, false);
  assert.equal('decidedAt' in by(next, sub.title), false);
  // errors
  assert.throws(() => chooseOption(items, by(items, 'Mature ecosystem and tooling').id), /only options can be chosen/);
  assert.throws(() => chooseOption(items, null, pg.id), /not a decision card/);
  assert.throws(() => chooseOption(items, single.id, root.id), /belongs to decision card/);
});

test('moveCard: canMoveTo rules, chosen-option rules, lands last, expands target', () => {
  const items = sample();
  const root = items[0];
  const pg = by(items, 'PostgreSQL');
  const mongo = by(items, 'MongoDB');
  const pro = by(items, 'Mature ecosystem and tooling');
  const budget = by(items, 'Budget approval for Atlas');
  const sub = by(items, 'Single-table design or one table per entity?');

  const collapsed = items.map((i) => (i.id === mongo.id ? { ...i, collapsed: true } : i));
  let next = moveCard(collapsed, pro.id, mongo.id);
  assert.equal(next.at(-1).id, pro.id);
  assert.equal(next.at(-1).parentId, mongo.id);
  assert.equal(by(next, 'MongoDB').collapsed, false);

  // with after_id
  const mongoPro = by(items, 'Flexible schema while the domain evolves');
  next = moveCard(items, pro.id, mongo.id, mongoPro.id);
  const at = next.findIndex((i) => i.id === pro.id);
  assert.equal(next[at - 1].id, mongoPro.id);

  // a branch moves with its card
  next = moveCard(items, budget.id, pg.id);
  assert.equal(by(next, 'Ask finance for the Atlas budget').parentId, budget.id);
  assert.equal(by(next, 'Budget approval for Atlas').parentId, pg.id);

  // the chosen option leaving its decision: un-chosen, old decision undecided
  let decided = chooseOption(items, pg.id, undefined, 10).map((i) => (i.id === root.id ? { ...i, reviewAt: 1, outcome: { rating: 0, at: 2 } } : i));
  const dyn = by(items, 'DynamoDB');
  next = moveCard(decided, pg.id, sub.id);
  assert.equal(by(next, 'PostgreSQL').chosen, false);
  assert.equal(by(next, 'PostgreSQL').parentId, sub.id);
  for (const k of ['decidedAt', 'reviewAt', 'outcome']) assert.equal(k in next[0], false);
  // a chosen option moving *within*? not possible; moving another option keeps the decision
  next = moveCard(decided, mongo.id, sub.id);
  assert.equal(next[0].decidedAt, 10);

  const bad = (fn, re) => assert.throws(fn, (e) => e instanceof GraphError && re.test(e.message));
  bad(() => moveCard(items, root.id, pg.id), /root decision card can't be moved/);
  bad(() => moveCard(items, pro.id, pg.id), /already under/);
  bad(() => moveCard(items, pro.id, root.id), /a pro can't go under a decision/);
  bad(() => moveCard(items, dyn.id, sub.id), /own branch/);
  bad(() => moveCard(items, pg.id, pg.id), /under itself/);
  bad(() => moveCard(items, pro.id, mongo.id, pg.id), /after_id .* is not a child of new_parent_id/);
  bad(() => moveCard(items, 'x', mongo.id), /No card with id "x"/);
});

test('deleteCard removes the whole branch; the root is protected', () => {
  const items = sample();
  const dyn = by(items, 'DynamoDB');
  const { items: next, removed } = deleteCard(items, dyn.id);
  assert.equal(removed, 9); // option + req + pro + 2 cons + action + sub-decision + 2 sub-options
  assert.equal(next.length, items.length - 9);
  assert.equal(by(next, 'Single-table design'), undefined);
  assert.throws(() => deleteCard(items, items[0].id), /root decision card can't be deleted/);
});

test('describe: outline badges, verdict sentence and JSON tree', () => {
  const items = sample();
  const { outline, tree } = describe(items, { timeZone: TZ });
  assert.match(outline, /verdict: PostgreSQL leads by 5 points\./);
  assert.match(outline, /Option "PostgreSQL" \[[^\]]+\] · net \+4 · Leading/);
  assert.match(outline, /Option "DynamoDB" .*Blocked/);
  assert.match(outline, /Requirement "Team already knows SQL" .*must-have · met/);
  assert.match(outline, /Pro "Strong consistency and real transactions" .*impact 5\/5/);
  assert.match(outline, /Action "Ask finance for the Atlas budget" .*to do/);
  assert.match(outline, /verdict: Add at least two options|verdict: Weigh pros, cons and risks/);
  assert.equal(tree.length, 1);
  const root = tree[0];
  assert.equal(root.kind, 'problem');
  assert.equal(root.verdict, 'PostgreSQL leads by 5 points.');
  const pg = root.children.find((c) => c.title === 'PostgreSQL');
  assert.equal(pg.leading, true);
  assert.equal(pg.net, 4);
  assert.equal(root.children.find((c) => c.title === 'DynamoDB').blocked, true);
  assert.ok(pg.children.some((c) => c.must_have === true && c.met === true));

  // decided + gut + review due
  let decided = chooseOption(items, by(items, 'PostgreSQL').id, undefined, Date.UTC(2026, 0, 1));
  decided = updateCard(decided, decided[0].id, { review_on: '2026-02-01', rationale: 'Safe' }, { timeZone: TZ });
  decided = updateCard(decided, by(decided, 'MongoDB').id, { gut: 'good' }, { timeZone: TZ });
  const d = describe(decided, { timeZone: TZ, now: Date.UTC(2026, 2, 1) });
  assert.match(d.outline, /verdict: Chose PostgreSQL\./);
  assert.match(d.outline, /check back 2026-02-01 · review due/);
  assert.match(d.outline, /why: Safe/);
  assert.match(d.outline, /gut: good/);
  assert.equal(d.tree[0].review_due, true);
  assert.equal(d.tree[0].review_on, '2026-02-01');
  assert.equal(d.tree[0].decided_at, '2026-01-01T00:00:00.000Z');
  const s = summarize(decided, Date.UTC(2026, 2, 1));
  assert.deepEqual(s, { title: items[0].title, status: 'decided: PostgreSQL', options: 3, cards: items.length, review_due: true });

  // tie / close / gut disagreement wording
  const two = createDecision('A or B?', undefined, [
    { kind: 'option', title: 'A', children: [{ kind: 'pro', title: 'a', impact: 3 }] },
    { kind: 'option', title: 'B', gut: 'good', children: [{ kind: 'pro', title: 'b', impact: 3 }] },
  ]);
  assert.match(describe(two, { timeZone: TZ }).outline, /verdict: Tied: A and B\./);
  const close = updateCard(two, by(two, 'a').id, { impact: 5 }, { timeZone: TZ });
  assert.match(describe(close, { timeZone: TZ }).outline, /verdict: Close call: A ahead by 2 points, but the gut favors B\./);
  assert.equal(summarize([makeItem(null, 'problem', '')]).title, 'Untitled decision');
});

/* ---------- sub-options ---------- */

/** The AWS example: AWS own +2 with DynamoDB +3 and Aurora +5 → AWS +7; Self-host +4. */
function aws() {
  return createDecision('Where do we host it?', undefined, [
    {
      kind: 'option',
      title: 'AWS',
      children: [
        { kind: 'pro', title: 'Team knows it', impact: 3 },
        { kind: 'con', title: 'Bills', impact: 1 },
        { kind: 'problem', title: 'Which region?', children: [{ kind: 'option', title: 'eu-west-1' }] },
        { kind: 'option', title: 'DynamoDB', children: [{ kind: 'pro', title: 'Zero ops', impact: 3 }] },
        { kind: 'note', title: 'Ask Sam' },
        { kind: 'option', title: 'Aurora', children: [{ kind: 'pro', title: 'Postgres', impact: 5 }] },
      ],
    },
    { kind: 'option', title: 'Self-host', children: [{ kind: 'pro', title: 'Cheap', impact: 4 }] },
  ]);
}

test('sub-options: nest (recursively), labelled Sub-option, after notes and before sub-decisions', () => {
  const items = aws();
  const a = by(items, 'AWS');
  assert.equal(by(items, 'DynamoDB').parentId, a.id);
  // a sub-option of a sub-option
  const deep = addCards(items, by(items, 'Aurora').id, [{ kind: 'option', title: 'Serverless v2', children: [{ kind: 'pro', title: 'Scales', impact: 1 }] }]);
  assert.equal(by(deep.items, 'Serverless v2').parentId, by(items, 'Aurora').id);
  const { outline, tree } = describe(deep.items, { timeZone: TZ });
  assert.match(outline, /\n {2}- Option "AWS" /);
  assert.match(outline, /\n {4}- Sub-option "DynamoDB" /);
  assert.match(outline, /\n {6}- Sub-option "Serverless v2" /);
  assert.match(outline, /Option "eu-west-1"/); // an option under a sub-decision is a plain option
  const order = tree[0].children[0].children.map((c) => `${c.kind}:${c.title}`);
  assert.deepEqual(order, ['pro:Team knows it', 'con:Bills', 'note:Ask Sam', 'option:DynamoDB', 'option:Aurora', 'problem:Which region?']);
});

test('sub-options: effective scoring counts the best sub-option, a chosen one, and blocks', () => {
  let items = aws();
  let d = describe(items, { timeZone: TZ });
  assert.match(d.outline, /Option "AWS" \[[^\]]+\] · net \+7 \(own \+2 · incl\. "Aurora" \+5\) · Leading/);
  assert.match(d.outline, /Sub-option "Aurora" \[[^\]]+\] · net \+5 · Leading/);
  assert.doesNotMatch(d.outline, /Sub-option "DynamoDB" [^\n]*Leading/);
  assert.equal(d.tree[0].verdict, 'AWS leads by 3 points.');
  const awsJson = d.tree[0].children.find((c) => c.title === 'AWS');
  assert.equal(awsJson.net, 7);
  assert.equal(awsJson.own_net, 2);
  assert.equal(awsJson.via, by(items, 'Aurora').id);
  assert.equal(awsJson.verdict, 'Close call: Aurora ahead by 2 points.');
  assert.match(d.outline, /\n {4}verdict: Close call: Aurora ahead by 2 points\./);
  assert.equal(d.tree[0].children.find((c) => c.title === 'Self-host').own_net, undefined);

  // a chosen sub-option counts, even when it isn't the best
  items = chooseOption(items, by(items, 'DynamoDB').id, undefined, 5);
  d = describe(items, { timeZone: TZ });
  assert.match(d.outline, /Option "AWS" [^\n]*net \+5 \(own \+2 · incl\. "DynamoDB" \+3\)/);
  assert.match(d.outline, /verdict: Chose DynamoDB\./);
  assert.equal(d.tree[0].verdict, 'Close call: AWS ahead by 1 point.'); // +5 vs Self-host +4

  // every sub-option blocked (none chosen) → AWS is blocked too and Self-host leads
  items = aws();
  items = addCards(items, by(items, 'DynamoDB').id, [{ kind: 'requirement', title: 'Known access patterns', must_have: true }]).items;
  items = addCards(items, by(items, 'Aurora').id, [{ kind: 'requirement', title: 'Budget', must_have: true }]).items;
  d = describe(items, { timeZone: TZ });
  assert.match(d.outline, /Option "AWS" [^\n]*net \+2 · Blocked \(every sub-option is blocked\)/);
  assert.equal(d.tree[0].children.find((c) => c.title === 'AWS').blocked, true);
  assert.equal(d.tree[0].verdict, 'Only Self-host meets every must-have.');
  assert.match(d.outline, /verdict: Every sub-option is missing a must-have\./);
  // one viable sub-option is enough
  items = updateCard(items, by(items, 'Budget').id, { met: true }, { timeZone: TZ });
  assert.equal(describe(items, { timeZone: TZ }).tree[0].verdict, 'AWS leads by 3 points.');
});

test('sub-options: choose infers the parent option; no cascade; un-choose with an option decision_card_id', () => {
  const items = aws();
  const root = items[0];
  const a = by(items, 'AWS');
  const dyn = by(items, 'DynamoDB');
  let next = chooseOption(items, dyn.id, undefined, 100);
  assert.equal(by(next, 'DynamoDB').chosen, true);
  assert.equal(by(next, 'AWS').decidedAt, 100);
  assert.equal(by(next, 'AWS').chosen, false); // choosing a sub-option doesn't choose its parent
  assert.equal('decidedAt' in next[0], false);
  // switching sub-options moves the choice; the parent's record follows it
  next = next.map((i) => (i.id === a.id ? { ...i, reviewAt: 5, outcome: { rating: 1, at: 6 } } : i));
  next = chooseOption(next, by(items, 'Aurora').id, a.id, 200); // a matching decision_card_id is fine
  assert.equal(by(next, 'DynamoDB').chosen, false);
  assert.equal(by(next, 'Aurora').chosen, true);
  assert.equal(by(next, 'AWS').decidedAt, 200);
  for (const k of ['reviewAt', 'outcome']) assert.equal(k in by(next, 'AWS'), false);
  // choosing another top-level option keeps the sub-choice inside AWS ("if AWS, then Aurora")
  next = chooseOption(next, by(items, 'Self-host').id, undefined, 300);
  assert.equal(by(next, 'Self-host').chosen, true);
  assert.equal(by(next, 'Aurora').chosen, true);
  assert.equal(next[0].decidedAt, 300);
  // un-choose the sub-option: decision_card_id is the option
  next = chooseOption(next, null, a.id);
  assert.equal(by(next, 'Aurora').chosen, false);
  assert.equal('decidedAt' in by(next, 'AWS'), false);
  assert.equal(by(next, 'Self-host').chosen, true); // the root is untouched
  assert.equal(next[0].decidedAt, 300);
  assert.equal(chooseOption(next, null, a.id), next); // nothing to clear
  // errors
  assert.throws(() => chooseOption(items, null, by(items, 'Self-host').id), /option without sub-options, not a decision card/);
  assert.throws(() => chooseOption(items, dyn.id, root.id), /belongs to decision card/);
});

test('sub-options: decision-card fields on options with sub-options, validation, review due', () => {
  const items = aws();
  const a = by(items, 'AWS');
  const bad = (fn, re) => assert.throws(fn, (e) => e instanceof GraphError && re.test(e.message));
  // only options with sub-options are decision cards
  bad(() => updateCard(items, by(items, 'Self-host').id, { rationale: 'x' }, { timeZone: TZ }), /doesn't apply to an option without sub-options/);
  bad(() => updateCard(items, by(items, 'Zero ops').id, { rationale: 'x' }, { timeZone: TZ }), /"rationale" doesn't apply to a pro; it is only for decision cards/);
  bad(() => updateCard(items, a.id, { review_on: '2026-12-01' }, { timeZone: TZ }), /choose an option first/);
  bad(() => updateCard(items, a.id, { outcome: { rating: 'better' } }, { timeZone: TZ }), /choose an option first/);
  let next = updateCard(items, a.id, { rationale: 'Managed' }, { timeZone: TZ });
  assert.equal(by(next, 'AWS').rationale, 'Managed');
  next = chooseOption(next, by(items, 'Aurora').id, undefined, Date.UTC(2026, 0, 1));
  next = updateCard(next, a.id, { review_on: '2026-02-01', rationale: 'Postgres we know' }, { timeZone: TZ });
  assert.equal(localDate(by(next, 'AWS').reviewAt, TZ), '2026-02-01');
  const d = describe(next, { timeZone: TZ, now: Date.UTC(2026, 2, 1) });
  assert.match(d.outline, /Option "AWS" [^\n]*decided 2026-01-01 · check back 2026-02-01 · review due/);
  assert.match(d.outline, /\n {4}why: Postgres we know/);
  assert.equal(d.tree[0].children.find((c) => c.title === 'AWS').review_due, true);
  assert.equal(summarize(next, Date.UTC(2026, 2, 1)).review_due, true);
  next = updateCard(next, a.id, { outcome: { rating: 'better', note: 'Fast' } }, { timeZone: TZ, now: 9 });
  assert.deepEqual(by(next, 'AWS').outcome, { rating: 1, note: 'Fast', at: 9 });
  assert.match(describe(next, { timeZone: TZ }).outline, /verdict: Chose Aurora · outcome: better than expected\./);
  // kinds: a sub-option can't go under a pro or a decision's note, and gut works on sub-options
  bad(() => addCards(items, by(items, 'Zero ops').id, [{ kind: 'option', title: 'x' }]), /an option can't go under a pro/);
  bad(() => addCards(items, by(items, 'Ask Sam').id, [{ kind: 'option', title: 'x' }]), /an option can't go under a note/);
  next = updateCard(items, by(items, 'Aurora').id, { gut: 'good' }, { timeZone: TZ });
  assert.equal(by(next, 'Aurora').gut, 1);
  // a sibling option can be nested with move_card
  next = moveCard(items, by(items, 'Self-host').id, a.id);
  assert.equal(by(next, 'Self-host').parentId, a.id);
  assert.match(describe(next, { timeZone: TZ }).outline, /Sub-option "Self-host"/);
});
