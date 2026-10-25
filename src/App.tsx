import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { DecisionNode, type DNode } from './DecisionNode';
import { Inspector } from './Inspector';
import { ActionsContext, type Actions } from './actions';
import { SIZE, applyMove, groupChildren, layout, optionStats, type Item, type Kind, type Stats } from './model';
import { useDoc } from './store';
import {
  IconBlank,
  IconFit,
  IconMinus,
  IconMoon,
  IconPlus,
  IconReset,
  IconSun,
  KindIcon,
} from './icons';

const nodeTypes = { decision: DecisionNode };

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.dataset.theme as 'light' | 'dark') ?? 'light',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () =>
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('dg-theme', next);
      } catch {
        /* ignore */
      }
      return next;
    });
  return { theme, toggle };
}

function ZoomPill() {
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
        onClick={() => rf.fitView({ duration: 500, padding: 0.2 })}
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

function Canvas() {
  const { items, add, update, remove, move, choose, reset, clear, undo, redo } = useDoc();
  const { theme, toggle } = useTheme();
  const rf = useReactFlow();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setFreshId(null);
  }, []);

  // Drag-to-reorder: while dragging, siblings make room live; the drop commits the move.
  const [drag, setDrag] = useState<{ id: string; y: number; index: number } | null>(null);
  const shown = useMemo(
    () => (drag ? applyMove(items, drag.id, drag.index) : items),
    [items, drag?.id, drag?.index],
  );

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const kids = useMemo(() => groupChildren(shown), [shown]);
  const positions = useMemo(() => layout(shown), [shown]);
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
    return layout(items.filter((i) => !gone.has(i.id)));
  }, [items, drag?.id]);

  const stats = useMemo(() => {
    const m = new Map<string, Stats>();
    for (const it of items) if (it.kind === 'option') m.set(it.id, optionStats(kids.get(it.id) ?? []));
    return m;
  }, [items, kids]);

  const leading = useMemo(() => {
    const out = new Set<string>();
    for (const it of items) {
      if (it.kind !== 'problem') continue;
      const opts = (kids.get(it.id) ?? []).filter((k) => k.kind === 'option');
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
  }, [items, kids, stats]);

  const { nodes, edges } = useMemo(() => {
    const nodes: DNode[] = [];
    const edges: Edge[] = [];
    const dragBase = drag ? positions.get(drag.id) : undefined;
    const walk = (it: Item, dimmed: boolean, follow: boolean) => {
      const children = kids.get(it.id) ?? [];
      const isDragged = drag?.id === it.id;
      const base = positions.get(it.id)!;
      const dy = dragBase && drag && (isDragged || follow) ? drag.y - dragBase.y : 0;
      nodes.push({
        id: it.id,
        type: 'decision',
        position: { x: base.x, y: base.y + dy },
        // Cards have fixed sizes, so React Flow doesn't need to wait for a DOM measurement.
        width: SIZE[it.kind].w,
        height: SIZE[it.kind].h,
        measured: { width: SIZE[it.kind].w, height: SIZE[it.kind].h },
        selected: it.id === selectedId,
        zIndex: isDragged || follow ? 2000 : it.id === selectedId ? 1000 : 0,
        className: isDragged ? 'is-dragged' : follow ? 'is-following' : undefined,
        data: {
          item: it,
          stats: stats.get(it.id) ?? null,
          childCount: children.length,
          optionCount: children.filter((c) => c.kind === 'option').length,
          leading: leading.has(it.id),
          dimmed,
        },
      });
      if (it.collapsed) return;
      const anyChosen = children.some((c) => c.kind === 'option' && c.chosen);
      for (const c of children) {
        const cDim = dimmed || (anyChosen && c.kind === 'option' && !c.chosen);
        edges.push({
          id: `e-${it.id}-${c.id}`,
          source: it.id,
          target: c.id,
          className: [`edge-${c.kind}`, c.chosen && 'is-chosen', cDim && 'is-dimmed']
            .filter(Boolean)
            .join(' '),
        });
        walk(c, cDim, follow || isDragged);
      }
    };
    for (const r of kids.get(null) ?? []) walk(r, false, false);
    return { nodes, edges };
  }, [kids, positions, selectedId, stats, leading, drag]);

  const handleAdd = useCallback(
    (parentId: string, kind: Kind) => {
      const id = add(parentId, kind);
      setSelectedId(id);
      setFreshId(id);
    },
    [add],
  );

  const actions = useMemo<Actions>(
    () => ({ add: handleAdd, update, select: (id: string) => select(id) }),
    [handleAdd, update, select],
  );

  const latest = useRef({ items, positions, restPositions });
  latest.current = { items, positions, restPositions };

  const siblingsOf = (list: Item[], it: Item) =>
    list.filter((i) => i.parentId === it.parentId && i.kind === it.kind);

  const onNodeDragStart = useCallback((_: unknown, n: { id: string; position: { y: number } }) => {
    const { items } = latest.current;
    const it = items.find((i) => i.id === n.id);
    if (!it) return;
    const index = siblingsOf(items, it).findIndex((i) => i.id === it.id);
    setDrag({ id: it.id, y: n.position.y, index });
  }, []);

  const onNodeDrag = useCallback((_: unknown, n: { id: string; position: { y: number } }) => {
    const { items, positions, restPositions } = latest.current;
    const it = items.find((i) => i.id === n.id);
    if (!it) return;
    let center = n.position.y + SIZE[it.kind].h / 2;
    const others = siblingsOf(items, it).filter((i) => i.id !== it.id);
    const ref = restPositions ?? positions;
    // The parent doesn't move while reordering; use it to line up the two layouts.
    if (it.parentId && restPositions) {
      center -= positions.get(it.parentId)!.y - restPositions.get(it.parentId)!.y;
    }
    const index = others.filter((o) => ref.get(o.id)!.y + SIZE[o.kind].h / 2 < center).length;
    setDrag({ id: it.id, y: n.position.y, index });
  }, []);

  const onNodeDragStop = useCallback(() => {
    setDrag((d) => {
      if (d) move(d.id, d.index);
      return null;
    });
  }, [move]);

  // Keep newly created cards in view.
  const posRef = useRef(positions);
  posRef.current = positions;
  useEffect(() => {
    if (!freshId) return;
    const t = setTimeout(() => {
      const p = posRef.current.get(freshId);
      const it = byId.get(freshId);
      if (!p || !it) return;
      const { w, h } = SIZE[it.kind];
      const wide = window.innerWidth > 760;
      const a = rf.flowToScreenPosition({ x: p.x, y: p.y });
      const b = rf.flowToScreenPosition({ x: p.x + w, y: p.y + h });
      const right = window.innerWidth - (wide ? 380 : 16);
      const bottom = window.innerHeight - (wide ? 24 : window.innerHeight * 0.5);
      if (a.x < 16 || a.y < 76 || b.x > right || b.y > bottom) {
        const z = rf.getZoom();
        rf.setCenter(p.x + w / 2 + (wide ? 182 / z : 0), p.y + h / 2 + (wide ? 0 : window.innerHeight * 0.22 / z), {
          zoom: z,
          duration: 500,
        });
      }
    }, 40);
    return () => clearTimeout(t);
  }, [freshId]);

  const deleteItem = useCallback(
    (id: string) => {
      const it = byId.get(id);
      remove(id);
      select(it?.parentId ?? null);
    },
    [byId, remove, select],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (t.closest('input, textarea, [contenteditable]')) {
        if (e.key === 'Escape') t.blur();
        return;
      }
      if (e.key === 'Escape') select(null);
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId) {
        e.preventDefault();
        deleteItem(selectedId);
      }
      if (e.key === 'Enter' && selectedId) {
        e.preventDefault();
        setFreshId(selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, deleteItem, select, undo, redo]);

  const selected = selectedId ? byId.get(selectedId) : undefined;
  const fit = () => setTimeout(() => rf.fitView({ duration: 600, padding: 0.15, minZoom: 0.5, maxZoom: 1 }), 30);

  return (
    <ActionsContext.Provider value={actions}>
      <div className="app">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, n) => {
            if (n.id !== selectedId) select(n.id);
          }}
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
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          minZoom={0.2}
          maxZoom={1.8}
          fitView
          fitViewOptions={{ padding: 0.15, minZoom: 0.5, maxZoom: 1 }}
          colorMode={theme}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
        </ReactFlow>

        <div className="pill glass brand">
          <span className="logo">
            <KindIcon kind="option" size={15} />
          </span>
          <span className="brand-name">Decision Graph</span>
        </div>

        <div className="pill glass top-right">
          <button className="icon-btn" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
            {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
          </button>
          <span className="pill-sep" />
          <button
            className="icon-btn"
            title="Load example"
            aria-label="Load example"
            onClick={() => {
              if (confirm('Replace the current graph with the example?')) {
                reset();
                select(null);
                fit();
              }
            }}
          >
            <IconReset size={15} />
          </button>
          <button
            className="icon-btn"
            title="New blank graph"
            aria-label="New blank graph"
            onClick={() => {
              if (!items.length || confirm('Start a new blank graph? This clears the current one.')) {
                clear();
                select(null);
              }
            }}
          >
            <IconBlank size={15} />
          </button>
        </div>

        <ZoomPill />

        {!selected && items.length > 0 && (
          <div className="hint glass">
            Click a card to edit <span className="dot-sep" /> <kbd>+</kbd> to branch out
            <span className="dot-sep" /> drag to reorder
            <span className="dot-sep" /> <kbd className="kbd-wide">⌘Z</kbd> undo
          </div>
        )}

        {selected && (
          <Inspector
            item={selected}
            stats={stats.get(selected.id) ?? null}
            fresh={freshId === selected.id}
            onUpdate={(patch) => update(selected.id, patch)}
            onAdd={(k) => handleAdd(selected.id, k)}
            onChoose={() => choose(selected.id)}
            onDelete={() => deleteItem(selected.id)}
            onClose={() => select(null)}
          />
        )}

        {items.length === 0 && (
          <EmptyState
            onStart={(title) => {
              const id = add(null, 'problem', title);
              select(id);
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

