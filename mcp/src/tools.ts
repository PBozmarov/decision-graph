// The MCP tools. Storage is injected (Firestore in the Worker, an in-memory store in tests).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  ALL_KINDS,
  GraphError,
  LIMITS,
  addCards,
  branchIds,
  chooseOption,
  createDecision,
  deleteCard,
  describe as describeItems,
  moveCard,
  rootOf,
  summarize,
  titleOf,
  updateCard,
  type CardInput,
  type Item,
} from './graph.ts';
import { ConflictError, NotFoundError, checkDocId, type DocStore, type StoredDoc } from './firestore.ts';

export const SERVER_NAME = 'Decision Graph';

export const INSTRUCTIONS = `Decision Graph is the owner's private tool for thinking through decisions as a tree of cards. You can read and edit their decisions; changes show up live in the app.

Model:
- Each decision (decision_id) is one document whose root card is a "problem" (shown as Decision).
- A decision holds options (and notes). An option holds requirement, pro, con, risk, action and note cards, sub-options (option cards inside an option: variants of that path, e.g. AWS → DynamoDB / Aurora) and sub-decisions (another "problem" card with its own options). A requirement can hold actions and notes; pro/con/risk/action hold only notes. Sub-options can have their own sub-options.
- pro, con and risk have an impact from 1 to 5. An option's own score is pros − cons − risks. Its score (net) is its own score plus the net of its chosen sub-option or, when none is chosen, its best viable sub-option (shown as "own +2 · incl. Aurora +5").
- A requirement can be met or not; a must-have requirement that isn't met blocks its option (ruled out of the verdict). An option whose sub-options are all blocked is blocked too.
- The verdict compares the viable options by net score ("PostgreSQL leads by 5 points"); a lead of 2 or less is a close call. Every decision card has one: a decision, and an option with sub-options (among its sub-options).
- Options can carry a gut feeling (uneasy / neutral / good). Choosing an option marks its decision card decided (for a sub-option, that's its parent option; choosing it doesn't choose the parent); the owner can then set a check-back date (review_on) and later record how it turned out (outcome).

Working with it:
- Call list_decisions, then get_decision to see card ids before editing. Ids are exact strings.
- add_cards and create_decision take nested cards, so a whole option with its pros and cons is one call.
- Keep titles short (a few words); put detail in notes.
- Don't choose an option for the owner unless they asked you to.`;

/* ---------- schemas ---------- */

const id = (what: string) => z.string().min(1).max(128).describe(what);
const decisionId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, 'A decision id from list_decisions')
  .describe('Decision id from list_decisions');
const gut = z.enum(['uneasy', 'neutral', 'good']);

const Card = z.strictObject({
  kind: z
    .enum(ALL_KINDS as [Item['kind'], ...Item['kind'][]])
    .describe('problem = a (sub-)decision; option (inside an option: a sub-option); requirement; pro; con; risk; action; note'),
  title: z.string().max(LIMITS.title).describe('Short title'),
  notes: z.string().max(LIMITS.notes).optional().describe('Longer detail'),
  impact: z.number().int().min(1).max(5).optional().describe('pro / con / risk only: 1 (minor) to 5 (major). Default 3'),
  met: z.boolean().optional().describe('requirement only: is it met?'),
  must_have: z.boolean().optional().describe('requirement only: an option missing a must-have is ruled out'),
  done: z.boolean().optional().describe('action only'),
  gut: gut.nullable().optional().describe('option only: how the path feels'),
  get children(): z.ZodOptional<z.ZodArray<typeof Card>> {
    return z.array(Card).max(LIMITS.cardsPerCall).optional().describe('Cards nested under this one');
  },
});

const cards = z
  .array(Card)
  .max(LIMITS.cardsPerCall)
  .describe(`Nested cards (at most ${LIMITS.cardsPerCall} in total, ${LIMITS.depth} levels deep)`);

