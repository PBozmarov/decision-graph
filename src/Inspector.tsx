import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  GUT_KEY,
  KINDS,
  OUTCOME,
  addLabel,
  isWeighted,
  kindLabel,
  placeholderOf,
  reviewDue,
  type Item,
  type Kind,
  type Stats,
  type Verdict,
} from './model';
import { Dots } from './DecisionNode';
import { VerdictHeadline } from './Verdict';
import { fmtDay, quickPicks, relDay, tomorrow } from './dates';
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconChevron,
  IconClock,
  IconClose,
  IconColumns,
  IconCopy,
  IconFocus,
  IconTrash,
  GutIcon,
  KindIcon,
  TrendIcon,
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

/** "YYYY-MM-DD" for a date input, in local time. */
const isoDay = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A decided decision: set a check-back date, look back when it comes, then keep the outcome. */
function CheckBack({
  problem,
  chosen,
  onReviewAt,
  onReview,
}: {
  problem: Item;
  chosen: Item;
  onReviewAt: (ts: number | undefined) => void;
  onReview: (edit: boolean) => void;
}) {
  const { reviewAt, outcome } = problem;
  if (outcome) {
    const o = OUTCOME[outcome.rating];
    return (
      <div className="outcome" style={{ '--k': o.color } as CSSProperties}>
        <div className="outcome-head">
          <span className="outcome-ic">
            <TrendIcon rating={outcome.rating} size={14} />
          </span>
          <div className="outcome-text">
            <div className="outcome-title">{o.long}</div>
            <div className="insp-row-sub">Reviewed {fmtDay(outcome.at)}</div>
          </div>
          <button className="outcome-edit" onClick={() => onReview(true)}>
            Edit
          </button>
        </div>
        {outcome.note && <div className="outcome-note">{outcome.note}</div>}
      </div>
    );
  }
  if (reviewDue(problem, [chosen])) {
    return (
      <>
        <div className="checkback-line t-risk">
          <IconClock size={14} /> Ready for a look back
        </div>
        <button className="btn-secondary" onClick={() => onReview(false)}>
          Look back now
        </button>
      </>
    );
  }
  if (reviewAt !== undefined) {
    return (
      <div className="checkback-line">
        <IconClock size={14} />
        <span className="checkback-tx">
          Check back <b>{fmtDay(reviewAt)}</b> · {relDay(reviewAt)}
        </span>
        <button className="icon-btn checkback-clear" onClick={() => onReviewAt(undefined)} aria-label="Clear check-back date" title="Clear">
          <IconClose size={12} />
        </button>
      </div>
    );
  }
  const minDay = isoDay(tomorrow());
  return (
    <div className="checkback">
      <div>
        <div className="insp-row-title">Check back</div>
        <div className="insp-row-sub">Get asked how it turned out</div>
      </div>
      <div className="chips">
        {quickPicks().map((q) => (
          <button key={q.label} className="chip chip-pick" onClick={() => onReviewAt(q.at)}>
            {q.label}
          </button>
        ))}
        <span className="chip chip-pick chip-date">
          Pick a date…
          <input
            type="date"
            min={minDay}
            aria-label="Pick a check-back date"
            // Open the calendar on any click, not only on its small icon.
            onClick={(e) => {
              try {
                e.currentTarget.showPicker();
              } catch {
                /* not supported: the input still takes typing */
              }
            }}
            onChange={(e) => {
              const [y, m, d] = e.target.value.split('-').map(Number);
              if (!y || !m || !d) return;
              const ts = new Date(y, m - 1, d).getTime();
              if (e.target.value >= minDay) onReviewAt(ts);
            }}
          />
        </span>
      </div>
    </div>
  );
}

