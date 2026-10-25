import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type FitViewOptions,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { DecisionNode, type DNode } from './DecisionNode';
import { Inspector } from './Inspector';
import { Sidebar } from './Sidebar';
import { Compare } from './Compare';
import { docTitle, downloadBlob, graphToPng, slug, toMarkdown } from './export';
import { ActionsContext, type Actions } from './actions';
import {
  KINDS,
  PILL_KINDS,
  SIZE,
  applyMove,
  groupChildren,
  layout,
  optionStats,
  type Item,
  type Kind,
  type Size,
  type Stats,
} from './model';
import { compactOptionHeight } from './compact';
import { useDoc } from './store';
import {
  IconCompact,
  IconCopy,
  IconDoc,
  IconExpand,
  IconImage,
  IconShare,
  IconFit,
  IconFocus,
  IconMinus,
  IconMoon,
  IconPlus,
  IconSidebar,
  IconSun,
  KindIcon,
} from './icons';

const nodeTypes = { decision: DecisionNode };
const FIT = { minZoom: 0.5, maxZoom: 1 };

/** Fit padding that keeps cards clear of the floating panels. */
type Pad = NonNullable<FitViewOptions['padding']>;
function fitPadding(sidebarOpen: boolean, inspectorOpen: boolean): Pad {
  if (window.innerWidth <= 760) return { top: '76px', bottom: '64px', x: '16px' };
  return {
    top: '84px',
    bottom: '72px',
    left: sidebarOpen ? '304px' : '40px',
    right: inspectorOpen ? '388px' : '40px',
  };
}

function usePref<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T) || initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [v, set];
}

function useTheme() {
  const [theme, setTheme] = usePref<'light' | 'dark'>(
    'dg-theme',
    (document.documentElement.dataset.theme as 'light' | 'dark') ?? 'light',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}

function ZoomPill({ padding }: { padding: () => Pad }) {
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div className="pill glass zoom-pill">
      <button className="icon-btn" onClick={() => rf.zoomOut({ duration: 250 })} aria-label="Zoom out">
        <IconMinus size={15} />
      </button>
      <button className="zoom-val" onClick={() => rf.zoomTo(1, { duration: 300 })} title="Reset to 100%">
        {Math.round(zoom * 100)}%
      </button>
      <button className="icon-btn" onClick={() => rf.zoomIn({ duration: 250 })} aria-label="Zoom in">
        <IconPlus size={15} />
      </button>
      <span className="pill-sep" />
      <button
        className="icon-btn"
        onClick={() => rf.fitView({ duration: 500, padding: padding(), maxZoom: 1 })}
        aria-label="Fit to screen"
        title="Fit to screen"
      >
        <IconFit size={15} />
      </button>
    </div>
  );
}

function EmptyState({ onStart }: { onStart: (title: string) => void }) {
  const [v, setV] = useState('');
  return (
    <div className="empty">
      <form
        className="empty-card glass"
        onSubmit={(e) => {
          e.preventDefault();
          onStart(v.trim());
        }}
      >
        <span className="logo logo-lg">
          <KindIcon kind="option" size={26} />
        </span>
        <h1>What are you deciding?</h1>
        <p>Start with the question. Branch out into options, then weigh what each one needs, gives and risks.</p>
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="e.g. Should we migrate to Kubernetes?"
        />
        <button className="btn-primary" type="submit">
          Start
        </button>
      </form>
    </div>
  );
}

const Kbd = ({ children }: { children: string }) => (
  <kbd className={children.length > 1 ? 'kbd-wide' : undefined}>{children}</kbd>
);

