// Firestore REST, as the signed-in owner, so the app's firestore.rules keep protecting everything.
import type { Item } from '../../src/model.ts';

/* ---------- value converters ---------- */

export type FsValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number | string }
  | { stringValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } }
  | Record<string, unknown>; // timestampValue, bytesValue, … (kept as they are)

/** A Firestore value type we don't map to JSON (timestamp, bytes, reference, geo point). Written back unchanged. */
export class RawValue {
  readonly value: Record<string, unknown>;
  constructor(value: Record<string, unknown>) {
    this.value = value;
  }
  toJSON() {
    return this.value;
  }
}

export function toFs(v: unknown): FsValue {
  if (v === null) return { nullValue: null };
  if (v instanceof RawValue) return v.value;
  switch (typeof v) {
    case 'boolean':
      return { booleanValue: v };
    case 'string':
      return { stringValue: v };
    case 'number':
      // Same split as the Firebase JS SDK: safe integers (not -0) are integers, the rest doubles.
      if (Number.isSafeInteger(v) && !Object.is(v, -0)) return { integerValue: String(v) };
      if (Number.isNaN(v)) return { doubleValue: 'NaN' };
      if (v === Infinity) return { doubleValue: 'Infinity' };
      if (v === -Infinity) return { doubleValue: '-Infinity' };
      return { doubleValue: v };
    case 'object':
      if (Array.isArray(v)) return { arrayValue: { values: v.filter((x) => x !== undefined).map(toFs) } };
      return { mapValue: { fields: toFsFields(v as Record<string, unknown>) } };
    default:
      throw new TypeError(`Can't store a ${typeof v} in Firestore`);
  }
}

/** Object → Firestore `fields`; `undefined` fields are dropped (the app uses ignoreUndefinedProperties). */
export function toFsFields(o: Record<string, unknown>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = toFs(v);
  return out;
}

export function fromFs(v: FsValue): unknown {
  const x = v as Record<string, unknown>;
  if ('nullValue' in x) return null;
  if ('booleanValue' in x) return x.booleanValue as boolean;
  if ('stringValue' in x) return x.stringValue as string;
  if ('integerValue' in x) return Number(x.integerValue);
  if ('doubleValue' in x) return Number(x.doubleValue); // "NaN" / "Infinity" arrive as strings
  if ('arrayValue' in x) return ((x.arrayValue as { values?: FsValue[] }).values ?? []).map(fromFs);
  if ('mapValue' in x) return fromFsFields((x.mapValue as { fields?: Record<string, FsValue> }).fields ?? {});
  return new RawValue(x);
}

export function fromFsFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromFs(v);
  return out;
}

/* ---------- documents ---------- */

/** A decision as stored: `users/{uid}/docs/{id}` = { items, createdAt, updatedAt }. */
export type StoredDoc = {
  id: string;
  items: Item[];
  createdAt: number;
  updatedAt: number;
  /** Other top-level fields, kept as they are. */
  extra: Record<string, unknown>;
  /** Firestore updateTime, used as the write precondition. */
  version: string;
};

export type NewDoc = Omit<StoredDoc, 'version' | 'extra'> & { extra?: Record<string, unknown> };

/** Someone else changed the decision between our read and our write. */
export class ConflictError extends Error {}
export class NotFoundError extends Error {}

/** What the tools need from storage (Firestore in production, a Map in tests). */
export interface DocStore {
  list(): Promise<StoredDoc[]>;
  get(id: string): Promise<StoredDoc | null>;
  create(doc: NewDoc): Promise<StoredDoc>;
  /** Replace the document, only if it is still at `version`. Throws ConflictError otherwise. */
  update(doc: NewDoc, version: string): Promise<StoredDoc>;
}

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
export function checkDocId(id: string) {
  if (!ID_RE.test(id)) throw new NotFoundError(`"${id}" is not a valid decision id. Call list_decisions to see the ids.`);
}

type RestDoc = { name: string; fields?: Record<string, FsValue>; createTime: string; updateTime: string };

function parseDoc(d: RestDoc): StoredDoc {
  const data = fromFsFields(d.fields ?? {});
  const { items, createdAt, updatedAt, ...extra } = data;
  return {
    id: d.name.slice(d.name.lastIndexOf('/') + 1),
    items: Array.isArray(items) ? (items as Item[]) : [],
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    updatedAt: typeof updatedAt === 'number' ? updatedAt : 0,
    extra,
    version: d.updateTime,
  };
}

const body = (d: NewDoc) => ({
  fields: toFsFields({ ...(d.extra ?? {}), items: d.items, createdAt: d.createdAt, updatedAt: d.updatedAt }),
});

/**
 * Firestore REST client for one collection, e.g. `users/{uid}/docs`.
 * `getToken` returns a Bearer token: a Firebase ID token in production (rules apply).
 */
export class FirestoreStore implements DocStore {
  private readonly base: string;
  private readonly collectionPath: string;
  private readonly getToken: () => Promise<string>;
  private readonly fetcher: typeof fetch;
  constructor(projectId: string, collectionPath: string, getToken: () => Promise<string>, fetcher: typeof fetch = (...a) => fetch(...a)) {
    this.base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
    this.collectionPath = collectionPath;
    this.getToken = getToken;
    this.fetcher = fetcher;
  }

