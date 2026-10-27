import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleItems } from '../../src/model.ts';
import {
  toFs,
  fromFs,
  toFsFields,
  fromFsFields,
  RawValue,
  FirestoreStore,
  ConflictError,
  IdTokenCache,
  mintIdToken,
  RefreshRevokedError,
} from '../src/firestore.ts';

/** JSON through the wire, like the REST API does. */
const wire = (x) => JSON.parse(JSON.stringify(x));

test('a full sampleItems() doc round-trips losslessly', () => {
  const items = sampleItems();
  // extra/optional fields the app writes, plus a future unknown one
  items[0].rationale = 'Because';
  items[0].decidedAt = 1761480000123;
  items[0].reviewAt = 1764540000000;
  items[0].outcome = { rating: -1, note: 'Slower than hoped', at: 1766000000000 };
  items[1].gut = 0;
  items[2].gut = -1;
  items[3].futureField = { nested: { list: [1, 'two', true, null, 2.5] }, flag: false };
  const doc = { items, createdAt: 1700000000000, updatedAt: 1761480000999 };
  const fields = wire(toFsFields(doc));
  assert.deepEqual(fromFsFields(fields), doc);
  // integers are integerValue strings, as Firestore stores them
  assert.deepEqual(fields.createdAt, { integerValue: '1700000000000' });
  assert.deepEqual(fields.items.arrayValue.values[0].mapValue.fields.weight, { integerValue: '3' });
});

test('odd values', () => {
  const cases = [0, -7, 2.5, -0.125, 1e21, Number.MAX_SAFE_INTEGER, '', 'ünïcødé 🙂', true, false, null, [], {}, { a: { b: { c: [] } } }, [[1], [{}]]];
  for (const v of cases) assert.deepEqual(fromFs(wire(toFs(v))), v, JSON.stringify(v));
  assert.deepEqual(toFs(0), { integerValue: '0' });
  assert.deepEqual(toFs(-7), { integerValue: '-7' });
  assert.deepEqual(toFs(2.5), { doubleValue: 2.5 });
  assert.deepEqual(toFs(2 ** 60), { doubleValue: 2 ** 60 }); // beyond safe integers
  assert.ok(Object.is(fromFs(toFs(-0)), -0)); // (JSON itself can't carry -0)
  assert.deepEqual(Object.keys(toFs(-0)), ['doubleValue']);
  assert.ok(Number.isNaN(fromFs(wire(toFs(NaN)))));
  assert.equal(fromFs(wire(toFs(Infinity))), Infinity);
  assert.equal(fromFs(wire(toFs(-Infinity))), -Infinity);
  // missing / undefined fields are dropped
  assert.deepEqual(toFsFields({ a: 1, b: undefined }), { a: { integerValue: '1' } });
  assert.deepEqual(fromFs(toFs([1, undefined, 2])), [1, 2]);
  assert.deepEqual(fromFs({ mapValue: {} }), {});
  assert.deepEqual(fromFs({ arrayValue: {} }), []);
  // a value type we don't map is kept and written back unchanged
  const ts = { timestampValue: '2026-10-26T10:00:00Z' };
  const raw = fromFs(ts);
  assert.ok(raw instanceof RawValue);
  assert.deepEqual(toFs(raw), ts);
  assert.throws(() => toFs(() => 1), /Can't store a function/);
});

/** A fake Firestore REST endpoint for one collection. */
function fakeFirestore() {
  const docs = new Map();
  let clock = 0;
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method, url: u, auth: init.headers?.Authorization });
    const path = decodeURIComponent(u.pathname).replace(/^.*\/documents\//, '');
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const err = (status, s) => json(status, { error: { code: status, status: s, message: s } });
    const stamp = () => `2026-10-26T00:00:${String(++clock).padStart(2, '0')}.000000Z`;
    const name = (id) => `projects/p/databases/(default)/documents/col/${id}`;
    if (init.method === 'GET' && path === 'col') return json(200, { documents: [...docs.values()] });
    if (init.method === 'POST' && path === 'col') {
      const id = u.searchParams.get('documentId');
      if (docs.has(id)) return err(409, 'ALREADY_EXISTS');
      const d = { name: name(id), fields: JSON.parse(init.body).fields, createTime: stamp(), updateTime: stamp() };
      docs.set(id, d);
      return json(200, d);
    }
    const id = path.split('/')[1];
    if (init.method === 'GET') return docs.has(id) ? json(200, docs.get(id)) : err(404, 'NOT_FOUND');
    if (init.method === 'PATCH') {
      const pre = u.searchParams.get('currentDocument.updateTime');
      if (!docs.has(id)) return err(404, 'NOT_FOUND');
      if (pre && docs.get(id).updateTime !== pre) return err(400, 'FAILED_PRECONDITION');
      const d = { ...docs.get(id), fields: JSON.parse(init.body).fields, updateTime: stamp() };
      docs.set(id, d);
      return json(200, d);
    }
    if (init.method === 'DELETE') {
      docs.delete(id);
      return json(200, {});
    }
    return err(400, 'BAD');
  };
  return { docs, fetcher, calls };
}

