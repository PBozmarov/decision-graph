// Decision Graph MCP: a remote MCP server (Streamable HTTP at /mcp) behind OAuth 2.1.
import { OAuthError, OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { authApp, type Props } from './auth.ts';
import { FirestoreStore, IdTokenCache, RefreshRevokedError, mintIdToken } from './firestore.ts';
import { INSTRUCTIONS, SERVER_NAME, registerTools } from './tools.ts';

const DEFAULT_TZ = 'Europe/Sofia';

function timeZoneOf(env: Env): string {
  const tz = env.OWNER_TZ || DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/** One Durable Object per MCP session. `this.props` are the grant props ({ uid, refreshToken }). */
export class DecisionGraphMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({ name: SERVER_NAME, version: '1.0.0' }, { instructions: INSTRUCTIONS });
  private tokens: IdTokenCache | null = null;
  private store: FirestoreStore | null = null;

  async init() {
    registerTools(this.server, { store: () => this.firestore(), timeZone: timeZoneOf(this.env) });
  }

  private firestore(): FirestoreStore {
    const props = this.props;
    if (!props?.uid || !props.refreshToken || props.uid !== this.env.OWNER_UID) throw new Error('Not signed in. Reconnect Decision Graph.');
    this.tokens ??= new IdTokenCache(() => this.props!.refreshToken, {
      apiKey: this.env.FIREBASE_API_KEY,
      referer: `${this.env.APP_URL}/`,
      ownerUid: this.env.OWNER_UID,
    });
    this.store ??= new FirestoreStore(this.env.FIREBASE_PROJECT_ID, `users/${props.uid}/docs`, () => this.tokens!.get());
    return this.store;
  }
}

const apiHandler = DecisionGraphMCP.serve('/mcp');

/**
 * When an MCP client refreshes its token, check the owner's Firebase session is still alive.
 * If it was revoked ("sign out everywhere"), the grant is revoked too and Claude must reconnect.
 */
async function tokenExchangeCallback({ grantType, props, env }: { grantType: string; props: Props; env: Env }) {
  if (grantType !== 'refresh_token') return;
  try {
    const t = await mintIdToken(props.refreshToken, { apiKey: env.FIREBASE_API_KEY, referer: `${env.APP_URL}/` });
    if (t.uid !== env.OWNER_UID) throw new OAuthError('invalid_grant', { description: 'This server is private.' });
    if (t.refreshToken !== props.refreshToken) return { newProps: { ...props, refreshToken: t.refreshToken } };
  } catch (e) {
    if (e instanceof OAuthError) throw e;
    if (e instanceof RefreshRevokedError) throw new OAuthError('invalid_grant', { description: 'The Decision Graph sign-in has ended. Connect again.' });
    throw new OAuthError('temporarily_unavailable', { description: 'Sign-in service unavailable, try again shortly.', statusCode: 503 });
  }
}

/**
 * The OAuth resource is the MCP endpoint itself (`<origin>/mcp`): MCP clients such as claude.ai
 * name the server URL as the token's resource, and the provider accepts exactly one resource.
 * The origin isn't known before the first deploy (workers.dev subdomain), so the provider is built
 * per origin and cached.
 */
const providers = new Map<string, OAuthProvider<Env>>();
function providerFor(origin: string): OAuthProvider<Env> {
  let p = providers.get(origin);
  if (!p) {
    p = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler,
      defaultHandler: authApp as unknown as ExportedHandler<Env>,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/token',
      clientRegistrationEndpoint: '/register',
      resourceMetadata: { resource: `${origin}/mcp`, resource_name: 'Decision Graph' },
      tokenExchangeCallback,
    });
    if (providers.size < 8) providers.set(origin, p);
  }
  return p;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const origin = new URL(request.url).origin;
    // A fresh env view per request: the provider attaches its helpers (env.OAUTH_PROVIDER) to it.
    return providerFor(origin).fetch(request, Object.create(env) as Env, ctx);
  },
} satisfies ExportedHandler<Env>;
