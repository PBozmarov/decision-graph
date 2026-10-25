import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyMove, makeItem, sampleItems, type Item, type Kind } from './model';

const LIB_KEY = 'decision-graph:library:v1';
const OLD_KEY = 'decision-graph:v1'; // single-graph storage from the first prototype
const HISTORY_LIMIT = 200;
const MERGE_MS = 1000;

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
  const doc = makeDoc(items ?? sampleItems());
  return { docs: [doc], activeId: doc.id };
}

type State = { lib: Library; past: Item[][]; future: Item[][] };

export function useDoc() {
  const [s, setS] = useState<State>(() => ({ lib: loadLibrary(), past: [], future: [] }));
  // Consecutive edits to the same field of the same card merge into one undo step.
  const lastEdit = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(LIB_KEY, JSON.stringify(s.lib));
    } catch {
      /* ignore */
    }
  }, [s.lib]);

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
      return { lib: withItems(st.lib, st.future[0]), past: [...st.past, prev], future: st.future.slice(1) };
    });
  }, []);

  /* ---------- library ---------- */

  const switchDoc = useCallback((id: string) => {
    lastEdit.current = null;
    setS((st) => (st.lib.activeId === id ? st : { lib: { ...st.lib, activeId: id }, past: [], future: [] }));
  }, []);

  const newDoc = useCallback((items: Item[] = []) => {
    lastEdit.current = null;
    const doc = makeDoc(items);
    setS((st) => ({ lib: { docs: [doc, ...st.lib.docs], activeId: doc.id }, past: [], future: [] }));
    return doc.id;
  }, []);

  const deleteDoc = useCallback((id: string) => {
    lastEdit.current = null;
    setS((st) => {
      let docs = st.lib.docs.filter((d) => d.id !== id);
      if (!docs.length) docs = [makeDoc()];
      const activeId = st.lib.activeId === id ? docs[0].id : st.lib.activeId;
      const changed = activeId !== st.lib.activeId;
      return { lib: { docs, activeId }, past: changed ? [] : st.past, future: changed ? [] : st.future };
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
                ? { ...p, decidedAt: next ? Date.now() : undefined }
                : p,
        );
      });
    },
    [commit],
  );

  const openExample = useCallback(() => newDoc(sampleItems()), [newDoc]);

  return {
    items: active.items,
    docs: s.lib.docs,
    activeId: active.id,
    switchDoc,
    newDoc,
    deleteDoc,
    openExample,
    add,
    update,
    remove,
    move,
    choose,
    undo,
    redo,
  };
}
