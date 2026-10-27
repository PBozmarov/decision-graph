import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyMove, canMoveTo, makeItem, type Item, type Kind } from './model';
import { removeCloudDoc, saveCloudDoc, watchDocs } from './cloud';

const LIB_KEY = 'decision-graph:library:v1';
const OLD_KEY = 'decision-graph:v1'; // single-graph storage from the first prototype
const HISTORY_LIMIT = 200;
const MERGE_MS = 1000;
const SAVE_DELAY_MS = 700; // cloud: save a decision this long after the last edit

export type SyncStatus = 'local' | 'loading' | 'saving' | 'saved' | 'offline' | 'error';

export type Doc = { id: string; items: Item[]; createdAt: number; updatedAt: number };
type Library = { docs: Doc[]; activeId: string };

const makeDoc = (items: Item[] = []): Doc => {
  const now = Date.now();
  return { id: crypto.randomUUID(), items, createdAt: now, updatedAt: now };
};

function loadLibrary(): Library {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (raw) {
      const lib = JSON.parse(raw) as Library;
      if (Array.isArray(lib.docs) && lib.docs.length) {
        const activeId = lib.docs.some((d) => d.id === lib.activeId) ? lib.activeId : lib.docs[0].id;
        return { docs: lib.docs, activeId };
      }
    }
  } catch {
    /* ignore */
  }
  // First run on the library format: bring over the old single graph if there is one.
  let items: Item[] | null = null;
  try {
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const parsed = JSON.parse(old);
      if (Array.isArray(parsed)) items = parsed;
    }
  } catch {
    /* ignore */
  }
  // Brand-new visitors start with an empty decision and pick a template.
  const doc = makeDoc(items ?? []);
  return { docs: [doc], activeId: doc.id };
}

type State = { lib: Library; past: Item[][]; future: Item[][]; ready: boolean };

/**
 * The decision library. Signed out (`uid` null) it lives in this browser's localStorage.
 * Signed in, it mirrors the account's decisions in Firestore: local edits are saved shortly
 * after they happen, and changes from other devices stream in.
 */
