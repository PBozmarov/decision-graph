// Live Firestore REST self-test, SAFE path only: a scratch collection mcp-selftest/{random}/docs,
// never users/*. Auth: the Firebase CLI's OAuth access token (IAM; security rules don't apply).
// Run: node test/live-firestore.mjs   (refresh the token first with any firebase CLI command)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { sampleItems } from '../../src/model.ts';
import { FirestoreStore, ConflictError } from '../src/firestore.ts';
import { registerTools } from '../src/tools.ts';

const PROJECT = 'pomoplan-tech-25101';
const SCRATCH = `mcp-selftest/${crypto.randomUUID()}/docs`;
const ALLOWED = `/v1/projects/${PROJECT}/databases/(default)/documents/${SCRATCH}`;

function token() {
  const t = JSON.parse(readFileSync(`${homedir()}/.config/configstore/firebase-tools.json`, 'utf8')).tokens;
  if (!t?.access_token || t.expires_at < Date.now() + 60_000) throw new Error('Firebase CLI token expired: run any firebase CLI command first.');
  return t.access_token;
}

/** Every request must stay inside the scratch collection. */
const guarded = (url, init) => {
  const u = new URL(url);
  const path = decodeURIComponent(u.pathname);
  if (u.hostname !== 'firestore.googleapis.com' || !path.startsWith(ALLOWED) || path.includes('/users/')) {
    throw new Error(`Refusing a request outside the scratch collection: ${path}`);
  }
  return fetch(url, { ...init, headers: { ...init.headers, 'x-goog-user-project': PROJECT } });
};

const store = new FirestoreStore(PROJECT, SCRATCH, async () => token(), guarded);
const created = [];
const log = (s) => console.log(`ok - ${s}`);

try {
  // create + get
  const items = sampleItems();
  items[0].outcome = { rating: 1, note: 'x', at: 1766000000000 };
  items[1].gut = -1;
  items[2].futureField = { a: [1, 2.5, '', null, { b: false }] };
  const a = await store.create({ id: crypto.randomUUID(), items, createdAt: 1700000000000, updatedAt: 1700000000001, extra: { keepMe: 0 } });
  created.push(a.id);
  log(`create ${a.id.slice(0, 8)}… (version ${a.version})`);
  const got = await store.get(a.id);
  assert.deepEqual(got.items, items);
  assert.deepEqual(got.extra, { keepMe: 0 });
  assert.equal(got.createdAt, 1700000000000);
  log('get: items round-trip losslessly through Firestore');

  // patch with the right precondition
  const v1 = got.version;
  const saved = await store.update({ ...got, items: items.slice(0, 3), updatedAt: 1700000000002 }, v1);
  assert.equal(saved.items.length, 3);
  assert.notEqual(saved.version, v1);
  log('patch with currentDocument.updateTime precondition');

  // a stale precondition must fail
  await assert.rejects(store.update({ ...got, updatedAt: 1700000000003 }, v1), ConflictError);
  assert.equal((await store.get(a.id)).items.length, 3);
  log('stale precondition rejected (ConflictError), document unchanged');

  // create again with the same id must fail
  await assert.rejects(store.create({ id: a.id, items: [], createdAt: 1, updatedAt: 1 }), ConflictError);
  log('create with an existing id rejected');

  // the tools end to end on the live scratch store
  const server = new McpServer({ name: 'Decision Graph', version: '1.0.0' });
  registerTools(server, { store: () => store, timeZone: 'Europe/Sofia' });
  const [t1, t2] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'selftest', version: '1.0.0' });
  await Promise.all([server.connect(t1), client.connect(t2)]);
  let r = await client.callTool({ name: 'create_decision', arguments: { title: 'Self-test', cards: [{ kind: 'option', title: 'A' }, { kind: 'option', title: 'B' }] } });
  assert.ok(!r.isError, r.content[0].text);
  const b = r.structuredContent.decision_id;
  created.push(b);
  const root = r.structuredContent.root_card_id;
  const optA = r.structuredContent.card_ids[1];
  r = await client.callTool({ name: 'add_cards', arguments: { decision_id: b, parent_id: optA, cards: [{ kind: 'pro', title: 'Fast', impact: 4 }] } });
  assert.ok(!r.isError, r.content[0].text);
  r = await client.callTool({ name: 'choose_option', arguments: { decision_id: b, option_id: optA } });
  assert.ok(!r.isError);
  r = await client.callTool({ name: 'update_card', arguments: { decision_id: b, card_id: root, fields: { review_on: '2026-12-01' } } });
  assert.ok(!r.isError, r.content[0].text);
  r = await client.callTool({ name: 'get_decision', arguments: { decision_id: b } });
  assert.match(r.content[0].text, /Chose A/);
  assert.match(r.content[0].text, /check back 2026-12-01/);
  log('tools: create_decision, add_cards, choose_option, update_card, get_decision against Firestore');

  // list
  const listed = await store.list();
  assert.deepEqual(listed.map((d) => d.id).sort(), [...created].sort());
  r = await client.callTool({ name: 'list_decisions', arguments: {} });
  assert.equal(r.structuredContent.decisions.length, 2);
  log(`list: ${listed.length} scratch docs`);
} finally {
  for (const id of created) await store.delete(id).catch((e) => console.log(`cleanup failed for ${id}: ${e.message}`));
  const left = await store.list();
  assert.equal(left.length, 0);
  console.log(`ok - delete: scratch collection ${SCRATCH.split('/').slice(0, 2).join('/')} is empty again`);
}
