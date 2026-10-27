# Decision Graph MCP

A private remote MCP server that lets Claude (claude.ai web, desktop, mobile, and Claude Code) list, read and edit the owner's decisions in [Decision Graph](https://pomoplan.tech). Edits show up live in the open app, which listens to Firestore.

- Cloudflare Worker `decision-graph-mcp`: MCP over Streamable HTTP at `/mcp`, with OAuth 2.1 (dynamic client registration + PKCE) from `@cloudflare/workers-oauth-provider`.
- Sign-in (`/authorize`) uses the app's own Firebase Google sign-in in a popup. The Worker verifies the Firebase ID token (RS256, Google's securetoken keys, audience, issuer, expiry, a fresh `auth_time`) and accepts only `OWNER_UID`.
- Data goes through Firestore REST **as the owner**: the owner's Firebase refresh token is stored in the grant props (encrypted by the OAuth provider) and exchanged for short-lived ID tokens. The app's `firestore.rules` (owner-only) keep protecting everything. There's no service account and no new Google OAuth client.

## Tools

| Tool | What it does | Hints |
| --- | --- | --- |
| `list_decisions()` | Every decision: id, title, status (`open` / `decided: <option>`), option count, last edited, `review_due` | read-only |
| `get_decision(decision_id)` | Outline (one line per card: id, kind, title, badges), the verdict, and a JSON tree in `structuredContent` | read-only |
| `create_decision(title, notes?, cards?)` | New decision; `cards` is nested `CardInput` under the root decision card | |
| `add_cards(decision_id, parent_id, cards, after_id?)` | Add nested cards; returns the new ids | |
| `update_card(decision_id, card_id, fields)` | `title`, `notes`, `collapsed` on any card; `impact` (pro/con/risk); `met`, `must_have` (requirement); `done` (action); `gut` (option); `rationale`, `review_on`, `outcome` (decision card: a decision, or an option with sub-options) | idempotent |
| `move_card(decision_id, card_id, new_parent_id, after_id?)` | Move a card and its branch | |
| `delete_card(decision_id, card_id)` | Delete a card and its branch (not the root) | destructive |
| `choose_option(decision_id, option_id \| null, decision_card_id?)` | Choose an option (its parent is the decision card: a decision, or an option for a sub-option), or `null` to un-choose (the root decision, or `decision_card_id`) | idempotent |

`CardInput = { kind: problem|option|requirement|pro|con|risk|action|note, title, notes?, impact?, met?, must_have?, done?, gut?: uneasy|neutral|good|null, children?: CardInput[] }`.

Rules (the same as the app's): children must fit the parent's kind (an option can hold sub-options: options inside an option, scored as own net + the chosen or best viable sub-option's net); impact is 1–5; titles ≤ 300 characters; notes ≤ 5000; ≤ 300 cards and ≤ 8 nesting levels per call. Choosing an option sets `decidedAt` and clears `reviewAt`/`outcome`; moving the chosen option away un-decides its old decision. `review_on: "YYYY-MM-DD"` becomes the start of that day in `OWNER_TZ` (default `Europe/Sofia`); `outcome: { rating: worse|as_expected|better, note? }` becomes `{ rating: -1|0|1, note, at: now }`. Both need a chosen option. Every write reads the document, applies the change, and saves with Firestore's `updateTime` precondition, retrying once if the app saved in between. There's no `delete_decision`: whole decisions are deleted in the app.

## Deploy

```sh
cd mcp && npm install
npx wrangler login                              # once
npx wrangler kv namespace create OAUTH_KV       # paste the id into wrangler.jsonc (kv_namespaces[0].id)
openssl rand -hex 32 | npx wrangler secret put STATE_SECRET
npx wrangler deploy                             # prints https://decision-graph-mcp.<subdomain>.workers.dev
```

Then add `decision-graph-mcp.<subdomain>.workers.dev` to **Firebase Console → Authentication → Settings → Authorized domains**, otherwise the Google popup fails with `auth/unauthorized-domain`.

The OAuth resource (the token audience) is the MCP endpoint, `https://<worker>/mcp` (claude.ai names the server URL as the resource; the provider accepts exactly one). If you later move to a custom domain, connected clients sign in again once.

## Connect

- **claude.ai** (web, desktop and mobile): Settings → Connectors → Add custom connector → URL `https://decision-graph-mcp.<subdomain>.workers.dev/mcp`, then Connect and sign in with Google.
- **Claude Code**: `claude mcp add --transport http decision-graph https://decision-graph-mcp.<subdomain>.workers.dev/mcp`, then run `/mcp` and choose Authenticate.

## Revoke access

- **One client**: disconnect it in Claude. To remove its server-side grant too, delete the grant: `npx wrangler kv key list --binding OAUTH_KV --remote --prefix grant:` and then `npx wrangler kv key delete --binding OAUTH_KV --remote "<key>"`.
- **Everything**: revoke the owner's Firebase refresh tokens ("sign out everywhere", e.g. the Admin SDK's `revokeRefreshTokens(uid)`). The stored refresh token stops working, and the next token refresh revokes the grant, so Claude has to reconnect. This also signs the app out on every device.
- **Rotate `STATE_SECRET`** to invalidate sign-in pages that are open but not yet completed.

## Develop and test

```sh
npm run typecheck                                # tsc --noEmit
npm test                                         # node --test: graph, converters, crypto, MCP protocol
npx wrangler deploy --dry-run --outdir dist      # bundle check, no login needed
npx wrangler dev                                 # http://localhost:8787 (local KV; put STATE_SECRET in .dev.vars)
node test/live-firestore.mjs                     # live REST test in mcp-selftest/{random} only (Firebase CLI token)
```

`worker-configuration.d.ts` is generated by `npx wrangler types`; re-run that after changing `wrangler.jsonc`.