test('FirestoreStore: create, get, list, patch with precondition, conflict, delete', async () => {
  const fake = fakeFirestore();
  const store = new FirestoreStore('p', 'col', async () => 'tok', fake.fetcher);
  const items = sampleItems();
  const created = await store.create({ id: 'doc1', items, createdAt: 1, updatedAt: 2, extra: { keep: 'me' } });
  assert.equal(created.id, 'doc1');
  assert.deepEqual(created.items, items);
  assert.deepEqual(created.extra, { keep: 'me' });
  const got = await store.get('doc1');
  assert.equal(got.version, created.version);
  assert.equal(await store.get('missing'), null);
  assert.equal((await store.list()).length, 1);
  const saved = await store.update({ ...got, items: items.slice(0, 2), updatedAt: 3 }, got.version);
  assert.equal(saved.items.length, 2);
  assert.notEqual(saved.version, got.version);
  assert.deepEqual(saved.extra, { keep: 'me' });
  await assert.rejects(store.update({ ...got, updatedAt: 4 }, got.version), ConflictError); // stale version
  await assert.rejects(store.create({ id: 'doc1', items: [], createdAt: 1, updatedAt: 1 }), ConflictError);
  await assert.rejects(store.get('../users/x'), /not a valid decision id/);
  await store.delete('doc1');
  assert.equal(fake.docs.size, 0);
  assert.ok(fake.calls.every((c) => c.auth === 'Bearer tok'));
  const patch = fake.calls.find((c) => c.method === 'PATCH');
  assert.ok(patch.url.searchParams.get('currentDocument.updateTime'));
  assert.equal(patch.url.searchParams.get('updateMask.fieldPaths'), null);
});

test('mintIdToken + IdTokenCache: caches until 5 minutes before expiry, sends Referer', async () => {
  let calls = 0;
  let seen;
  const fetcher = async (url, init) => {
    calls++;
    seen = { url: new URL(url), init };
    return new Response(JSON.stringify({ id_token: `id${calls}`, refresh_token: 'r', expires_in: '3600', user_id: 'owner' }), { status: 200 });
  };
  const cache = new IdTokenCache(() => 'r', { apiKey: 'K', referer: 'https://pomoplan.tech/', ownerUid: 'owner', fetcher });
  assert.equal(await cache.get(), 'id1');
  assert.equal(await cache.get(), 'id1');
  assert.equal(calls, 1);
  assert.equal(seen.url.searchParams.get('key'), 'K');
  assert.equal(seen.init.headers.Referer, 'https://pomoplan.tech/');
  assert.match(seen.init.body, /grant_type=refresh_token&refresh_token=r/);

  const short = async () => new Response(JSON.stringify({ id_token: 'x', refresh_token: 'r', expires_in: '200', user_id: 'owner' }));
  let n = 0;
  const c2 = new IdTokenCache(() => 'r', { apiKey: 'K', referer: 'x', ownerUid: 'owner', fetcher: async (...a) => (n++, short(...a)) });
  await c2.get();
  await c2.get();
  assert.equal(n, 2); // expires in < 5 minutes: renewed every time

  const other = new IdTokenCache(() => 'r', {
    apiKey: 'K',
    referer: 'x',
    ownerUid: 'owner',
    fetcher: async () => new Response(JSON.stringify({ id_token: 'x', refresh_token: 'r', expires_in: '3600', user_id: 'someone-else' })),
  });
  await assert.rejects(other.get(), /private/);

  const revoked = async () => new Response(JSON.stringify({ error: { message: 'TOKEN_EXPIRED' } }), { status: 400 });
  await assert.rejects(mintIdToken('r', { apiKey: 'K', referer: 'x', fetcher: revoked }), RefreshRevokedError);
  const down = async () => new Response('oops', { status: 503 });
  await assert.rejects(mintIdToken('r', { apiKey: 'K', referer: 'x', fetcher: down }), (e) => !(e instanceof RefreshRevokedError));
});
