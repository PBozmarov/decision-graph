// Pure crypto for the sign-in flow (no Workers-only imports, so Node can test it).
import type { AuthRequest } from '@cloudflare/workers-oauth-provider';

const STATE_TTL_MS = 10 * 60_000;
const MAX_AUTH_AGE_S = 10 * 60; // the Google sign-in must have just happened
const CLOCK_SKEW_S = 300;

/* ---------- base64url + HMAC state ---------- */

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64url');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string) {
  if (!secret || secret.length < 32) throw new Error('STATE_SECRET is not set (needs 32+ characters).');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** The parsed auth request, serialized with an expiry and HMAC-signed, so it survives the sign-in untouched. */
export async function signState(request: AuthRequest, secret: string, now = Date.now()): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ r: request, exp: now + STATE_TTL_MS })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifyState(state: string, secret: string, now = Date.now()): Promise<AuthRequest> {
  const [body, sig, extra] = String(state).split('.');
  if (!body || !sig || extra !== undefined) throw new Error('bad state');
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(body));
  if (!ok) throw new Error('bad state signature');
  const { r, exp } = JSON.parse(new TextDecoder().decode(unb64url(body))) as { r: AuthRequest; exp: number };
  if (typeof exp !== 'number' || exp < now) throw new Error('state expired');
  return r;
}

/* ---------- Firebase ID token verification ---------- */

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwks: { keys: Map<string, CryptoKey>; until: number } | null = null;

async function loadJwks(fetcher: typeof fetch): Promise<Map<string, CryptoKey>> {
  const res = await fetcher(JWKS_URL);
  if (!res.ok) throw new Error(`Couldn't load Google's signing keys (${res.status}).`);
  const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
  const map = new Map<string, CryptoKey>();
  for (const k of keys) {
    if (k.kty !== 'RSA' || !k.kid) continue;
    map.set(k.kid, await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')?.[1] ?? 3600);
  jwks = { keys: map, until: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 };
  return map;
}

async function signingKey(kid: string, fetcher: typeof fetch): Promise<CryptoKey | undefined> {
  if (jwks && jwks.until > Date.now() && jwks.keys.has(kid)) return jwks.keys.get(kid);
  return (await loadJwks(fetcher)).get(kid); // unknown kid: Google may have rotated keys
}

export type FirebaseClaims = { sub: string; email?: string; aud: string; iss: string; iat: number; exp: number; auth_time: number };

/** Verify a Firebase ID token: RS256 by Google's securetoken keys, for this project, current. */
export async function verifyIdToken(
  token: string,
  projectId: string,
  opts: { fetcher?: typeof fetch; now?: number } = {},
): Promise<FirebaseClaims> {
  const fetcher = opts.fetcher ?? ((...a) => fetch(...a));
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const dec = (s: string) => JSON.parse(new TextDecoder().decode(unb64url(s)));
  const header = dec(parts[0]) as { alg?: string; kid?: string };
  const claims = dec(parts[1]) as FirebaseClaims;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('unexpected token algorithm');
  const key = await signingKey(header.kid, fetcher);
  if (!key) throw new Error('unknown signing key');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error('bad token signature');
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (claims.aud !== projectId) throw new Error('wrong audience');
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('wrong issuer');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw new Error('missing subject');
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('token expired');
  if (typeof claims.iat !== 'number' || claims.iat > now + CLOCK_SKEW_S) throw new Error('token issued in the future');
  if (typeof claims.auth_time !== 'number' || claims.auth_time > now + CLOCK_SKEW_S) throw new Error('bad auth_time');
  if (now - claims.auth_time > MAX_AUTH_AGE_S) throw new Error('sign-in is too old');
  return claims;
}
