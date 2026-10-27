// /authorize: the owner signs in with the app's own Firebase Google sign-in, and only the owner's
// account is accepted. The Firebase refresh token is kept in the grant props (encrypted by the provider).
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { AuthorizationError } from '@cloudflare/workers-oauth-provider';
import { mintIdToken } from './firestore.ts';
import { b64url, signState, verifyIdToken, verifyState, type FirebaseClaims } from './verify.ts';
import { page, esc, ICON, GOOGLE_MARK } from './pages.ts';

export type AuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

/** What the provider stores with each grant (encrypted) and hands to the MCP handler as ctx.props. */
export type Props = { uid: string; refreshToken: string };

const FIREBASE_VERSION = '12.19.0';

/* ---------- pages ---------- */

const htmlHeaders = (csp: string, status = 200): ResponseInit => ({
  status,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin',
    'Cache-Control': 'no-store',
  },
});

const nonce = () => b64url(crypto.getRandomValues(new Uint8Array(16)));
const plainCsp = (n: string) => `default-src 'none'; style-src 'nonce-${n}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

export function messagePage(title: string, body: string, status: number): Response {
  const n = nonce();
  return new Response(
    page({
      nonce: n,
      title,
      body: `<main class="card">${ICON}<h1>${esc(title)}</h1><p class="lead">${body}</p></main>`,
    }),
    htmlHeaders(plainCsp(n), status),
  );
}

const privatePage = () =>
  messagePage(
    'This server is private',
    'Only the owner of Decision Graph can connect to it. If that’s you, sign in with the Google account you use in the app.',
    403,
  );

function loginPage(env: Env, clientName: string, redirectHost: string, loopback: boolean, state: string): Response {
  const n = nonce();
  const cfg = {
    state,
    firebase: { apiKey: env.FIREBASE_API_KEY, authDomain: env.FIREBASE_AUTH_DOMAIN, projectId: env.FIREBASE_PROJECT_ID },
  };
  // JSON inside <script>: escape "<" so nothing can close the tag.
  const cfgJson = JSON.stringify(cfg).replace(/</g, '\\u003c');
  const v = FIREBASE_VERSION;
  const script = `
