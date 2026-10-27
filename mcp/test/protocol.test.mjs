import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { sampleItems } from '../../src/model.ts';
import { registerTools, SERVER_NAME, INSTRUCTIONS } from '../src/tools.ts';
import { ConflictError } from '../src/firestore.ts';

/** DocStore in memory, with versions like Firestore's updateTime and an optional injected conflict. */
class MemoryStore {
  docs = new Map();
  v = 0;
  conflicts = 0; // the next N updates fail as if the app saved in between
  writes = 0;
  ver() {
    return `v${++this.v}`;
  }
  async list() {
    return [...this.docs.values()].map((d) => structuredClone(d));
  }
  async get(id) {
    const d = this.docs.get(id);
    return d ? structuredClone(d) : null;
  }
  async create(doc) {
    if (this.docs.has(doc.id)) throw new ConflictError('exists');
    const d = { extra: {}, ...structuredClone(doc), version: this.ver() };
    this.docs.set(doc.id, d);
    return structuredClone(d);
  }
  async update(doc, version) {
    const cur = this.docs.get(doc.id);
    if (this.conflicts > 0) {
      this.conflicts--;
      // the app changes the doc: bump the version and touch a title
      cur.version = this.ver();
      cur.items = cur.items.map((i, n) => (n === 0 ? { ...i, notes: 'edited in the app' } : i));
      throw new ConflictError('stale');
    }
    if (!cur || cur.version !== version) throw new ConflictError('stale');
    const d = { extra: {}, ...structuredClone(doc), version: this.ver() };
    this.docs.set(doc.id, d);
    this.writes++;
    return structuredClone(d);
  }
}