const Fields = z
  .object({
    title: z.string().max(LIMITS.title).optional(),
    notes: z.string().max(LIMITS.notes).optional(),
    impact: z.number().int().min(1).max(5).optional().describe('pro / con / risk'),
    met: z.boolean().optional().describe('requirement'),
    must_have: z.boolean().optional().describe('requirement'),
    done: z.boolean().optional().describe('action'),
    gut: gut.nullable().optional().describe('option; null clears it'),
    collapsed: z.boolean().optional().describe('Fold the card’s children in the app'),
    rationale: z
      .string()
      .max(LIMITS.notes)
      .optional()
      .describe('decision card (a decision, or an option with sub-options): why the chosen option won ("" clears it)'),
    review_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional()
      .describe("decision card (decided): check-back date YYYY-MM-DD in the owner's time zone; null clears it"),
    outcome: z
      .object({
        rating: z.enum(['worse', 'as_expected', 'better']),
        note: z.string().max(LIMITS.notes).optional().describe('What they learned'),
      })
      .nullable()
      .optional()
      .describe('decision card (decided): how the choice turned out; null clears it'),
  })
  .strict();

/* ---------- helpers ---------- */

export type ToolDeps = {
  store: () => DocStore | Promise<DocStore>;
  timeZone: string;
  now?: () => number;
};

/** Outlines longer than this are shortened to the changed branch. */
const BIG_DOC = 150;

const text = (s: string, structured?: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text: s }],
  ...(structured ? { structuredContent: structured } : {}),
});

const fail = (s: string): CallToolResult => ({ content: [{ type: 'text', text: s }], isError: true });