/** "Move to…": a menu of the cards that can take this one. Rendered in a portal so the scrolling panel can't clip it. */
function MoveTo({ kind, targets, onMove }: { kind: Kind; targets: Item[]; onMove: (targetId: string) => void }) {
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
                    {/* An option moved under an option becomes its sub-option. */}
                    {kind === 'option' && t.kind === 'option' && <span className="move-pre">{kindLabel(kind, t.kind)} of </span>}
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

type DecisionRecordData = {
  /** The decision node: a decision, or an option with sub-options. */
  problem: Item;
  chosen: Item | null;
  onRationale: (v: string) => void;
  verdict?: Verdict | null;
  onReviewAt?: (ts: number | undefined) => void;
  /** Opens the look-back sheet (prefilled when editing a saved outcome). */
  onReview?: (edit: boolean) => void;
};

/** A decision node's record: the verdict until a path is chosen, then the choice, why, and the look back. */
function DecisionRecord({
  label,
  record,
  empty,
  onCompare,
  compareLabel,
  compareKey,
}: {
  label: string;
  record: DecisionRecordData;
  empty: string;
  onCompare?: () => void;
  compareLabel: string;
  compareKey?: string;
}) {
  const node = record.problem;
  return (
    <section className="insp-section">
      <div className="insp-label">{label}</div>
      {record.chosen ? (
        <div className="record-chosen">
          <span className="record-check">
            <IconCheck size={13} />
          </span>
          <div>
            <div className="record-title">
              {record.chosen.title || `Untitled ${kindLabel(record.chosen.kind, node.kind).toLowerCase()}`}
            </div>
            {node.decidedAt && (
              <div className="insp-row-sub">
                Decided {new Date(node.decidedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {record.verdict && <VerdictHeadline v={record.verdict} className="insp-verdict" outcome={node.outcome} />}
          <div className="insp-row-sub">{empty}</div>
        </>
      )}
      {record.chosen && (
        <AutoText
          className="insp-notes"
          value={node.rationale ?? ''}
          placeholder="Why this path? Your future self will thank you…"
          onChange={record.onRationale}
        />
      )}
      {record.chosen && record.onReviewAt && record.onReview && (
        <CheckBack problem={node} chosen={record.chosen} onReviewAt={record.onReviewAt} onReview={record.onReview} />
      )}
      {onCompare && (
        <button className="btn-secondary" onClick={onCompare}>
          <IconColumns size={15} /> {compareLabel}
          {compareKey && <span className="kbd-hint">{compareKey}</span>}
        </button>
      )}
    </section>
  );
}

export function Inspector({
  item,
  parentKind,
  stats,
  via,
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
  subRecord,
  onCompare,
  onCompareSubs,
  reorder,
  blockers,
}: {
  item: Item;
  /** The parent card's kind (an option under an option is a sub-option). */
  parentKind?: Kind | null;
  stats: Stats | null;
  /** Options: the sub-option counted in the net score. */
  via?: { title: string; net: number } | null;
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
  /** Decision record: the decision node this card belongs to (a decision: itself) and its chosen option. */
  record?: DecisionRecordData;
  /** Options with sub-options: their own record (the sub-option choice). */
  subRecord?: DecisionRecordData;
  /** Present on decisions with 2+ options. */
  onCompare?: () => void;
  /** Present on options with 2+ sub-options. */
  onCompareSubs?: () => void;
  /** Touch screens: move among same-type siblings (replaces drag to reorder). */
  reorder?: { canUp: boolean; canDown: boolean; move: (dir: -1 | 1) => void };
  /** Options: titles of the unmet must-haves that rule this option out. */
  blockers?: string[];
}) {
  const meta = KINDS[item.kind];
  const style = { '--k': `var(--${item.kind})` } as CSSProperties;
  const num = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  return (
    <aside className="inspector glass" style={style} key={item.id}>
      <header className="insp-head">
        <span className="dn-chip">
          <KindIcon kind={item.kind} size={14} />
        </span>
        <span className="dn-kind">{kindLabel(item.kind, parentKind)}</span>
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
        placeholder={placeholderOf(item.kind, parentKind)}
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
          {via && (
            <div className="net-via">
              own {num(stats.ownNet)} · {via.title || 'Untitled sub-option'} {num(via.net)}
            </div>
          )}
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

      {item.kind === 'option' && subRecord && (
        <DecisionRecord
          label="Sub-options"
          record={subRecord}
          empty="No sub-option chosen yet."
          onCompare={onCompareSubs}
          compareLabel="Compare sub-options"
        />
      )}

      {item.kind === 'problem' && record && (
        <DecisionRecord
          label="Decision"
          record={record}
          empty="No path chosen yet. Pick one from an option, or compare them side by side."
          onCompare={onCompare}
          compareLabel="Compare options"
          compareKey="C"
        />
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
                {addLabel(k, item.kind)}
              </button>
            ))}
          </div>
        </section>
      )}

      {onMove && moveTargets && moveTargets.length > 0 && <MoveTo kind={item.kind} targets={moveTargets} onMove={onMove} />}

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