async function connect(store, now = () => Date.UTC(2026, 9, 26, 12)) {
  const server = new McpServer({ name: SERVER_NAME, version: '1.0.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, { store: () => store, timeZone: 'Europe/Sofia', now });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const textOf = (r) => r.content.map((c) => c.text).join('\n');
const call = async (client, name, args) => client.callTool({ name, arguments: args });

test('tools/list: all eight tools with schemas and annotations', async () => {
  const client = await connect(new MemoryStore());
  assert.equal(client.getServerVersion().name, 'Decision Graph');
  assert.match(client.getInstructions(), /pro − cons − risks|pros − cons − risks/);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['add_cards', 'choose_option', 'create_decision', 'delete_card', 'get_decision', 'list_decisions', 'move_card', 'update_card']);
  const t = Object.fromEntries(tools.map((x) => [x.name, x]));
  assert.equal(t.list_decisions.annotations.readOnlyHint, true);
  assert.equal(t.get_decision.annotations.readOnlyHint, true);
  assert.equal(t.delete_card.annotations.destructiveHint, true);
  assert.equal(t.update_card.annotations.idempotentHint, true);
  assert.equal(t.create_decision.annotations.readOnlyHint, false);
  for (const x of tools) assert.ok(x.description.length > 20, x.name);
  // nested CardInput is a recursive schema
  const card = JSON.stringify(t.add_cards.inputSchema);
  assert.match(card, /"children"/);
  assert.deepEqual(t.add_cards.inputSchema.required.sort(), ['cards', 'decision_id', 'parent_id']);
  assert.equal(t.update_card.inputSchema.properties.fields.additionalProperties, false);
  console.log('add_cards schema:', JSON.stringify(t.add_cards.inputSchema).slice(0, 1500));
});

test('every tool, happy paths and errors', async () => {
  const store = new MemoryStore();
  const client = await connect(store);
  // seed with the app's sample decision
  const sample = sampleItems();
  await store.create({ id: 'sample-doc', items: sample, createdAt: 1, updatedAt: Date.UTC(2026, 9, 1) });

  // list
  let r = await call(client, 'list_decisions', {});
  assert.ok(!r.isError);
  assert.match(textOf(r), /Which database should power the new orders service\?" \[sample-doc\] · open · 3 options · edited 2026-10-01/);
  assert.equal(r.structuredContent.decisions[0].options, 3);

  // get
  r = await call(client, 'get_decision', { decision_id: 'sample-doc' });
  assert.ok(!r.isError);
  assert.match(textOf(r), /Verdict: PostgreSQL leads by 5 points\./);
  assert.equal(r.structuredContent.cards[0].children.length, 3);
  r = await call(client, 'get_decision', { decision_id: 'nope' });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /No decision with id "nope"/);
  r = await call(client, 'get_decision', { decision_id: '../../etc' });
  assert.equal(r.isError, true); // rejected by the schema

  // create
  r = await call(client, 'create_decision', {
    title: 'Move to Lisbon?',
    notes: 'Remote job',
    cards: [
      { kind: 'option', title: 'Move', children: [{ kind: 'pro', title: 'Sun', impact: 4 }, { kind: 'con', title: 'Far from family', impact: 5 }] },
      { kind: 'option', title: 'Stay', children: [{ kind: 'pro', title: 'Friends', impact: 3 }] },
    ],
  });
  assert.ok(!r.isError, textOf(r));
  const newId = r.structuredContent.decision_id;
  const rootId = r.structuredContent.root_card_id;
  assert.equal(r.structuredContent.card_ids.length, 6);
  assert.match(textOf(r), /Created decision/);
  assert.match(textOf(r), /verdict: Stay leads by 4 points\./);
  r = await call(client, 'create_decision', { title: 'x', cards: [{ kind: 'pro', title: 'p' }] });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /a pro can't go under a decision/);
  assert.equal(store.docs.size, 2); // nothing written on error

  const doc = () => store.docs.get(newId).items;
  const find = (t) => doc().find((i) => i.title === t);

  // add_cards
  r = await call(client, 'add_cards', {
    decision_id: newId,
    parent_id: find('Move').id,
    cards: [{ kind: 'requirement', title: 'Visa', must_have: true, met: false, children: [{ kind: 'action', title: 'Book appointment' }] }],
  });
  assert.ok(!r.isError, textOf(r));
  assert.equal(r.structuredContent.card_ids.length, 2);
  assert.match(textOf(r), /Blocked/);
  r = await call(client, 'add_cards', { decision_id: newId, parent_id: find('Move').id, cards: [{ kind: 'pro', title: 'x', gut: 'good' }] });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /"gut" doesn't apply to a pro/);
  r = await call(client, 'add_cards', { decision_id: newId, parent_id: 'missing', cards: [{ kind: 'note', title: 'n' }] });
  assert.match(textOf(r), /No parent card with id "missing"/);
  r = await call(client, 'add_cards', { decision_id: newId, parent_id: find('Move').id, cards: [{ kind: 'pro', title: 'x', impact: 9 }] });
  assert.equal(r.isError, true); // schema: impact 1–5

  // update_card
  r = await call(client, 'update_card', { decision_id: newId, card_id: find('Visa').id, fields: { met: true } });
  assert.ok(!r.isError, textOf(r));
  assert.equal(find('Visa').met, true);
  r = await call(client, 'update_card', { decision_id: newId, card_id: find('Sun').id, fields: { done: true } });
  assert.match(textOf(r), /"done" doesn't apply to a pro; it is only for action/);
  r = await call(client, 'update_card', { decision_id: newId, card_id: find('Sun').id, fields: { colour: 'red' } });
  assert.equal(r.isError, true); // unknown field rejected by the strict schema
  r = await call(client, 'update_card', { decision_id: newId, card_id: rootId, fields: { review_on: '2026-12-01' } });
  assert.match(textOf(r), /choose an option first/);

  // choose_option
  r = await call(client, 'choose_option', { decision_id: newId, option_id: find('Move').id });
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), /verdict: Chose Move\./);
  assert.equal(doc()[0].decidedAt, Date.UTC(2026, 9, 26, 12));
  r = await call(client, 'update_card', {
    decision_id: newId,
    card_id: rootId,
    fields: { review_on: '2026-12-01', rationale: 'Sun wins', outcome: { rating: 'better', note: 'Great' } },
  });
  assert.ok(!r.isError, textOf(r));
  assert.equal(new Date(doc()[0].reviewAt).toISOString(), '2026-11-30T22:00:00.000Z');
  assert.deepEqual(doc()[0].outcome, { rating: 1, note: 'Great', at: Date.UTC(2026, 9, 26, 12) });
  r = await call(client, 'choose_option', { decision_id: newId, option_id: find('Move').id });
  assert.match(textOf(r), /already chosen/);
  assert.ok(doc()[0].outcome); // unchanged
  r = await call(client, 'choose_option', { decision_id: newId, option_id: find('Stay').id });
  assert.equal(doc()[0].outcome, undefined);
  assert.equal(doc()[0].reviewAt, undefined);
  r = await call(client, 'choose_option', { decision_id: newId, option_id: find('Sun').id });
  assert.match(textOf(r), /only options can be chosen/);
  r = await call(client, 'choose_option', { decision_id: newId, option_id: null });
  assert.match(textOf(r), /Cleared the choice/);
  assert.equal(doc().filter((i) => i.chosen).length, 0);

  // move_card
  r = await call(client, 'move_card', { decision_id: newId, card_id: find('Sun').id, new_parent_id: find('Stay').id });
  assert.ok(!r.isError, textOf(r));
  assert.equal(find('Sun').parentId, find('Stay').id);
  r = await call(client, 'move_card', { decision_id: newId, card_id: find('Sun').id, new_parent_id: rootId });
  assert.match(textOf(r), /a pro can't go under a decision/);
  r = await call(client, 'move_card', { decision_id: newId, card_id: rootId, new_parent_id: find('Stay').id });
  assert.match(textOf(r), /root decision card can't be moved/);

  // delete_card
  r = await call(client, 'delete_card', { decision_id: newId, card_id: find('Visa').id });
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), /Deleted 2 cards/);
  assert.equal(find('Book appointment'), undefined);
  r = await call(client, 'delete_card', { decision_id: newId, card_id: rootId });
  assert.match(textOf(r), /can't be deleted with delete_card/);

  // updatedAt is bumped on writes, extra fields are kept
  assert.equal(store.docs.get(newId).updatedAt, Date.UTC(2026, 9, 26, 12));
  r = await call(client, 'list_decisions', {});
  assert.equal(r.structuredContent.decisions.length, 2);
});

test('a write retries once on conflict, then reports it', async () => {
  const store = new MemoryStore();
  const client = await connect(store);
  const items = sampleItems();
  await store.create({ id: 'd', items, createdAt: 1, updatedAt: 1, extra: { future: 'kept' } });
  const pg = items.find((i) => i.title === 'PostgreSQL');

  store.conflicts = 1;
  let r = await call(client, 'add_cards', { decision_id: 'd', parent_id: pg.id, cards: [{ kind: 'note', title: 'retry me' }] });
  assert.ok(!r.isError, textOf(r));
  const saved = store.docs.get('d');
  assert.ok(saved.items.some((i) => i.title === 'retry me'));
  assert.equal(saved.items[0].notes, 'edited in the app'); // the app's edit survived (re-read before retrying)
  assert.deepEqual(saved.extra, { future: 'kept' });

  store.conflicts = 2;
  r = await call(client, 'add_cards', { decision_id: 'd', parent_id: pg.id, cards: [{ kind: 'note', title: 'nope' }] });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /changed in the app while saving/);
  assert.ok(!store.docs.get('d').items.some((i) => i.title === 'nope'));
});

test('big decisions return only the changed branch', async () => {
  const store = new MemoryStore();
  const client = await connect(store);
  const many = Array.from({ length: 20 }, (_, i) => ({
    kind: 'option',
    title: `Option ${i}`,
    children: Array.from({ length: 8 }, (_, j) => ({ kind: 'pro', title: `pro ${i}.${j}`, impact: 1 })),
  }));
  let r = await call(client, 'create_decision', { title: 'Big', cards: many.slice(0, 10) });
  const id = r.structuredContent.decision_id;
  const root = r.structuredContent.root_card_id;
  r = await call(client, 'add_cards', { decision_id: id, parent_id: root, cards: many.slice(10) });
  assert.ok(!r.isError, textOf(r));
  const opt = store.docs.get(id).items.find((i) => i.title === 'Option 3');
  r = await call(client, 'update_card', { decision_id: id, card_id: opt.id, fields: { title: 'Option three' } });
  assert.match(textOf(r), /showing only the changed branch; the decision has 181 cards/);
  assert.ok(textOf(r).split('\n').length < 20);
});

test('unknown CardInput fields are rejected, not dropped', async () => {
  const client = await connect(new MemoryStore());
  const r = await call(client, 'create_decision', { title: 'x', cards: [{ kind: 'option', title: 'o', weight: 4 }] });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /weight|Unrecognized/i);
});