/** Expected mistakes become readable tool errors; anything else too, but without internals. */
function guard<A>(fn: (a: A) => Promise<CallToolResult>) {
  return async (a: A): Promise<CallToolResult> => {
    try {
      return await fn(a);
    } catch (e) {
      if (e instanceof GraphError || e instanceof NotFoundError) return fail(e.message);
      if (e instanceof ConflictError) return fail('The decision changed in the app while saving. Call get_decision and try again.');
      return fail(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}

async function load(store: DocStore, decision_id: string): Promise<StoredDoc> {
  checkDocId(decision_id);
  const doc = await store.get(decision_id);
  if (!doc) throw new NotFoundError(`No decision with id "${decision_id}". Call list_decisions to see the ids.`);
  return doc;
}

/**
 * Read → apply a pure change → write with the updateTime precondition. If the app saved in
 * between, re-read and apply once more; a second conflict is reported.
 */
async function mutate<R extends { items: Item[] }>(
  deps: ToolDeps,
  decision_id: string,
  change: (items: Item[]) => R,
): Promise<{ doc: StoredDoc; result: R; changed: boolean }> {
  const store = await deps.store();
  for (let attempt = 0; ; attempt++) {
    const doc = await load(store, decision_id);
    const result = change(doc.items);
    if (result.items === doc.items) return { doc, result, changed: false };
    try {
      const saved = await store.update(
        { id: doc.id, items: result.items, createdAt: doc.createdAt, updatedAt: (deps.now ?? Date.now)(), extra: doc.extra },
        doc.version,
      );
      return { doc: saved, result, changed: true };
    } catch (e) {
      if (e instanceof ConflictError && attempt === 0) continue;
      throw e;
    }
  }
}

/** The whole outline, or for a big decision only the branch that changed. */
function after(deps: ToolDeps, doc: StoredDoc, focusId: string | null, head: string): CallToolResult {
  const opts = { timeZone: deps.timeZone, now: deps.now?.() };
  let items = doc.items;
  let scope = '';
  if (items.length > BIG_DOC && focusId && items.some((i) => i.id === focusId)) {
    const ids = branchIds(items, focusId);
    items = items.filter((i) => ids.has(i.id)).map((i) => (i.id === focusId ? { ...i, parentId: null } : i));
    scope = ` (showing only the changed branch; the decision has ${doc.items.length} cards, call get_decision for all)`;
  }
  const { outline } = describeItems(items, opts);
  return text(`${head}${scope}\n\n${outline}`, { decision_id: doc.id, updated_at: new Date(doc.updatedAt).toISOString() });
}

/* ---------- tools ---------- */

export function registerTools(server: McpServer, deps: ToolDeps) {
  const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const write = (destructive: boolean, idempotent: boolean) => ({
    readOnlyHint: false,
    destructiveHint: destructive,
    idempotentHint: idempotent,
    openWorldHint: false,
  });

  server.registerTool(
    'list_decisions',
    {
      title: 'List decisions',
      description: 'List all of the owner’s decisions, most recently edited first: id, title, status, option count, last edited, and whether a check-back review is due.',
      inputSchema: {},
      annotations: ro,
    },
    guard(async () => {
      const store = await deps.store();
      const now = deps.now?.() ?? Date.now();
      const docs = (await store.list()).sort((a, b) => b.updatedAt - a.updatedAt);
      const rows = docs.map((d) => {
        const s = summarize(d.items, now);
        return {
          id: d.id,
          title: s.title,
          status: s.status,
          options: s.options,
          cards: s.cards,
          last_edited: new Date(d.updatedAt).toISOString().slice(0, 10),
          ...(s.review_due ? { review_due: true } : {}),
        };
      });
      const lines = rows.map(
        (r) =>
          `- ${JSON.stringify(r.title)} [${r.id}] · ${r.status} · ${r.options} option${r.options === 1 ? '' : 's'} · edited ${r.last_edited}${r.review_due ? ' · review due' : ''}`,
      );
      return text(rows.length ? `${rows.length} decision${rows.length === 1 ? '' : 's'}:\n${lines.join('\n')}` : 'No decisions yet.', {
        decisions: rows,
      });
    }),
  );

  server.registerTool(
    'get_decision',
    {
      title: 'Get a decision',
      description:
        'Read one decision as an outline (one line per card with its id, kind, title and badges such as impact 4/5, must-have, met, done, chosen, gut, Leading, Blocked) plus the verdict. structuredContent holds the same tree as JSON.',
      inputSchema: { decision_id: decisionId },
      annotations: ro,
    },
    guard(async ({ decision_id }) => {
      const doc = await load(await deps.store(), decision_id);
      const { outline, tree } = describeItems(doc.items, { timeZone: deps.timeZone, now: deps.now?.() });
      const root = doc.items.length ? rootOf(doc.items) : null;
      const verdict = root ? (tree.find((t) => t.id === root.id)?.verdict ?? '') : '';
      const head = `Decision ${JSON.stringify(titleOf(doc.items))} [${doc.id}] · ${doc.items.length} cards · edited ${new Date(doc.updatedAt).toISOString()}`;
      return text(`${head}\nVerdict: ${verdict || '—'}\n\n${outline || '(empty)'}`, {
        decision_id: doc.id,
        title: titleOf(doc.items),
        verdict,
        created_at: new Date(doc.createdAt).toISOString(),
        updated_at: new Date(doc.updatedAt).toISOString(),
        cards: tree,
      });
    }),
  );

  server.registerTool(
    'create_decision',
    {
      title: 'Create a decision',
      description:
        'Create a new decision. `cards` go under the new root decision card: usually options, each with nested requirement / pro / con / risk / action / note cards.',
      inputSchema: {
        title: z.string().min(1).max(LIMITS.title).describe('What is being decided, as a question'),
        notes: z.string().max(LIMITS.notes).optional().describe('Context for the decision'),
        cards: cards.optional(),
      },
      annotations: write(false, false),
    },
    guard(async ({ title, notes, cards: input }) => {
      const store = await deps.store();
      const items = createDecision(title, notes, (input ?? []) as CardInput[]);
      const now = deps.now?.() ?? Date.now();
      const doc = await store.create({ id: crypto.randomUUID(), items, createdAt: now, updatedAt: now });
      const res = after(deps, doc, items[0].id, `Created decision [${doc.id}] with ${items.length} card${items.length === 1 ? '' : 's'}.`);
      res.structuredContent = { ...res.structuredContent, root_card_id: items[0].id, card_ids: items.map((i) => i.id) };
      return res;
    }),
  );

  server.registerTool(
    'add_cards',
    {
      title: 'Add cards',
      description:
        'Add nested cards under an existing card. Each new card goes after the last sibling of the same kind, or right after `after_id` (a child of parent_id) when given. Returns the new ids.',
      inputSchema: {
        decision_id: decisionId,
        parent_id: id('Card to add under (e.g. the root decision card for options, an option for pros/cons)'),
        cards: cards.min(1),
        after_id: id('Optional: a child of parent_id to insert after').optional(),
      },
      annotations: write(false, false),
    },
    guard(async ({ decision_id, parent_id, cards: input, after_id }) => {
      const { doc, result } = await mutate(deps, decision_id, (items) => addCards(items, parent_id, input as CardInput[], after_id));
      const res = after(deps, doc, parent_id, `Added ${result.ids.length} card${result.ids.length === 1 ? '' : 's'}: ${result.ids.join(', ')}`);
      res.structuredContent = { ...res.structuredContent, card_ids: result.ids };
      return res;
    }),
  );

  server.registerTool(
    'update_card',
    {
      title: 'Update a card',
      description:
        'Change fields on one card. title, notes and collapsed work on every card; impact on pro/con/risk; met and must_have on requirements; done on actions; gut on options; rationale, review_on and outcome on decision cards, which are decisions and options with sub-options (review_on and outcome need a chosen option). Fields that don’t fit the card’s kind are rejected.',
      inputSchema: {
        decision_id: decisionId,
        card_id: id('Card to change'),
        fields: Fields,
      },
      annotations: write(false, true),
    },
    guard(async ({ decision_id, card_id, fields }) => {
      const { doc } = await mutate(deps, decision_id, (items) => ({
        items: updateCard(items, card_id, fields, { timeZone: deps.timeZone, now: deps.now?.() }),
      }));
      return after(deps, doc, card_id, `Updated ${card_id} (${Object.keys(fields).join(', ')}).`);
    }),
  );

  server.registerTool(
    'move_card',
    {
      title: 'Move a card',
      description:
        'Move a card and its whole branch under another card in the same decision (it lands last among its new siblings, or after `after_id`). Moving the chosen option out of its decision makes that decision undecided.',
      inputSchema: {
        decision_id: decisionId,
        card_id: id('Card to move'),
        new_parent_id: id('Card to move it under'),
        after_id: id('Optional: a child of new_parent_id to place it after').optional(),
      },
      annotations: write(false, false),
    },
    guard(async ({ decision_id, card_id, new_parent_id, after_id }) => {
      const { doc } = await mutate(deps, decision_id, (items) => ({ items: moveCard(items, card_id, new_parent_id, after_id) }));
      return after(deps, doc, new_parent_id, `Moved ${card_id} under ${new_parent_id}.`);
    }),
  );

  server.registerTool(
    'delete_card',
    {
      title: 'Delete a card',
      description: 'Delete a card and everything under it. The root decision card can’t be deleted here (whole decisions are deleted in the app).',
      inputSchema: { decision_id: decisionId, card_id: id('Card to delete, with its branch') },
      annotations: write(true, false),
    },
    guard(async ({ decision_id, card_id }) => {
      let parentId: string | null = null;
      const { doc, result } = await mutate(deps, decision_id, (items) => {
        parentId = items.find((i) => i.id === card_id)?.parentId ?? null;
        return deleteCard(items, card_id);
      });
      return after(deps, doc, parentId, `Deleted ${result.removed} card${result.removed === 1 ? '' : 's'}.`);
    }),
  );

  server.registerTool(
    'choose_option',
    {
      title: 'Choose an option',
      description:
        'Mark an option as the choice for its decision card: its parent, a decision or (for a sub-option) an option. One choice per decision card; this records the decision date there and clears its check-back date and outcome. Choosing a sub-option doesn’t choose its parent option. Pass option_id null to un-choose: that clears the root decision, or the decision card given as decision_card_id.',
      inputSchema: {
        decision_id: decisionId,
        option_id: id('Option (or sub-option) to choose').nullable(),
        decision_card_id: id(
          'Only needed with option_id null: which decision card to un-choose (a sub-decision, or an option with sub-options). Default: the root',
        ).optional(),
      },
      annotations: write(false, true),
    },
    guard(async ({ decision_id, option_id, decision_card_id }) => {
      let focus: string | null = null;
      const { doc, changed } = await mutate(deps, decision_id, (items) => {
        const next = chooseOption(items, option_id, decision_card_id, deps.now?.());
        focus = option_id ? (items.find((i) => i.id === option_id)?.parentId ?? null) : (decision_card_id ?? rootOf(items).id);
        return { items: next };
      });
      const head = option_id ? (changed ? `Chose ${option_id}.` : `${option_id} was already chosen.`) : changed ? 'Cleared the choice.' : 'Nothing was chosen.';
      return after(deps, doc, focus, head);
    }),
  );
}