  private async call(method: string, path: string, query: Record<string, string> = {}, json?: unknown): Promise<Response> {
    const url = new URL(`${this.base}/${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await this.fetcher(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${await this.getToken()}`,
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    return res;
  }

  private async fail(res: Response, what: string): Promise<never> {
    let status = '';
    let message = '';
    try {
      const j = (await res.json()) as { error?: { status?: string; message?: string } };
      status = j.error?.status ?? '';
      message = j.error?.message ?? '';
    } catch {
      /* not JSON */
    }
    if (res.status === 404 || status === 'NOT_FOUND') throw new NotFoundError(`${what}: not found.`);
    if (status === 'FAILED_PRECONDITION' || status === 'ABORTED' || status === 'ALREADY_EXISTS' || res.status === 409) {
      throw new ConflictError(`${what}: ${status || res.status}`);
    }
    if (res.status === 401 || res.status === 403) throw new Error(`${what}: Firestore refused access (${res.status} ${status}).`);
    throw new Error(`${what}: Firestore error ${res.status} ${status} ${message}`.trim());
  }

  async list(): Promise<StoredDoc[]> {
    const out: StoredDoc[] = [];
    let pageToken = '';
    for (let page = 0; page < 50; page++) {
      const q: Record<string, string> = { pageSize: '300' };
      if (pageToken) q.pageToken = pageToken;
      const res = await this.call('GET', this.collectionPath, q);
      if (!res.ok) return this.fail(res, 'Listing decisions');
      const j = (await res.json()) as { documents?: RestDoc[]; nextPageToken?: string };
      out.push(...(j.documents ?? []).map(parseDoc));
      if (!j.nextPageToken) break;
      pageToken = j.nextPageToken;
    }
    return out;
  }

  async get(id: string): Promise<StoredDoc | null> {
    checkDocId(id);
    const res = await this.call('GET', `${this.collectionPath}/${id}`);
    if (res.status === 404) return null;
    if (!res.ok) return this.fail(res, `Reading decision ${id}`);
    return parseDoc((await res.json()) as RestDoc);
  }

  async create(doc: NewDoc): Promise<StoredDoc> {
    checkDocId(doc.id);
    const res = await this.call('POST', this.collectionPath, { documentId: doc.id }, body(doc));
    if (!res.ok) return this.fail(res, 'Creating the decision');
    return parseDoc((await res.json()) as RestDoc);
  }

  async update(doc: NewDoc, version: string): Promise<StoredDoc> {
    checkDocId(doc.id);
    // No updateMask: the whole document is replaced (like the app's setDoc), only if unchanged since our read.
    const res = await this.call('PATCH', `${this.collectionPath}/${doc.id}`, { 'currentDocument.updateTime': version }, body(doc));
    if (!res.ok) return this.fail(res, `Saving decision ${doc.id}`);
    return parseDoc((await res.json()) as RestDoc);
  }

  /** Not exposed as a tool (whole decisions are deleted in the app); used by the self-test. */
  async delete(id: string): Promise<void> {
    checkDocId(id);
    const res = await this.call('DELETE', `${this.collectionPath}/${id}`);
    if (!res.ok) return this.fail(res, `Deleting ${id}`);
  }
}

/* ---------- ID tokens from the owner's refresh token ---------- */

export class RefreshRevokedError extends Error {}

export type MintedToken = { idToken: string; refreshToken: string; uid: string; expiresAt: number };

/**
 * Exchange a Firebase refresh token for a fresh ID token (Secure Token API).
 * `Referer` is sent in case the browser API key is restricted to the app's site.
 */
export async function mintIdToken(
  refreshToken: string,
  opts: { apiKey: string; referer: string; fetcher?: typeof fetch },
): Promise<MintedToken> {
  const fetcher = opts.fetcher ?? ((...a) => fetch(...a));
  const res = await fetcher(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(opts.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: opts.referer },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  });
  if (!res.ok) {
    let code = '';
    try {
      code = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      /* ignore */
    }
    // These mean the session is gone for good (signed out everywhere, account disabled or deleted).
    if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND|INVALID_GRANT_TYPE|MISSING_REFRESH_TOKEN/.test(code)) {
      throw new RefreshRevokedError(`Firebase session ended (${code}). Reconnect Decision Graph in Claude.`);
    }
    throw new Error(`Couldn't get a Firebase ID token (${res.status}${code ? ' ' + code : ''}).`);
  }
  const j = (await res.json()) as { id_token: string; refresh_token: string; expires_in: string; user_id: string };
  return {
    idToken: j.id_token,
    refreshToken: j.refresh_token,
    uid: j.user_id,
    expiresAt: Date.now() + Number(j.expires_in) * 1000,
  };
}

/** Keeps one ID token in memory and renews it 5 minutes before it expires. */
export class IdTokenCache {
  private cached: MintedToken | null = null;
  private pending: Promise<MintedToken> | null = null;
  private readonly refreshToken: () => string;
  private readonly opts: { apiKey: string; referer: string; ownerUid: string; fetcher?: typeof fetch };
  constructor(refreshToken: () => string, opts: { apiKey: string; referer: string; ownerUid: string; fetcher?: typeof fetch }) {
    this.refreshToken = refreshToken;
    this.opts = opts;
  }

  async get(): Promise<string> {
    if (this.cached && this.cached.expiresAt - 5 * 60_000 > Date.now()) return this.cached.idToken;
    this.pending ??= mintIdToken(this.refreshToken(), this.opts).finally(() => (this.pending = null));
    const t = await this.pending;
    if (t.uid !== this.opts.ownerUid) throw new Error('This server is private.');
    this.cached = t;
    return t.idToken;
  }
}