test('sub-options through the tools: create, scores, choose, update the parent option, un-choose', async () => {
  const store = new MemoryStore();
  const client = await connect(store);
  let r = await call(client, 'create_decision', {
    title: 'Where do we host it?',
    cards: [
      {
        kind: 'option',
        title: 'AWS',
        children: [
          { kind: 'pro', title: 'Team knows it', impact: 3 },
          { kind: 'con', title: 'Bills', impact: 1 },
          { kind: 'option', title: 'DynamoDB', children: [{ kind: 'pro', title: 'Zero ops', impact: 3 }] },
          { kind: 'option', title: 'Aurora', children: [{ kind: 'pro', title: 'Postgres', impact: 5 }] },
        ],
      },
      { kind: 'option', title: 'Self-host', children: [{ kind: 'pro', title: 'Cheap', impact: 4 }] },
    ],
  });
  assert.ok(!r.isError, textOf(r));
  const id = r.structuredContent.decision_id;
  r = await call(client, 'get_decision', { decision_id: id });
  assert.match(textOf(r), /Verdict: AWS leads by 3 points\./);
  assert.match(textOf(r), /Option "AWS" [^\n]*net \+7 \(own \+2 · incl\. "Aurora" \+5\)/);
  assert.match(textOf(r), /Sub-option "Aurora" [^\n]*Leading/);
  const items = () => store.docs.get(id).items;
  const find = (t) => items().find((i) => i.title === t);

  r = await call(client, 'choose_option', { decision_id: id, option_id: find('DynamoDB').id });
  assert.ok(!r.isError, textOf(r));
  assert.equal(find('DynamoDB').chosen, true);
  assert.equal(find('AWS').chosen, false);
  assert.equal(typeof find('AWS').decidedAt, 'number');
  assert.match(textOf(r), /Option "AWS" [^\n]*net \+5 \(own \+2 · incl\. "DynamoDB" \+3\)/);

  r = await call(client, 'update_card', { decision_id: id, card_id: find('AWS').id, fields: { rationale: 'Zero ops', review_on: '2026-12-01' } });
  assert.ok(!r.isError, textOf(r));
  assert.equal(find('AWS').rationale, 'Zero ops');
  r = await call(client, 'update_card', { decision_id: id, card_id: find('Self-host').id, fields: { rationale: 'x' } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /without sub-options/);

  r = await call(client, 'choose_option', { decision_id: id, option_id: null, decision_card_id: find('AWS').id });
  assert.ok(!r.isError, textOf(r));
  assert.equal(find('DynamoDB').chosen, false);
  assert.equal(find('AWS').decidedAt, undefined);
  assert.equal(find('AWS').reviewAt, undefined);
  r = await call(client, 'choose_option', { decision_id: id, option_id: null, decision_card_id: find('Self-host').id });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /not a decision card/);
});