export function useDoc(uid: string | null) {
  const [s, setS] = useState<State>(() => ({ lib: loadLibrary(), past: [], future: [], ready: true }));
  // Consecutive edits to the same field of the same card merge into one undo step.
  const lastEdit = useRef<{ key: string; at: number } | null>(null);

  // Guest mode: persist in this browser.
  useEffect(() => {
    if (uid) return;
    try {
      localStorage.setItem(LIB_KEY, JSON.stringify(s.lib));
    } catch {
      /* ignore */
    }
  }, [s.lib, uid]);

  /* ---------- cloud sync ---------- */

  // Last version of each decision known to match the cloud (by object identity).
  const synced = useRef(new Map<string, Doc>());
  const timers = useRef(new Map<string, number>());
  const libRef = useRef(s.lib);
  libRef.current = s.lib;
  const [pending, setPending] = useState(0);
  const [syncError, setSyncError] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const write = useCallback((user: string, d: Doc) => {
    synced.current.set(d.id, d);
    setPending((n) => n + 1);
    return saveCloudDoc(user, d)
      .then(() => setSyncError(false))
      .catch((e) => {
        console.error('Saving failed', e);
        setSyncError(true);
      })
      .finally(() => setPending((n) => n - 1));
  }, []);

  /** Save everything that hasn't reached the cloud yet (e.g. right before signing out). */
  const flush = useCallback(async () => {
    if (!uid) return;
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    const dirty = libRef.current.docs.filter((d) => synced.current.get(d.id) !== d);
    await Promise.all(dirty.map((d) => write(uid, d)));
  }, [uid, write]);

  // Switch data source whenever the account changes.
  useEffect(() => {
    lastEdit.current = null;
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    synced.current = new Map();
    setSyncError(false);
    if (!uid) {
      setS({ lib: loadLibrary(), past: [], future: [], ready: true });
      return;
    }
    const placeholder = makeDoc();
    setS({ lib: { docs: [placeholder], activeId: placeholder.id }, past: [], future: [], ready: false });

    const unsub = watchDocs(
      uid,
      (changes, first) => {
        for (const c of changes) {
          if (c.type === 'upsert') synced.current.set(c.doc.id, c.doc);
          else synced.current.delete(c.id);
        }
        // First sign-in on this device: copy the decisions made here as a guest into the account.
        let guest: Doc[] = [];
        let savedActive: string | null = null;
        if (first) {
          const flag = `dg-merged-${uid}`;
          try {
            if (!localStorage.getItem(flag)) {
              guest = loadLibrary().docs.filter((d) => d.items.length);
              localStorage.setItem(flag, '1');
            }
            savedActive = localStorage.getItem(`dg-active-${uid}`);
          } catch {
            /* ignore */
          }
        }
        const fresh = makeDoc();

        setS((st) => {
          let docs = first ? [] : st.lib.docs;
          for (const c of changes) {
            if (c.type === 'remove') {
              docs = docs.filter((d) => d.id !== c.id);
              continue;
            }
            const i = docs.findIndex((d) => d.id === c.doc.id);
            if (i < 0) docs = [...docs, c.doc];
            else if (c.doc.updatedAt > docs[i].updatedAt) docs = docs.map((d, j) => (j === i ? c.doc : d));
          }
          if (first) {
            docs = [...guest.filter((g) => !docs.some((d) => d.id === g.id)), ...docs];
          }
          if (!docs.length) docs = [fresh];

          let activeId = st.lib.activeId;
          if (first) {
            activeId =
              savedActive && docs.some((d) => d.id === savedActive)
                ? savedActive
                : [...docs].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
          } else if (!docs.some((d) => d.id === activeId)) {
            activeId = docs[0].id;
          }
          // Another device changed the open decision: its local undo history no longer applies.
          const replacedActive =
            !first && changes.some((c) => c.type === 'upsert' && c.doc.id === activeId && docs.includes(c.doc));
          const keepHistory = !first && !replacedActive;
          return {
            lib: { docs, activeId },
            past: keepHistory ? st.past : [],
            future: keepHistory ? st.future : [],
            ready: true,
          };
        });
      },
      (e) => {
        console.error('Sync failed', e);
        setSyncError(true);
        setS((st) => ({ ...st, ready: true }));
      },
    );
    return unsub;
  }, [uid]);

  // Push local changes: each changed decision is saved a moment after its last edit.
  useEffect(() => {
    if (!uid || !s.ready) return;
    for (const d of s.lib.docs) {
      if (synced.current.get(d.id) === d) continue;
      const t = timers.current.get(d.id);
      if (t) clearTimeout(t);
      timers.current.set(
        d.id,
        window.setTimeout(() => {
          timers.current.delete(d.id);
          const latest = libRef.current.docs.find((x) => x.id === d.id);
          if (latest && synced.current.get(d.id) !== latest) write(uid, latest);
        }, SAVE_DELAY_MS),
      );
    }
    for (const id of [...synced.current.keys()]) {
      if (s.lib.docs.some((d) => d.id === id)) continue;
      synced.current.delete(id);
      setPending((n) => n + 1);
      removeCloudDoc(uid, id)
        .catch(() => setSyncError(true))
        .finally(() => setPending((n) => n - 1));
    }
  }, [s.lib, s.ready, uid, write]);

  // Remember the open decision per account.
  useEffect(() => {
    if (!uid || !s.ready) return;
    try {
      localStorage.setItem(`dg-active-${uid}`, s.lib.activeId);
    } catch {
      /* ignore */
    }
  }, [uid, s.ready, s.lib.activeId]);

  // Best effort: don't lose the last edit when the tab closes.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [flush]);

  const dirty = !!uid && s.ready && s.lib.docs.some((d) => synced.current.get(d.id) !== d);
  const syncStatus: SyncStatus = !uid
    ? 'local'
    : !s.ready
      ? 'loading'
      : syncError
        ? 'error'
        : !online
          ? 'offline'
          : pending > 0 || dirty
            ? 'saving'
            : 'saved';

  const active = useMemo(
    () => s.lib.docs.find((d) => d.id === s.lib.activeId) ?? s.lib.docs[0],
    [s.lib],
  );

  const withItems = (lib: Library, items: Item[]): Library => ({
    ...lib,
    docs: lib.docs.map((d) => (d.id === lib.activeId ? { ...d, items, updatedAt: Date.now() } : d)),
  });
  const currentItems = (lib: Library) => (lib.docs.find((d) => d.id === lib.activeId) ?? lib.docs[0]).items;

  const commit = useCallback((fn: (prev: Item[]) => Item[], mergeKey?: string) => {
    const now = Date.now();
    const merge =
      !!mergeKey && lastEdit.current?.key === mergeKey && now - lastEdit.current.at < MERGE_MS;
    lastEdit.current = mergeKey ? { key: mergeKey, at: now } : null;
    setS((st) => {
      const prev = currentItems(st.lib);
      const next = fn(prev);
      if (next === prev) return st;
      return {
        ...st,
        lib: withItems(st.lib, next),
        past: merge ? st.past : [...st.past, prev].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    lastEdit.current = null;
    setS((st) => {
      if (!st.past.length) return st;
      const prev = currentItems(st.lib);
      return {
        ...st,
        lib: withItems(st.lib, st.past[st.past.length - 1]),
        past: st.past.slice(0, -1),
        future: [prev, ...st.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    lastEdit.current = null;
    setS((st) => {
      if (!st.future.length) return st;
      const prev = currentItems(st.lib);
      return { ...st, lib: withItems(st.lib, st.future[0]), past: [...st.past, prev], future: st.future.slice(1) };
    });
  }, []);

  /* ---------- library ---------- */

  const switchDoc = useCallback((id: string) => {
    lastEdit.current = null;
    setS((st) => (st.lib.activeId === id ? st : { ...st, lib: { ...st.lib, activeId: id }, past: [], future: [] }));
  }, []);

  const newDoc = useCallback((items: Item[] = []) => {
    lastEdit.current = null;
    const doc = makeDoc(items);
    setS((st) => ({ ...st, lib: { docs: [doc, ...st.lib.docs], activeId: doc.id }, past: [], future: [] }));
    return doc.id;
  }, []);

  /** Add restored decisions (as new copies, never overwriting) and open the most recent one. */
  const importDocs = useCallback((list: Pick<Doc, 'items' | 'createdAt' | 'updatedAt'>[]) => {
    if (!list.length) return;
    lastEdit.current = null;
    const added = list.map((d) => ({ ...d, id: crypto.randomUUID() }));
    const open = [...added].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    setS((st) => {
      // Drop an untouched empty decision so it doesn't linger at the top of the list.
      const rest = st.lib.docs.filter((d) => d.items.length || d.id !== st.lib.activeId);
      return { ...st, lib: { docs: [...added, ...rest], activeId: open.id }, past: [], future: [] };
    });
  }, []);

  const deleteDoc = useCallback((id: string) => {
    lastEdit.current = null;
    setS((st) => {
      let docs = st.lib.docs.filter((d) => d.id !== id);
      if (!docs.length) docs = [makeDoc()];
      const activeId = st.lib.activeId === id ? docs[0].id : st.lib.activeId;
      const changed = activeId !== st.lib.activeId;
      return { ...st, lib: { docs, activeId }, past: changed ? [] : st.past, future: changed ? [] : st.future };
    });
  }, []);

  /* ---------- items ---------- */

  const add = useCallback(
    (parentId: string | null, kind: Kind, title = '', afterId?: string) => {
      const it = makeItem(parentId, kind, title);
      commit((prev) => {
        const next = prev.map((p) => (p.id === parentId && p.collapsed ? { ...p, collapsed: false } : p));
        const at = afterId ? next.findIndex((p) => p.id === afterId) : -1;
        return at >= 0 ? [...next.slice(0, at + 1), it, ...next.slice(at + 1)] : [...next, it];
      });
      return it.id;
    },
    [commit],
  );

  const update = useCallback(
    (id: string, patch: Partial<Item>) => {
      const textOnly = Object.keys(patch).every((k) => k === 'title' || k === 'notes' || k === 'rationale');
      commit(
        (prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        textOnly ? `${id}:${Object.keys(patch).join(',')}` : undefined,
      );
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      commit((prev) => {
        const doomed = new Set([id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const p of prev)
            if (p.parentId && doomed.has(p.parentId) && !doomed.has(p.id)) {
              doomed.add(p.id);
              grew = true;
            }
        }
        return prev.filter((p) => !doomed.has(p.id));
      });
    },
    [commit],
  );

  const move = useCallback(
    (id: string, index: number) => commit((prev) => applyMove(prev, id, index)),
    [commit],
  );

  const choose = useCallback(
    (id: string) => {
      commit((prev) => {
        const target = prev.find((p) => p.id === id);
        if (!target) return prev;
        const next = !target.chosen;
        return prev.map((p) =>
          p.id === id
            ? { ...p, chosen: next }
            : p.parentId === target.parentId && p.kind === 'option'
              ? { ...p, chosen: false }
              : p.id === target.parentId
                ? // An outcome (and its check-back date) belongs to one specific choice.
                  { ...p, decidedAt: next ? Date.now() : undefined, reviewAt: undefined, outcome: undefined }
                : p,
        );
      });
    },
    [commit],
  );

  /** Move a card (and its branch) under another parent; it lands last among its new siblings. */
  const reparent = useCallback(
    (id: string, parentId: string) => {
      commit((prev) => {
        if (!canMoveTo(prev, id, parentId)) return prev;
        const it = prev.find((p) => p.id === id)!;
        // A chosen option leaving its decision: that decision is undecided again.
        const unchoose = it.kind === 'option' && it.chosen;
        const rest = prev
          .filter((p) => p.id !== id)
          .map((p) =>
            p.id === parentId && p.collapsed
              ? { ...p, collapsed: false }
              : unchoose && p.id === it.parentId
                ? { ...p, decidedAt: undefined, reviewAt: undefined, outcome: undefined }
                : p,
          );
        return [...rest, { ...it, parentId, ...(unchoose ? { chosen: false } : {}) }];
      });
    },
    [commit],
  );

  /** Copy a card and its whole branch right below the original; returns the copy's id (root decisions: null). */
  const duplicate = useCallback(
    (id: string): string | null => {
      const src = currentItems(libRef.current).find((p) => p.id === id);
      if (!src || src.parentId === null) return null;
      // Ids are fixed up front so the updater stays pure (it may run twice).
      const ids = new Map([[id, crypto.randomUUID()]]);
      const newId = (old: string) => {
        if (!ids.has(old)) ids.set(old, crypto.randomUUID());
        return ids.get(old)!;
      };
      commit((prev) => {
        const at = prev.findIndex((p) => p.id === id);
        if (at < 0) return prev;
        const branch = new Set([id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const p of prev)
            if (p.parentId && branch.has(p.parentId) && !branch.has(p.id)) {
              branch.add(p.id);
              grew = true;
            }
        }
        const copies = prev
          .filter((p) => branch.has(p.id))
          .sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : 0))
          .map((p) =>
            p.id === id
              ? { ...p, id: newId(p.id), title: p.title ? `${p.title} copy` : '', chosen: false }
              : { ...p, id: newId(p.id), parentId: newId(p.parentId!) },
          );
        return [...prev.slice(0, at + 1), ...copies, ...prev.slice(at + 1)];
      });
      return ids.get(id)!;
    },
    [commit],
  );

  /** Expand every collapsed ancestor of `id` in one undo step; nothing is committed when none is collapsed. */
  const expandTo = useCallback(
    (id: string) => {
      const items = currentItems(libRef.current);
      const byId = new Map(items.map((i) => [i.id, i]));
      const closed = new Set<string>();
      for (let p = byId.get(id)?.parentId ?? null; p; p = byId.get(p)?.parentId ?? null)
        if (byId.get(p)?.collapsed) closed.add(p);
      if (!closed.size) return;
      commit((prev) => prev.map((p) => (closed.has(p.id) ? { ...p, collapsed: false } : p)));
    },
    [commit],
  );

  /** Fill the current decision (e.g. from a template); undoable. */
  const replaceItems = useCallback((next: Item[]) => commit(() => next), [commit]);

  return {
    items: active.items,
    ready: s.ready,
    syncStatus,
    flush,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
    docs: s.lib.docs,
    activeId: active.id,
    switchDoc,
    newDoc,
    importDocs,
    deleteDoc,
    replaceItems,
    add,
    update,
    remove,
    move,
    reparent,
    duplicate,
    expandTo,
    choose,
    undo,
    redo,
  };
}
