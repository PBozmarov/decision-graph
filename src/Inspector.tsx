import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { GUT_KEY, KINDS, isWeighted, type Item, type Stats, type Verdict } from './model';
import { Dots } from './DecisionNode';
import { VerdictHeadline } from './Verdict';
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconChevron,
  IconClose,
  IconColumns,
  IconCopy,
  IconFocus,
  IconTrash,
  GutIcon,
  KindIcon,
} from './icons';

const IMPACT = ['', 'Minor', 'Low', 'Moderate', 'High', 'Critical'];

function AutoText({
  value,
  onChange,
  placeholder,
  className,
  focusToken = 0,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className: string;
  focusToken?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    // Renaming: select the existing text so typing replaces it.
    if (focusToken) ref.current?.select();
  }, [focusToken]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

const GUTS = [
  { v: -1, label: 'Uneasy' },
  { v: 0, label: 'Neutral' },
  { v: 1, label: 'Good' },
] as const;

/** Three-way gut feeling for an option; clicking the selected one clears it. Also used by the guide. */
export function GutControl({ value, onChange }: { value: Item['gut']; onChange: (v: Item['gut']) => void }) {
  return (
    <div className="seg-ctl gut-ctl" role="radiogroup" aria-label="Gut feeling">
      {GUTS.map((g) => (
        <button
          key={g.v}
          role="radio"
          aria-checked={value === g.v}
          className={`gut-seg gut-${GUT_KEY[g.v]} ${value === g.v ? 'is-on' : ''}`}
          onClick={() => onChange(value === g.v ? undefined : g.v)}
        >
          <GutIcon gut={g.v} size={15} />
          {g.label}
        </button>
      ))}
    </div>
  );
}

/** "Move to…": a menu of the cards that can take this one. Rendered in a portal so the scrolling panel can't clip it. */
function MoveTo({ targets, onMove }: { targets: Item[]; onMove: (targetId: string) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => {
      // The search palette may sit on top; its own Escape comes first.
      if (e.key !== 'Escape' || document.querySelector('.pal-backdrop')) return;
      e.stopPropagation();
      setPos(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pos]);
  const open = () => {
    const r = btn.current!.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 16;
    const above = r.top - 16;
    const up = below < 240 && above > below; // e.g. the phone bottom sheet
    setPos({
      right: Math.max(8, window.innerWidth - r.right),
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      maxHeight: Math.min(320, up ? above : below),
      transformOrigin: up ? 'bottom right' : 'top right',
    });
  };
  return (
    <section className="insp-section row">
      <div className="insp-row-title">Move to</div>
      <button
        ref={btn}
        className={`btn-secondary move-btn ${pos ? 'is-open' : ''}`}
        onClick={() => (pos ? setPos(null) : open())}
        aria-haspopup="menu"
        aria-expanded={!!pos}
      >
        Choose… <IconChevron size={13} />
      </button>
      {pos &&
        createPortal(
          <>
            <div className="export-scrim" onClick={() => setPos(null)} />
            <div className="menu glass move-menu" role="menu" style={pos}>
              {targets.map((t) => (
                <button
                  key={t.id}
                  className="menu-item"
                  role="menuitem"
                  style={{ '--k': `var(--${t.kind})` } as CSSProperties}
                  onClick={() => {
                    setPos(null);
                    onMove(t.id);
                  }}
                >
                  <span className="dn-chip">
                    <KindIcon kind={t.kind} size={13} />
                  </span>
                  <span className={`move-title ${t.title ? '' : 'ph'}`}>
                    {t.title || `Untitled ${KINDS[t.kind].label.toLowerCase()}`}
                  </span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </section>
  );
}

export function Inspector({
  item,
  stats,
  focusToken,
  onUpdate,
  onAdd,
  onChoose,
  onDelete,
  onDuplicate,
  moveTargets,
  onMove,
  onClose,
  onFocus,
  focused,
  record,
  onCompare,
  reorder,
  blockers,
}: {
  item: Item;
  stats: Stats | null;
  /** Changes whenever the title should take focus. */
  focusToken: number;
  onUpdate: (patch: Partial<Item>) => void;
  onAdd: (kind: Item['kind']) => void;
  onChoose: () => void;
  onDelete: () => void;
  /** Absent for root decisions. */
  onDuplicate?: () => void;
  /** Cards this one can move under ("Move to…" is hidden when empty). */
  moveTargets?: Item[];
  onMove?: (targetId: string) => void;
  onClose: () => void;
  /** Present when this card has a branch that can be focused. */
  onFocus?: () => void;
  focused?: boolean;
  /** Decision record: the decision this card belongs to and its chosen option. */
  record?: { problem: Item; chosen: Item | null; onRationale: (v: string) => void; verdict?: Verdict | null };
  /** Present on decisions with 2+ options. */
  onCompare?: () => void;
  /** Touch screens: move among same-type siblings (replaces drag to reorder). */
  reorder?: { canUp: boolean; canDown: boolean; move: (dir: -1 | 1) => void };
  /** Options: titles of the unmet must-haves that rule this option out. */
  blockers?: string[];
}) {
  const meta = KINDS[item.kind];
  const style = { '--k': `var(--${item.kind})` } as CSSProperties;

  return (
    <aside className="inspector glass" style={style} key={item.id}>
      <header className="insp-head">
        <span className="dn-chip">
          <KindIcon kind={item.kind} size={14} />
        </span>
        <span className="dn-kind">{meta.label}</span>
        <span className="dn-spacer" />
        {onFocus && (
          <button
            className={`icon-btn ${focused ? 'is-on' : ''}`}
            onClick={onFocus}
            aria-label={focused ? 'Exit focus' : 'Focus this branch'}
            title={focused ? 'Exit focus (F)' : 'Focus this branch (F)'}
          >
            <IconFocus size={14} />
          </button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <IconClose size={14} />
        </button>
      </header>

      <AutoText
        className="insp-title"
        value={item.title}
        placeholder={meta.placeholder}
        onChange={(v) => onUpdate({ title: v })}
        focusToken={focusToken}
      />

      {item.kind !== 'note' && (
        <AutoText
          className="insp-notes"
          value={item.notes}
          placeholder="Add notes…"
          onChange={(v) => onUpdate({ notes: v })}
        />
      )}

      {isWeighted(item.kind) && (
        <section className="insp-section">
          <div className="insp-label">
            Impact <span className="insp-value">{IMPACT[item.weight]}</span>
          </div>
          <Dots size="lg" value={item.weight} onChange={(v) => onUpdate({ weight: v })} />
        </section>
      )}

      {item.kind === 'requirement' && (
        <section className="insp-section row">
          <div>
            <div className="insp-row-title">I have this</div>
            <div className="insp-row-sub">{item.met ? 'Requirement is met' : 'Still missing'}</div>
          </div>
          <button
            role="switch"
            aria-checked={item.met}
            className={`switch ${item.met ? 'on' : ''}`}
            onClick={() => onUpdate({ met: !item.met })}
          >
            <span />
          </button>
        </section>
      )}

      {item.kind === 'requirement' && (
        <section className="insp-section row">
          <div>
            <div className="insp-row-title">Must-have</div>
            <div className="insp-row-sub">{item.must ? 'Options without it are ruled out' : 'Nice to have'}</div>
          </div>
          <button
            role="switch"
            aria-checked={!!item.must}
            className={`switch switch-must ${item.must ? 'on' : ''}`}
            onClick={() => onUpdate({ must: !item.must })}
          >
            <span />
          </button>
        </section>
      )}

      {item.kind === 'action' && (
        <section className="insp-section row">
          <div>
            <div className="insp-row-title">Done</div>
            <div className="insp-row-sub">{item.done ? 'Completed' : 'Still to do'}</div>
          </div>
          <button
            role="switch"
            aria-checked={!!item.done}
            className={`switch switch-action ${item.done ? 'on' : ''}`}
            onClick={() => onUpdate({ done: !item.done })}
          >
            <span />
          </button>
        </section>
      )}

      {item.kind === 'option' && stats && (
        <section className="insp-section">
          <div className="insp-label">Balance</div>
          <div className="score-grid">
            <div className="score" style={{ '--k': 'var(--pro)' } as CSSProperties}>
              <b>{stats.pro}</b>
              <span>Pros</span>
            </div>
            <div className="score" style={{ '--k': 'var(--con)' } as CSSProperties}>
              <b>{stats.con}</b>
              <span>Cons</span>
            </div>
            <div className="score" style={{ '--k': 'var(--risk)' } as CSSProperties}>
              <b>{stats.risk}</b>
              <span>Risk</span>
            </div>
            <div className="score" style={{ '--k': 'var(--requirement)' } as CSSProperties}>
              <b>
                {stats.reqMet}/{stats.reqTotal}
              </b>
              <span>Needs</span>
            </div>
          </div>
          {blockers && blockers.length > 0 && (
            <div className="insp-blocked t-con">
              Missing a must-have: {blockers[0] || 'Untitled requirement'}
              {blockers.length > 1 && ` and ${blockers.length - 1} more`}
            </div>
          )}
          <div className="gut-row">
            <div>
              <div className="gut-title">Gut feeling</div>
              <div className="gut-sub">How does this path feel?</div>
            </div>
            <GutControl value={item.gut} onChange={(gut) => onUpdate({ gut })} />
          </div>
          <div className="net">
            Net score
            <b className={stats.net > 0 ? 't-pro' : stats.net < 0 ? 't-con' : ''}>
              {stats.net > 0 ? `+${stats.net}` : stats.net}
            </b>
          </div>
          <button className={`btn-primary ${item.chosen ? 'is-on' : ''}`} onClick={onChoose}>
            {item.chosen ? (
              <>
                <IconCheck size={15} /> Chosen path
              </>
            ) : (
              'Choose this path'
            )}
          </button>
        </section>
      )}

      {item.kind === 'problem' && record && (
        <section className="insp-section">
          <div className="insp-label">Decision</div>
          {record.chosen ? (
            <div className="record-chosen">
              <span className="record-check">
                <IconCheck size={13} />
              </span>
              <div>
                <div className="record-title">{record.chosen.title || 'Untitled option'}</div>
                {item.decidedAt && (
                  <div className="insp-row-sub">
                    Decided {new Date(item.decidedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {record.verdict && <VerdictHeadline v={record.verdict} className="insp-verdict" />}
              <div className="insp-row-sub">No path chosen yet. Pick one from an option, or compare them side by side.</div>
            </>
          )}
          {record.chosen && (
            <AutoText
              className="insp-notes"
              value={item.rationale ?? ''}
              placeholder="Why this path? Your future self will thank you…"
              onChange={record.onRationale}
            />
          )}
          {onCompare && (
            <button className="btn-secondary" onClick={onCompare}>
              <IconColumns size={15} /> Compare options
              <span className="kbd-hint">C</span>
            </button>
          )}
        </section>
      )}

      {item.kind === 'option' && item.chosen && record && (
        <section className="insp-section">
          <div className="insp-label">Why this path?</div>
          <AutoText
            className="insp-notes"
            value={record.problem.rationale ?? ''}
            placeholder="Write down the reasoning while it's fresh…"
            onChange={record.onRationale}
          />
        </section>
      )}

      {meta.children.length > 0 && (
        <section className="insp-section">
          <div className="insp-label">Branch out</div>
          <div className="chips">
            {meta.children.map((k) => (
              <button
                key={k}
                className="chip"
                style={{ '--k': `var(--${k})` } as CSSProperties}
                onClick={() => onAdd(k)}
              >
                <KindIcon kind={k} size={13} />
                {KINDS[k].addLabel}
              </button>
            ))}
          </div>
        </section>
      )}

      {onMove && moveTargets && moveTargets.length > 0 && <MoveTo targets={moveTargets} onMove={onMove} />}

      {reorder && (reorder.canUp || reorder.canDown) && (
        <section className="insp-section row">
          <div className="insp-row-title">Order</div>
          <div className="reorder-btns">
            <button className="icon-btn" disabled={!reorder.canUp} onClick={() => reorder.move(-1)} aria-label="Move up">
              <IconArrowUp size={16} />
            </button>
            <button className="icon-btn" disabled={!reorder.canDown} onClick={() => reorder.move(1)} aria-label="Move down">
              <IconArrowDown size={16} />
            </button>
          </div>
        </section>
      )}

      {onDuplicate ? (
        <footer className="insp-foot">
          <span className="insp-foot-group">
            <button className="btn-danger btn-quiet" onClick={onDuplicate}>
              <IconCopy size={14} /> Duplicate
            </button>
            <span className="kbd-hint">⌘D</span>
          </span>
          <span className="insp-foot-group">
            <button className="btn-danger" onClick={onDelete}>
              <IconTrash size={14} /> Delete{meta.children.length ? ' branch' : ''}
            </button>
            <span className="kbd-hint">⌫</span>
          </span>
        </footer>
      ) : (
        <footer className="insp-foot">
          <button className="btn-danger" onClick={onDelete}>
            <IconTrash size={14} /> Delete{meta.children.length ? ' branch' : ''}
          </button>
          <span className="kbd-hint">⌫</span>
        </footer>
      )}
    </aside>
  );
}
