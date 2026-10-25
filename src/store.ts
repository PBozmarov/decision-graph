import { useCallback, useEffect, useRef, useState } from 'react';
import { applyMove, makeItem, sampleItems, type Item, type Kind } from './model';

const KEY = 'decision-graph:v1';
const HISTORY_LIMIT = 200;
const MERGE_MS = 1000;

function load(): Item[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* ignore */
  }
  return sampleItems();
}

type History = { past: Item[][]; present: Item[]; future: Item[][] };

export function useDoc() {
  const [h, setH] = useState<History>(() => ({ past: [], present: load(), future: [] }));
  // Consecutive edits to the same field of the same card merge into one undo step.
  const lastEdit = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(h.present));
    } catch {
      /* ignore */
    }
  }, [h.present]);

  const commit = useCallback((fn: (prev: Item[]) => Item[], mergeKey?: string) => {
    const now = Date.now();
    const merge =
      !!mergeKey &&
      lastEdit.current?.key === mergeKey &&
      now - lastEdit.current.at < MERGE_MS;
    lastEdit.current = mergeKey ? { key: mergeKey, at: now } : null;
    setH((s) => {
      const next = fn(s.present);
      if (next === s.present) return s;
      return {
        past: merge ? s.past : [...s.past, s.present].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    lastEdit.current = null;
    setH((s) =>
      s.past.length
        ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] }
        : s,
    );
  }, []);

  const redo = useCallback(() => {
    lastEdit.current = null;
    setH((s) =>
      s.future.length
        ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) }
        : s,
    );
  }, []);

  const add = useCallback(
    (parentId: string | null, kind: Kind, title = '') => {
      const it = makeItem(parentId, kind, title);
      commit((prev) => [
        ...prev.map((p) => (p.id === parentId && p.collapsed ? { ...p, collapsed: false } : p)),
        it,
      ]);
      return it.id;
    },
    [commit],
  );

  const update = useCallback(
    (id: string, patch: Partial<Item>) => {
      const textOnly = Object.keys(patch).every((k) => k === 'title' || k === 'notes');
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
              : p,
        );
      });
    },
    [commit],
  );

  const reset = useCallback(() => commit(() => sampleItems()), [commit]);
  const clear = useCallback(() => commit(() => []), [commit]);

  return { items: h.present, add, update, remove, move, choose, reset, clear, undo, redo };
}
