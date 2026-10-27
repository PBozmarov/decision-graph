import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64url, signState, verifyState, verifyIdToken } from '../src/verify.ts';

const SECRET = 'x'.repeat(64);
const enc = new TextEncoder();

test('HMAC state: round-trips, rejects tampering, expiry and a wrong secret', async () => {
  const req = { responseType: 'code', clientId: 'c1', redirectUri: 'https://claude.ai/cb', scope: [], state: 's', codeChallenge: 'abc', codeChallengeMethod: 'S256' };
  const state = await signState(req, SECRET, 1000);
  assert.deepEqual(await verifyState(state, SECRET, 2000), req);
  const [body, sig] = state.split('.');
  const forged = b64url(enc.encode(JSON.stringify({ r: { ...req, redirectUri: 'https://evil.example/cb' }, exp: 10 ** 15 })));
  await assert.rejects(verifyState(`${forged}.${sig}`, SECRET, 2000), /signature/);
  await assert.rejects(verifyState(`${body}.${sig.slice(0, -2)}AA`, SECRET, 2000), /signature/);
  await assert.rejects(verifyState(state, 'y'.repeat(64), 2000), /signature/);
  await assert.rejects(verifyState(state, SECRET, 1000 + 11 * 60_000), /expired/);
  await assert.rejects(verifyState('garbage', SECRET), /bad state/);
  await assert.rejects(signState(req, 'short'), /STATE_SECRET/);
});

/** A local RSA key served as a fake securetoken JWKS. */
async function keyring(kid) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid, alg: 'RS256', use: 'sig' };
  const fetcher = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Cache-Control': 'public, max-age=20000' } });
  const sign = async (claims, header = { alg: 'RS256', kid, typ: 'JWT' }) => {
    const h = b64url(enc.encode(JSON.stringify(header)));
    const p = b64url(enc.encode(JSON.stringify(claims)));
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(`${h}.${p}`)));
    return `${h}.${p}.${b64url(sig)}`;
  };
  return { fetcher, sign };
}

test('Firebase ID token verification', async () => {
  const P = 'pomoplan-tech-25101';
  const now = 1_800_000_000;
  const good = { iss: `https://securetoken.google.com/${P}`, aud: P, sub: 'owner', email: 'o@example.com', iat: now - 60, exp: now + 3000, auth_time: now - 60 };
  const k = await keyring('kid-1');
  const opts = { fetcher: k.fetcher, now: now * 1000 };
  const claims = await verifyIdToken(await k.sign(good), P, opts);
  assert.equal(claims.sub, 'owner');

  const bad = async (patch, re, header) => assert.rejects(verifyIdToken(await k.sign({ ...good, ...patch }, header), P, opts), re);
  await bad({ aud: 'other-project' }, /audience/);
  await bad({ iss: 'https://securetoken.google.com/other' }, /issuer/);
  await bad({ exp: now - 1 }, /expired/);
  await bad({ iat: now + 1000 }, /future/);
  await bad({ sub: '' }, /subject/);
  await bad({ auth_time: now - 3600 }, /too old/);
  await bad({}, /algorithm/, { alg: 'HS256', kid: 'kid-1' });
  await bad({}, /algorithm/, { alg: 'none', kid: 'kid-1' });
  await bad({}, /unknown signing key/, { alg: 'RS256', kid: 'kid-missing' });
  // signed by another key with the same kid
  const evil = await keyring('kid-1');
  await assert.rejects(verifyIdToken(await evil.sign(good), P, opts), /signature/);
  // tampered payload
  const t = await k.sign(good);
  const [h, , s] = t.split('.');
  const p2 = b64url(enc.encode(JSON.stringify({ ...good, sub: 'attacker' })));
  await assert.rejects(verifyIdToken(`${h}.${p2}.${s}`, P, opts), /signature/);
  await assert.rejects(verifyIdToken('a.b', P, opts), /malformed/);
});