import { initializeApp } from 'https://www.gstatic.com/firebasejs/${v}/firebase-app.js';
import { initializeAuth, inMemoryPersistence, browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/${v}/firebase-auth.js';
const cfg = JSON.parse(document.getElementById('cfg').textContent);
// In-memory only: no Firebase session is left behind on this site.
const auth = initializeAuth(initializeApp(cfg.firebase), { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
const btn = document.getElementById('signin');
const msg = document.getElementById('msg');
const say = (text, kind) => { msg.textContent = text; msg.className = 'msg' + (kind ? ' ' + kind : ''); };
btn.addEventListener('click', async () => {
  btn.disabled = true; btn.classList.add('busy'); say('');
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const { user } = await signInWithPopup(auth, provider);
    const idToken = await user.getIdToken();
    const res = await fetch('/authorize/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, refreshToken: user.refreshToken, state: cfg.state }),
    });
    await signOut(auth).catch(() => {});
    if (res.ok) {
      const { redirectTo } = await res.json();
      say('Connected. Returning you to the app…', 'ok');
      location.replace(redirectTo);
      return;
    }
    if (res.status === 403) say('This server is private. Only the owner’s Google account can connect.', 'err');
    else if (res.status === 410) say('This sign-in link has expired. Start connecting again from the app.', 'err');
    else say('Sign-in couldn’t be completed. Please try again.', 'err');
  } catch (e) {
    const code = (e && e.code) || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') say('');
    else if (code === 'auth/popup-blocked') say('Your browser blocked the sign-in window. Allow pop-ups for this page and try again.', 'err');
    else if (code === 'auth/unauthorized-domain') say('Google sign-in isn’t enabled for this address yet.', 'err');
    else say('Sign-in didn’t work. Please try again.', 'err');
  }
  btn.disabled = false; btn.classList.remove('busy');
});`;
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${n}' https://www.gstatic.com https://apis.google.com`,
    `style-src 'nonce-${n}'`,
    'img-src data:',
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com",
    `frame-src https://${env.FIREBASE_AUTH_DOMAIN}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  const name = esc(clientName);
  const body = `<main class="card">
  ${ICON}
  <h1>Connect ${name} to Decision Graph</h1>
  <p class="lead">${name} will be able to read and edit your decisions.</p>
  <ul class="facts">
    <li><span class="dot" aria-hidden="true"></span><span>Reads your decisions, options, pros, cons and notes</span></li>
    <li><span class="dot" aria-hidden="true"></span><span>Adds, changes, moves and deletes cards; edits appear live in the app</span></li>
    <li><span class="dot" aria-hidden="true"></span><span>Access goes to <b>${esc(redirectHost)}</b></span></li>
  </ul>
  ${loopback ? '<p class="warn">This sends access to an app on your computer. Continue only if you just started connecting from it.</p>' : ''}
  <button id="signin" class="google-btn" type="button">${GOOGLE_MARK}<span>Sign in with Google</span></button>
  <p id="msg" class="msg" role="status" aria-live="polite"></p>
  <p class="foot">Only the owner’s account can connect. You can disconnect at any time.</p>
</main>
<script type="application/json" id="cfg">${cfgJson}</script>
<script type="module" nonce="${n}">${script}</script>`;
  return new Response(page({ nonce: n, title: `Connect ${clientName} · Decision Graph`, body }), htmlHeaders(csp));
}

/* ---------- handler ---------- */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function authorize(request: Request, env: AuthEnv): Promise<Response> {
  let oauthReq: AuthRequest;
  try {
    oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return messagePage('Can’t connect', esc(e.description), 400);
    throw e;
  }
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
  if (!client) return messagePage('Can’t connect', 'This app isn’t registered. Start connecting again from the app.', 400);
  const redirect = new URL(oauthReq.redirectUri);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname) || redirect.hostname.startsWith('127.');
  const state = await signState(oauthReq, env.STATE_SECRET);
  return loginPage(env, client.clientName || 'An app', redirect.host, loopback, state);
}

async function complete(request: Request, env: AuthEnv): Promise<Response> {
  // Same-origin JSON only (defense in depth; the owner's ID token is the real proof).
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'bad origin' }, 403);
  if (!(request.headers.get('Content-Type') ?? '').startsWith('application/json')) return json({ error: 'expected JSON' }, 415);
  const raw = await request.text();
  if (raw.length > 32_000) return json({ error: 'too large' }, 413);
  let input: { idToken?: unknown; refreshToken?: unknown; state?: unknown };
  try {
    input = JSON.parse(raw);
  } catch {
    return json({ error: 'bad JSON' }, 400);
  }
  if (typeof input.idToken !== 'string' || typeof input.refreshToken !== 'string' || typeof input.state !== 'string') {
    return json({ error: 'missing fields' }, 400);
  }

  let oauthReq: AuthRequest;
  try {
    oauthReq = await verifyState(input.state, env.STATE_SECRET);
  } catch {
    return json({ error: 'This sign-in link has expired or is invalid.' }, 410);
  }

  let claims: FirebaseClaims;
  try {
    claims = await verifyIdToken(input.idToken, env.FIREBASE_PROJECT_ID);
  } catch {
    return privatePage();
  }
  if (claims.sub !== env.OWNER_UID) return privatePage();

  // The refresh token must belong to the same (owner) account, and must work.
  let minted;
  try {
    minted = await mintIdToken(input.refreshToken, { apiKey: env.FIREBASE_API_KEY, referer: `${env.APP_URL}/` });
  } catch {
    return json({ error: 'Sign-in couldn’t be confirmed.' }, 400);
  }
  if (minted.uid !== claims.sub) return privatePage();

  const props: Props = { uid: claims.sub, refreshToken: minted.refreshToken };
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: claims.sub,
    metadata: { label: claims.email ?? '' },
    scope: oauthReq.scope,
    props,
  });
  return json({ redirectTo });
}

/** The provider's defaultHandler: login pages and the small info page. */
export const authApp = {
  async fetch(request: Request, env: AuthEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/authorize' && request.method === 'GET') return authorize(request, env);
    if (url.pathname === '/authorize/complete' && request.method === 'POST') return complete(request, env);
    if (url.pathname === '/' && (request.method === 'GET' || request.method === 'HEAD')) {
      return messagePage(
        'Decision Graph MCP',
        `A private connector that lets Claude read and edit the owner’s decisions in <a href="${esc(env.APP_URL)}">Decision Graph</a>. Connect at <code>${esc(url.origin)}/mcp</code>.`,
        200,
      );
    }
    return messagePage('Not found', 'There’s nothing here.', 404);
  },
};