function Canvas() {
  const doc = useDoc();
  const { items, add, update, remove, move, choose, undo, redo } = doc;
  const { theme, toggle } = useTheme();
  const [view, setView] = usePref<'compact' | 'expanded'>('dg-view', 'compact');
  const [sidebar, setSidebar] = usePref<'open' | 'closed'>(
    'dg-sidebar',
    window.innerWidth > 760 ? 'open' : 'closed',
  );
  const compact = view === 'compact';
  const rf = useReactFlow();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Ask the inspector to focus its title; `n` changes on every request so repeats still fire.
  const [fresh, setFresh] = useState<{ id: string; n: number } | null>(null);
  const setFreshId = useCallback(
    (id: string | null) => setFresh((f) => (id ? { id, n: (f?.n ?? 0) + 1 } : null)),
    [],
  );
  const [revealId, setRevealId] = useState<string | null>(null); // pan this card into view
  const [editing, setEditing] = useState<{ id: string; selectAll: boolean } | null>(null);
  const [menu, setMenu] = useState<{ id: string; index: number } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setFresh(null);
    setMenu((m) => (m && m.id === id ? m : null));
    setEditing((e) => (e && e.id === id ? e : null));
  }, []);

  // Drag-to-reorder: while dragging, siblings make room live; the drop commits the move.
  const [drag, setDrag] = useState<{ id: string; y: number; index: number } | null>(null);
  const shown = useMemo(
    () => (drag ? applyMove(items, drag.id, drag.index) : items),
    [items, drag?.id, drag?.index],
  );

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const allKids = useMemo(() => groupChildren(items), [items]);
  const kids = useMemo(() => groupChildren(shown), [shown]);

  // Compact view: an option's requirements/pros/cons/risks/actions become pills in its card.
  const hidden = useMemo(() => {
    const h = new Set<string>();
    if (!compact) return h;
    for (const it of items)
      if (it.parentId && byId.get(it.parentId)?.kind === 'option' && PILL_KINDS.has(it.kind)) h.add(it.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const it of items)
        if (it.parentId && h.has(it.parentId) && !h.has(it.id)) {
          h.add(it.id);
          grew = true;
        }
    }
    return h;
  }, [items, byId, compact]);

  const pillsOf = useCallback(
    (id: string, from = allKids) =>
      (from.get(id) ?? []).filter((k) => hidden.has(k.id) && PILL_KINDS.has(k.kind)),
    [allKids, hidden],
  );

  const sizes = useMemo(() => {
    const m = new Map<string, Size>();
    for (const it of items)
      m.set(
        it.id,
        compact && it.kind === 'option'
          ? { w: SIZE.option.w, h: compactOptionHeight(pillsOf(it.id)) }
          : SIZE[it.kind],
      );
    return m;
  }, [items, compact, pillsOf]);
  const sizeOf = useCallback((it: Item) => sizes.get(it.id) ?? SIZE[it.kind], [sizes]);

  const positions = useMemo(() => layout(shown, { size: sizeOf, hidden }), [shown, sizeOf, hidden]);
  // Layout without the dragged branch: a stable reference for picking the drop slot.
  const restPositions = useMemo(() => {
    if (!drag) return null;
    const gone = new Set([drag.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const it of items)
        if (it.parentId && gone.has(it.parentId) && !gone.has(it.id)) {
          gone.add(it.id);
          grew = true;
        }
    }
    return layout(
      items.filter((i) => !gone.has(i.id)),
      { size: sizeOf, hidden },
    );
  }, [items, drag?.id, sizeOf, hidden]);

  const stats = useMemo(() => {
    const m = new Map<string, Stats>();
    for (const it of items) if (it.kind === 'option') m.set(it.id, optionStats(allKids.get(it.id) ?? []));
    return m;
  }, [items, allKids]);

  const leading = useMemo(() => {
    const out = new Set<string>();
    for (const it of items) {
      if (it.kind !== 'problem') continue;
      const opts = (allKids.get(it.id) ?? []).filter((k) => k.kind === 'option');
      const scored = opts.filter((o) => {
        const s = stats.get(o.id)!;
        return s.pro + s.con + s.risk > 0;
      });
      if (scored.length < 2) continue;
      const nets = scored.map((o) => stats.get(o.id)!.net);
      const best = Math.max(...nets);
      if (nets.filter((n) => n === best).length === 1) out.add(scored[nets.indexOf(best)].id);
    }
    return out;
  }, [items, allKids, stats]);

  // Focus a branch: that subtree plus its ancestors stay lit, the rest fades.
  const focusSet = useMemo(() => {
    if (!focusId || !byId.has(focusId)) return null;
    const s = new Set([focusId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const it of items)
        if (it.parentId && s.has(it.parentId) && !s.has(it.id)) {
          s.add(it.id);
          grew = true;
        }
    }
    let p = byId.get(focusId)?.parentId ?? null;
    while (p) {
      s.add(p);
      p = byId.get(p)?.parentId ?? null;
    }
    return s;
  }, [focusId, byId, items]);

  const { nodes, edges } = useMemo(() => {
    const nodes: DNode[] = [];
    const edges: Edge[] = [];
    const dragBase = drag ? positions.get(drag.id) : undefined;
    const walk = (it: Item, dimmed: boolean, follow: boolean) => {
      const children = (kids.get(it.id) ?? []).filter((c) => !hidden.has(c.id));
      const pills = compact && it.kind === 'option' ? pillsOf(it.id, kids) : null;
      const isDragged = drag?.id === it.id;
      const base = positions.get(it.id)!;
      const dy = dragBase && drag && (isDragged || follow) ? drag.y - dragBase.y : 0;
      const { w, h } = sizeOf(it);
      const faded = !!focusSet && !focusSet.has(it.id);
      nodes.push({
        id: it.id,
        type: 'decision',
        position: { x: base.x, y: base.y + dy },
        // Card sizes are known up front, so React Flow doesn't need to wait for a DOM measurement.
        width: w,
        height: h,
        measured: { width: w, height: h },
        selected: it.id === selectedId,
        zIndex: isDragged || follow ? 2000 : it.id === selectedId || menu?.id === it.id ? 1000 : 0,
        className: isDragged ? 'is-dragged' : follow ? 'is-following' : undefined,
        data: {
          item: it,
          stats: stats.get(it.id) ?? null,
          childCount: children.length,
          optionCount: children.filter((c) => c.kind === 'option').length,
          chosenTitle:
            it.kind === 'problem'
              ? ((kids.get(it.id) ?? []).find((c) => c.kind === 'option' && c.chosen)?.title ?? null)
              : null,
          leading: leading.has(it.id),
          dimmed,
          faded,
          w,
          h,
          pills,
          selectedPill: pills?.some((p) => p.id === selectedId) ? selectedId : null,
          editing: editing?.id === it.id,
          selectAll: editing?.id === it.id ? editing.selectAll : false,
          menuOpen: menu?.id === it.id,
          menuIndex: menu?.id === it.id ? menu.index : 0,
        },
      });
      if (it.collapsed) return;
      const anyChosen = children.some((c) => c.kind === 'option' && c.chosen);
      for (const c of children) {
        const cDim = dimmed || (anyChosen && c.kind === 'option' && !c.chosen);
        const cFaded = !!focusSet && !focusSet.has(c.id);
        edges.push({
          id: `e-${it.id}-${c.id}`,
          source: it.id,
          target: c.id,
          className: [`edge-${c.kind}`, c.chosen && 'is-chosen', cDim && 'is-dimmed', cFaded && 'is-faded']
            .filter(Boolean)
            .join(' '),
        });
        walk(c, cDim, follow || isDragged);
      }
    };
    for (const r of kids.get(null) ?? []) walk(r, false, false);
    return { nodes, edges };
  }, [kids, hidden, compact, pillsOf, positions, sizeOf, selectedId, stats, leading, drag, editing, menu, focusSet]);

  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  /* ---------- editing & adding ---------- */

  const startEdit = useCallback(
    (id: string) => {
      setSelectedId(id);
      setMenu(null);
      if (nodeIds.has(id)) {
        setFreshId(null);
        setEditing({ id, selectAll: true });
      } else {
        // Pills have no card of their own: rename in the inspector.
        setEditing(null);
        setFreshId(id);
      }
    },
    [nodeIds, setFreshId],
  );

  const handleAdd = useCallback(
    (parentId: string, kind: Kind, afterId?: string) => {
      const parent = byId.get(parentId);
      const id = add(parentId, kind, '', afterId);
      const asPill = compact && ((parent?.kind === 'option' && PILL_KINDS.has(kind)) || hidden.has(parentId));
      setSelectedId(id);
      setMenu(null);
      setRevealId(asPill ? parentId : id);
      if (asPill) {
        setEditing(null);
        setFreshId(id);
      } else {
        setFreshId(null);
        setEditing({ id, selectAll: false });
      }
    },
    [add, byId, compact, hidden, setFreshId],
  );

  const actions = useMemo<Actions>(
    () => ({
      add: (parentId, kind) => handleAdd(parentId, kind),
      update,
      select: (id) => select(id),
      toggleMenu: (id) => {
        setSelectedId(id);
        setEditing(null);
        setMenu((m) => (m?.id === id ? null : { id, index: 0 }));
      },
      startEdit,
      stopEdit: () => setEditing(null),
      editKey: (id, key) => {
        setEditing(null);
        if (key === 'Tab' && KINDS[byId.get(id)?.kind ?? 'note'].children.length) setMenu({ id, index: 0 });
      },
    }),
    [handleAdd, update, select, startEdit, byId],
  );

  /* ---------- drag to reorder ---------- */

  const latest = useRef({ items, positions, restPositions, sizeOf });
  latest.current = { items, positions, restPositions, sizeOf };

  const siblingsOf = (list: Item[], it: Item) =>
    list.filter((i) => i.parentId === it.parentId && i.kind === it.kind);

  const onNodeDragStart = useCallback((_: unknown, n: { id: string; position: { y: number } }) => {
    const { items } = latest.current;
    const it = items.find((i) => i.id === n.id);
    if (!it) return;
    setEditing(null);
    setMenu(null);
    const index = siblingsOf(items, it).findIndex((i) => i.id === it.id);
    setDrag({ id: it.id, y: n.position.y, index });
  }, []);

  const onNodeDrag = useCallback((_: unknown, n: { id: string; position: { y: number } }) => {
    const { items, positions, restPositions, sizeOf } = latest.current;
    const it = items.find((i) => i.id === n.id);
    if (!it) return;
    let center = n.position.y + sizeOf(it).h / 2;
    const others = siblingsOf(items, it).filter((i) => i.id !== it.id);
    const ref = restPositions ?? positions;
    // The parent doesn't move while reordering; use it to line up the two layouts.
    if (it.parentId && restPositions) {
      center -= positions.get(it.parentId)!.y - restPositions.get(it.parentId)!.y;
    }
    const index = others.filter((o) => {
      const p = ref.get(o.id);
      return p ? p.y + sizeOf(o).h / 2 < center : false;
    }).length;
    setDrag({ id: it.id, y: n.position.y, index });
  }, []);

  const onNodeDragStop = useCallback(() => {
    setDrag((d) => {
      if (d) move(d.id, d.index);
      return null;
    });
  }, [move]);

  /* ---------- camera ---------- */

  const panels = useRef({ side: sidebar === 'open', insp: !!selectedId });
  panels.current = { side: sidebar === 'open', insp: !!selectedId };
  const padding = useCallback(() => fitPadding(panels.current.side, panels.current.insp), []);
  const fit = useCallback(
    () => setTimeout(() => rf.fitView({ duration: 600, padding: fitPadding(panels.current.side, false), ...FIT }), 50),
    [rf],
  );

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Keep new or keyboard-selected cards in view.
  const posRef = useRef({ positions, sizeOf });
  posRef.current = { positions, sizeOf };
  useEffect(() => {
    if (!revealId) return;
    const t = setTimeout(() => {
      const { positions, sizeOf } = posRef.current;
      const p = positions.get(revealId);
      const it = byId.get(revealId);
      if (!p || !it) return;
      const { w, h } = sizeOf(it);
      const wide = window.innerWidth > 760;
      const a = rf.flowToScreenPosition({ x: p.x, y: p.y });
      const b = rf.flowToScreenPosition({ x: p.x + w, y: p.y + h });
      const left = wide && sidebar === 'open' ? 296 : 16;
      const right = window.innerWidth - (wide ? 380 : 16);
      const bottom = window.innerHeight - (wide ? 24 : window.innerHeight * 0.5);
      if (a.x < left || a.y < 76 || b.x > right || b.y > bottom) {
        const z = rf.getZoom();
        // Small graph that fits at this zoom: center all of it, not just the new card.
        let cx = p.x + w / 2;
        let cy = p.y + h / 2;
        const all = nodesRef.current;
        if (all.length) {
          const x0 = Math.min(...all.map((n) => n.position.x));
          const y0 = Math.min(...all.map((n) => n.position.y));
          const x1 = Math.max(...all.map((n) => n.position.x + (n.width ?? 0)));
          const y1 = Math.max(...all.map((n) => n.position.y + (n.height ?? 0)));
          if ((x1 - x0) * z <= right - left - 32 && (y1 - y0) * z <= bottom - 76 - 32) {
            cx = (x0 + x1) / 2;
            cy = (y0 + y1) / 2;
          }
        }
        rf.setCenter(
          cx + (wide ? (182 - (left - 16) / 2) / z : 0),
          cy + (wide ? 0 : (window.innerHeight * 0.22) / z),
          { zoom: z, duration: 450 },
        );
      }
      setRevealId(null);
    }, 40);
    return () => clearTimeout(t);
  }, [revealId, byId, rf, sidebar]);

  const toggleFocus = useCallback(
    (id: string | null) => {
      if (!id || focusId === id) {
        setFocusId(null);
        fit();
        return;
      }
      setFocusId(id);
    },
    [focusId, fit],
  );

  useEffect(() => {
    if (!focusId || !focusSet) return;
    const t = setTimeout(() => {
      const parent = byId.get(focusId)?.parentId;
      const ids = nodesRef.current.filter((n) => focusSet.has(n.id) && n.id !== parent);
      rf.fitView({ nodes: ids.map((n) => ({ id: n.id })), duration: 600, padding: padding(), maxZoom: 1 });
    }, 50);
    return () => clearTimeout(t);
    // Only when the focused branch changes, not on every edit inside it.
  }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- library ---------- */

  const resetView = useCallback(() => {
    setSelectedId(null);
    setFresh(null);
    setEditing(null);
    setMenu(null);
    setFocusId(null);
    setCompareId(null);
  }, []);

  /* ---------- keyboard ---------- */

  const deleteItem = useCallback(
    (id: string) => {
      const it = byId.get(id);
      remove(id);
      select(it?.parentId ?? null);
    },
    [byId, remove, select],
  );

  // Visible tree for arrow-key navigation (cards, plus pills inside compact option cards).
  const navChildren = useCallback(
    (id: string) => {
      const it = byId.get(id);
      const cards = it?.collapsed ? [] : (kids.get(id) ?? []).filter((c) => nodeIds.has(c.id));
      return cards.length ? cards : compact && it?.kind === 'option' ? pillsOf(id, kids) : [];
    },
    [byId, kids, nodeIds, compact, pillsOf],
  );
  const navSiblings = useCallback(
    (it: Item) => {
      if (!it.parentId) return (kids.get(null) ?? []).filter((c) => nodeIds.has(c.id));
      const all = kids.get(it.parentId) ?? [];
      return nodeIds.has(it.id)
        ? all.filter((c) => nodeIds.has(c.id))
        : all.filter((c) => hidden.has(c.id) && PILL_KINDS.has(c.kind));
    },
    [kids, nodeIds, hidden],
  );

  const optionsOf = useCallback(
    (problemId: string) => (allKids.get(problemId) ?? []).filter((c) => c.kind === 'option'),
    [allKids],
  );

  /* ---------- export ---------- */

  const exportPng = useCallback(async () => {
    setExportOpen(false);
    select(null);
    setEditing(null);
    setMenu(null);
    // Let the selection ring and "+" button finish fading out before capturing.
    await new Promise((r) => setTimeout(r, 350));
    try {
      const url = await graphToPng(rf.getNodesBounds(rf.getNodes()));
      downloadBlob(url, `${slug(docTitle(items))}.png`);
      setToast('Image downloaded');
    } catch {
      setToast('Could not export the image');
    }
  }, [rf, items, select]);

  const exportMd = useCallback(
    async (mode: 'copy' | 'file') => {
      setExportOpen(false);
      const md = toMarkdown(items);
      if (mode === 'file') {
        downloadBlob(new Blob([md], { type: 'text/markdown' }), `${slug(docTitle(items))}.md`);
        setToast('Markdown downloaded');
        return;
      }
      try {
        await navigator.clipboard.writeText(md);
        setToast('Copied as Markdown');
      } catch {
        setToast('Copy failed: your browser blocked clipboard access');
      }
    },
    [items],
  );

  const pickMenu = useCallback(
    (id: string, index: number) => {
      const it = byId.get(id);
      const k = it && KINDS[it.kind].children[index];
      if (k) handleAdd(id, k);
    },
    [byId, handleAdd],
  );

  useEffect(() => {
    const go = (id: string | undefined) => {
      if (!id) return;
      select(id);
      setRevealId(nodeIds.has(id) ? id : (byId.get(id)?.parentId ?? null));
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (t.closest('input, textarea, [contenteditable]')) {
        if (e.key === 'Escape') t.blur();
        return;
      }
      if (mod || e.altKey || compareId) return;

      // Add menu open: arrows / Enter / number keys pick a type.
      if (menu) {
        const count = KINDS[byId.get(menu.id)?.kind ?? 'note'].children.length;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') {
          e.preventDefault();
          const step = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
          setMenu({ id: menu.id, index: (menu.index + step + count) % count });
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          pickMenu(menu.id, menu.index);
          return;
        }
        if (/^[1-9]$/.test(e.key)) {
          e.preventDefault();
          pickMenu(menu.id, Number(e.key) - 1);
          return;
        }
        if (e.key === 'Escape') {
          setMenu(null);
          return;
        }
      }

      const sel = selectedId ? byId.get(selectedId) : undefined;
      if (e.key === 'Escape') {
        if (sel) select(null);
        else if (focusId) toggleFocus(null);
        return;
      }
      if (!sel) {
        if (e.key.startsWith('Arrow')) {
          e.preventDefault();
          go((kids.get(null) ?? [])[0]?.id);
        }
        return;
      }

      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          if (nodeIds.has(sel.id) && KINDS[sel.kind].children.length) setMenu({ id: sel.id, index: 0 });
          return;
        case 'Enter':
          e.preventDefault();
          if (sel.parentId) handleAdd(sel.parentId, sel.kind, sel.id);
          else startEdit(sel.id);
          return;
        case ' ':
        case 'F2':
          e.preventDefault();
          startEdit(sel.id);
          return;
        case 'c':
        case 'C': {
          const p = sel.kind === 'problem' ? sel : sel.kind === 'option' ? byId.get(sel.parentId ?? '') : undefined;
          if (p && optionsOf(p.id).length >= 2) setCompareId(p.id);
          return;
        }
        case 'f':
        case 'F':
          if (nodeIds.has(sel.id) && navChildren(sel.id).length) toggleFocus(sel.id);
          else if (focusId) toggleFocus(null);
          return;
        case 'Backspace':
        case 'Delete':
          e.preventDefault();
          deleteItem(sel.id);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          go(sel.parentId ?? undefined);
          return;
        case 'ArrowRight':
          e.preventDefault();
          go(navChildren(sel.id)[0]?.id);
          return;
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          const sibs = navSiblings(sel);
          const i = sibs.findIndex((s) => s.id === sel.id);
          go(sibs[i + (e.key === 'ArrowUp' ? -1 : 1)]?.id);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    selectedId, byId, kids, nodeIds, menu, focusId, select, undo, redo, deleteItem,
    handleAdd, startEdit, toggleFocus, navChildren, navSiblings, pickMenu, compareId, optionsOf,
  ]);

  const selected = selectedId ? byId.get(selectedId) : undefined;
  const focused = focusId ? byId.get(focusId) : undefined;
  const sideOpen = sidebar === 'open';

  return (
    <ActionsContext.Provider value={actions}>
      <div className={`app ${sideOpen ? 'side-open' : ''} ${selected ? 'insp-open' : ''}`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, n) => {
            if (n.id !== selectedId) select(n.id);
          }}
          onNodeDoubleClick={(_, n) => startEdit(n.id)}
          onPaneClick={() => select(null)}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          nodeDragThreshold={5}
          elevateNodesOnSelect={false}
          nodesConnectable={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          disableKeyboardA11y
          zoomOnDoubleClick={false}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          minZoom={0.2}
          maxZoom={1.8}
          fitView
          fitViewOptions={{ ...FIT, padding: fitPadding(sidebar === 'open', false) }}
          colorMode={theme}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
        </ReactFlow>

        <button
          className={`pill glass brand ${sideOpen ? 'is-on' : ''}`}
          onClick={() => setSidebar(sideOpen ? 'closed' : 'open')}
          aria-pressed={sideOpen}
          title={sideOpen ? 'Hide decisions' : 'Show decisions'}
        >
          <span className="logo">
            <KindIcon kind="option" size={15} />
          </span>
          <span className="brand-name">Decision Graph</span>
          <span className="brand-side">
            <IconSidebar size={15} />
          </span>
        </button>

        {sideOpen && (
          <Sidebar
            docs={doc.docs}
            activeId={doc.activeId}
            onSelect={(id) => {
              if (id === doc.activeId) return;
              doc.switchDoc(id);
              resetView();
              fit();
            }}
            onNew={() => {
              doc.newDoc();
              resetView();
            }}
            onDelete={(id) => {
              const wasActive = id === doc.activeId;
              doc.deleteDoc(id);
              if (wasActive) {
                resetView();
                fit();
              }
            }}
            onExample={() => {
              doc.openExample();
              resetView();
              fit();
            }}
          />
        )}

        <div className="pill glass top-right">
          <div className="seg-ctl" role="group" aria-label="View">
            <button
              className={`icon-btn ${compact ? 'is-on' : ''}`}
              onClick={() => {
                if (compact) return;
                setView('compact');
                setEditing(null);
                setMenu(null);
                fit();
              }}
              title="Compact view"
              aria-pressed={compact}
            >
              <IconCompact size={15} />
            </button>
            <button
              className={`icon-btn ${!compact ? 'is-on' : ''}`}
              onClick={() => {
                if (!compact) return;
                setView('expanded');
                setEditing(null);
                setMenu(null);
                fit();
              }}
              title="Expanded view"
              aria-pressed={!compact}
            >
              <IconExpand size={15} />
            </button>
          </div>
          <span className="pill-sep" />
          <div className="export-wrap">
            <button
              className={`icon-btn ${exportOpen ? 'is-on' : ''}`}
              onClick={() => setExportOpen((o) => !o)}
              aria-label="Export"
              aria-expanded={exportOpen}
              title="Export"
              disabled={!items.length}
            >
              <IconShare size={15} />
            </button>
            {exportOpen && (
              <>
                <div className="export-scrim" onClick={() => setExportOpen(false)} />
                <div className="menu glass export-menu" role="menu">
                  <button className="menu-item" role="menuitem" style={{ '--k': 'var(--option)' } as CSSProperties} onClick={exportPng}>
                    <span className="dn-chip"><IconImage size={13} /></span>
                    Image (PNG)
                  </button>
                  <button className="menu-item" role="menuitem" style={{ '--k': 'var(--problem)' } as CSSProperties} onClick={() => exportMd('file')}>
                    <span className="dn-chip"><IconDoc size={13} /></span>
                    Markdown file
                  </button>
                  <button className="menu-item" role="menuitem" style={{ '--k': 'var(--note)' } as CSSProperties} onClick={() => exportMd('copy')}>
                    <span className="dn-chip"><IconCopy size={13} /></span>
                    Copy as Markdown
                  </button>
                </div>
              </>
            )}
          </div>
          <button className="icon-btn" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
            {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
          </button>
        </div>

        <ZoomPill padding={padding} />

        {focused && (
          <div className="focus-pill glass">
            <IconFocus size={14} />
            <span className="focus-title">{focused.title || KINDS[focused.kind].label}</span>
            <button onClick={() => toggleFocus(null)}>Exit</button>
          </div>
        )}

        {items.length > 0 && (
          <div className="hint glass">
            {editing ? (
              <>
                <Kbd>↵</Kbd> done <span className="dot-sep" /> <Kbd>Tab</Kbd> add inside
              </>
            ) : menu ? (
              <>
                <Kbd>1</Kbd>–<Kbd>{String(KINDS[byId.get(menu.id)?.kind ?? 'note'].children.length)}</Kbd> pick
                <span className="dot-sep" /> <Kbd>↑↓</Kbd> move <span className="dot-sep" /> <Kbd>↵</Kbd> add
                <span className="dot-sep" /> <Kbd>esc</Kbd> close
              </>
            ) : selected ? (
              <>
                <Kbd>Tab</Kbd> add inside <span className="dot-sep" /> <Kbd>↵</Kbd> add next
                <span className="dot-sep" /> <Kbd>Space</Kbd> rename <span className="dot-sep" /> <Kbd>←↑↓→</Kbd> move
                <span className="dot-sep" /> <Kbd>F</Kbd> focus
              </>
            ) : (
              <>
                Double-click to rename <span className="dot-sep" /> drag to reorder
                <span className="dot-sep" /> <Kbd>⌘Z</Kbd> undo
              </>
            )}
          </div>
        )}

        {selected && (
          <Inspector
            item={selected}
            stats={stats.get(selected.id) ?? null}
            focusToken={fresh?.id === selected.id ? fresh.n : 0}
            onUpdate={(patch) => update(selected.id, patch)}
            onAdd={(k) => handleAdd(selected.id, k)}
            onChoose={() => choose(selected.id)}
            onDelete={() => deleteItem(selected.id)}
            onClose={() => select(null)}
            onFocus={
              nodeIds.has(selected.id) && navChildren(selected.id).length
                ? () => toggleFocus(selected.id)
                : undefined
            }
            focused={focusId === selected.id}
            record={(() => {
              const problem =
                selected.kind === 'problem'
                  ? selected
                  : selected.kind === 'option'
                    ? byId.get(selected.parentId ?? '')
                    : undefined;
              if (!problem) return undefined;
              return {
                problem,
                chosen: optionsOf(problem.id).find((o) => o.chosen) ?? null,
                onRationale: (v: string) => update(problem.id, { rationale: v }),
              };
            })()}
            onCompare={
              selected.kind === 'problem' && optionsOf(selected.id).length >= 2
                ? () => setCompareId(selected.id)
                : undefined
            }
          />
        )}

        {compareId && byId.get(compareId) && (
          <Compare
            problem={byId.get(compareId)!}
            items={items}
            onChoose={(id) => choose(id)}
            onClose={() => setCompareId(null)}
          />
        )}

        {toast && (
          <div className="toast glass" role="status">
            {toast}
          </div>
        )}

        {items.length === 0 && (
          <EmptyState
            onStart={(title) => {
              const id = add(null, 'problem', title);
              setSelectedId(id);
              setMenu({ id, index: 0 });
              fit();
            }}
          />
        )}
      </div>
    </ActionsContext.Provider>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
