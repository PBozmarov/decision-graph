import { memo, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { GUT_KEY, KINDS, isBlocked, isWeighted, type Item, type Stats, type Verdict } from './model';
import { pillText, showsVerdict } from './compact';
import { useActions } from './actions';
import { GutIcon, IconCheck, IconChevron, IconPlus, KindIcon } from './icons';
import { VerdictHeadline } from './Verdict';

export type DNodeData = {
  item: Item;
  stats: Stats | null;
  childCount: number;
  optionCount: number;
  /** Decision cards: title of the chosen option, if any. */
  chosenTitle: string | null;
  /** Decision cards: which option is ahead. */
  verdict: Verdict | null;
  leading: boolean;
  dimmed: boolean;
  faded: boolean;
  /** Guided start: the option being weighed (a ring, without selecting it). */
  guided: boolean;
  /** Just chosen: a ring expands from the card (for about a second). */
  celebrate: boolean;
  /** The first beat of that moment: the card swells slightly, then settles. */
  bump: boolean;
  /** A dragged card or pill would move here on drop. */
  dropTarget: boolean;
  /** Compact view: the pill currently being dragged out of this card. */
  liftedPill: string | null;
  w: number;
  h: number;
  /** Compact view: children drawn as pills inside this card. */
  pills: Item[] | null;
  selectedPill: string | null;
  editing: boolean;
  selectAll: boolean;
  menuOpen: boolean;
  menuIndex: number;
};
export type DNode = Node<DNodeData, 'decision'>;

const GUT_TITLE = { [-1]: 'Feels uneasy', 0: 'Feels neutral', 1: 'Feels good' } as const;

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Dots({
  value,
  onChange,
  size = 'sm',
}: {
  value: number;
  onChange: (v: number) => void;
  size?: 'sm' | 'lg';
}) {
  return (
    <span className={cx('dots nodrag', size === 'lg' && 'dots-lg')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={cx('dot', n <= value && 'on')}
          aria-label={`Impact ${n}`}
          onClick={(e) => {
            e.stopPropagation();
            onChange(n);
          }}
        />
      ))}
    </span>
  );
}

function Balance({ s }: { s: Stats }) {
  const total = s.pro + s.con + s.risk;
  const pct = (v: number) => (total ? `${(v / total) * 100}%` : '0%');
  const missing = s.reqTotal - s.reqMet;
  return (
    <>
      <div className="balance">
        <span className="seg seg-pro" style={{ width: pct(s.pro) }} />
        <span className="seg seg-con" style={{ width: pct(s.con) }} />
        <span className="seg seg-risk" style={{ width: pct(s.risk) }} />
      </div>
      <div className="dn-stats">
        <span className="stat t-pro" title="Pros (total impact)">
          <KindIcon kind="pro" size={11} />
          {s.pro}
        </span>
        <span className="stat t-con" title="Cons (total impact)">
          <KindIcon kind="con" size={11} />
          {s.con}
        </span>
        <span className="stat t-risk" title="Risks (total impact)">
          <KindIcon kind="risk" size={11} />
          {s.risk}
        </span>
        {s.actTotal > 0 && (
          <span className={`stat t-action ${s.actDone === s.actTotal ? 'is-all' : ''}`} title="Actions done">
            <KindIcon kind="action" size={11} />
            {s.actDone}/{s.actTotal}
          </span>
        )}
        <span className="dn-spacer" />
        {s.mustMissing > 0 ? (
          <span className="t-con dn-must">{s.mustMissing} must-have missing</span>
        ) : (
          s.reqTotal > 0 && (
            <span className={missing ? 't-warn' : 't-ok'}>
              {missing ? `${missing} missing` : 'All requirements met'}
            </span>
          )
        )}
      </div>
    </>
  );
}

function VerdictBlock({ v }: { v: Verdict }) {
  const rows = v.rows.length <= 4 ? v.rows : v.rows.slice(0, 3);
  const num = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  return (
    <div className="verdict">
      <VerdictHeadline v={v} className="vd-head" />
      {v.showBars && (
        <div className="vd-rows">
          {rows.map((r) => (
            <div
              key={r.id}
              className={cx(
                'vd-row',
                r.blocked ? 'is-blocked' : r.chosen ? 'is-chosen' : v.state !== 'decided' && r.id === v.leaderId && 'is-lead',
              )}
            >
              <span className="vd-name">
                {r.gut !== undefined && (
                  <span className={`gut-ic gut-${GUT_KEY[r.gut]}`} title={GUT_TITLE[r.gut]}>
                    <GutIcon gut={r.gut} size={11} />
                  </span>
                )}
                <span className="vd-name-tx">{r.title || 'Untitled option'}</span>
              </span>
              <span className="vd-track">
                <span className="vd-bar" style={{ width: `${r.pct}%` }} />
              </span>
              <span className={cx('vd-num', !r.blocked && (r.net > 0 ? 't-pro' : r.net < 0 ? 't-con' : ''))}>
                {r.blocked ? 'Blocked' : num(r.net)}
              </span>
            </div>
          ))}
          {v.rows.length > 4 && <div className="vd-more">+{v.rows.length - 3} more</div>}
        </div>
      )}
    </div>
  );
}

function InlineTitle({ item, selectAll }: { item: Item; selectAll: boolean }) {
  const { update, editKey, stopEdit } = useActions();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (selectAll) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    // Only on mount: the caret should not jump while typing.
  }, []);
  // Grow with the text; the card itself resizes as the title wraps.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [item.title]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={cx('dn-title dn-edit nodrag nowheel nopan')}
      value={item.title}
      placeholder={KINDS[item.kind].placeholder}
      onChange={(e) => update(item.id, { title: e.target.value.replace(/\n/g, ' ') })}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          editKey(item.id, e.key as 'Enter' | 'Escape' | 'Tab');
        }
      }}
      onBlur={stopEdit}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

const isTicked = (p: Item) => (p.kind === 'requirement' && p.met) || (p.kind === 'action' && p.done);
const pillClass = (p: Item) =>
  cx(
    'pill-item',
    isTicked(p) && 'is-ticked',
    p.kind === 'action' && p.done && 'is-done',
    p.kind === 'requirement' && p.must && 'is-must',
  );
const pillStyle = (p: Item) => ({ '--k': `var(--${p.kind})` }) as CSSProperties;

function PillContent({ p }: { p: Item }) {
  return (
    <>
      <span className="pill-ic">{isTicked(p) ? <IconCheck size={10} /> : <KindIcon kind={p.kind} size={11} />}</span>
      <span className={cx('pill-tx', !p.title && 'ph')}>{pillText(p)}</span>
    </>
  );
}

/** A non-interactive copy of a pill (the one that follows the pointer while dragging). */
export function PillFace({ p }: { p: Item }) {
  return (
    <span className={pillClass(p)} style={pillStyle(p)}>
      <PillContent p={p} />
    </span>
  );
}

function Pill({ p, selected, lifted }: { p: Item; selected: boolean; lifted: boolean }) {
  const { select, startEdit, startPillDrag } = useActions();
  return (
    <button
      className={cx(pillClass(p), 'nodrag', selected && 'is-sel', lifted && 'is-lifted')}
      style={pillStyle(p)}
      title={p.kind === 'requirement' && p.must ? `${pillText(p)} · must-have` : pillText(p)}
      onPointerDown={(e) => startPillDrag(p.id, e)}
      onClick={(e) => {
        e.stopPropagation();
        select(p.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        startEdit(p.id);
      }}
    >
      <PillContent p={p} />
    </button>
  );
}

function DecisionNodeImpl({ data, selected }: NodeProps<DNode>) {
  const { item, stats, childCount, optionCount, leading, dimmed, faded, w, h, pills, selectedPill } = data;
  const { add, update, toggleMenu } = useActions();
  const meta = KINDS[item.kind];
  const canAdd = meta.children.length > 0;
  const menu = data.menuOpen;
  const blocked = item.kind === 'option' && isBlocked(stats);

  const style = { width: w, height: h, '--k': `var(--${item.kind})` } as CSSProperties;

  return (
    <div
      className={cx(
        'dn',
        `dn-${item.kind}`,
        selected && 'is-selected',
        data.guided && 'is-guided',
        dimmed && 'is-dimmed',
        faded && 'is-faded',
        data.editing && 'is-editing',
        item.collapsed && childCount > 0 && 'is-collapsed',
        item.chosen && 'is-chosen',
        blocked && 'is-blocked',
        data.celebrate && 'is-celebrating',
        data.bump && 'is-bumped',
        data.dropTarget && 'is-drop-target',
      )}
      style={style}
    >
      <Handle type="target" position={Position.Left} className="dn-handle" isConnectable={false} />

      <div className="dn-head">
        <span className="dn-chip">
          <KindIcon kind={item.kind} size={14} />
        </span>
        <span className="dn-kind">{meta.label}</span>
        {item.kind === 'requirement' && item.must && <span className="badge badge-must">Must-have</span>}
        {item.chosen && (
          <span className="badge badge-chosen">
            <IconCheck size={11} /> Chosen
          </span>
        )}
        {blocked && !item.chosen && <span className="badge badge-blocked">Blocked</span>}
        {leading && !item.chosen && !blocked && <span className="badge badge-lead">Leading</span>}
        {item.kind === 'option' && item.gut !== undefined && (
          <span className={`gut-ic dn-gut gut-${GUT_KEY[item.gut]}`} title={GUT_TITLE[item.gut]}>
            <GutIcon gut={item.gut} size={14} />
          </span>
        )}
        <span className="dn-spacer" />

        {isWeighted(item.kind) && (
          <Dots value={item.weight} onChange={(v) => update(item.id, { weight: v })} />
        )}
        {item.kind === 'requirement' && (
          <button
            className={cx('check nodrag', item.met && 'on')}
            aria-label={item.met ? 'Mark as missing' : 'Mark as met'}
            onClick={(e) => {
              e.stopPropagation();
              update(item.id, { met: !item.met });
            }}
          >
            <IconCheck size={12} />
          </button>
        )}
        {item.kind === 'action' && (
          <button
            className={cx('check nodrag', item.done && 'on')}
            aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
            onClick={(e) => {
              e.stopPropagation();
              update(item.id, { done: !item.done });
            }}
          >
            <IconCheck size={12} />
          </button>
        )}
        {childCount > 0 && (
          <button
            className={cx('collapse nodrag', item.collapsed && 'closed')}
            aria-label={item.collapsed ? 'Expand branch' : 'Collapse branch'}
            onClick={(e) => {
              e.stopPropagation();
              update(item.id, { collapsed: !item.collapsed });
            }}
          >
            {item.collapsed && <span>{childCount}</span>}
            <IconChevron size={12} />
          </button>
        )}
      </div>

      {data.editing ? (
        <InlineTitle item={item} selectAll={data.selectAll} />
      ) : (
        <div className={cx('dn-title', item.kind === 'action' && item.done && 'is-done')}>
          {item.title || <span className="ph">{meta.placeholder}</span>}
        </div>
      )}

      {item.kind === 'option' && stats && <Balance s={stats} />}
      {pills && pills.length > 0 && (
        <div className="pills">
          {pills.map((p) => (
            <Pill key={p.id} p={p} selected={p.id === selectedPill} lifted={p.id === data.liftedPill} />
          ))}
        </div>
      )}
      {item.kind === 'problem' && showsVerdict(data.verdict) && <VerdictBlock v={data.verdict} />}
      {item.kind === 'problem' && !showsVerdict(data.verdict) && (
        <div className="dn-foot">
          {data.chosenTitle !== null ? (
            <span className="dn-decided">
              <IconCheck size={11} /> {data.chosenTitle || 'Untitled option'}
            </span>
          ) : optionCount === 0 ? (
            'No options yet'
          ) : (
            `${optionCount} option${optionCount === 1 ? '' : 's'}`
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="dn-handle" isConnectable={false} />

      {canAdd && (
        <button
          className={cx('dn-add nodrag', menu && 'open')}
          aria-label="Add branch"
          onClick={(e) => {
            e.stopPropagation();
            toggleMenu(item.id);
          }}
        >
          <IconPlus size={14} />
        </button>
      )}

      {menu && (
        <div className="menu glass nodrag nowheel" onClick={(e) => e.stopPropagation()}>
          {meta.children.map((k, i) => (
            <button
              key={k}
              className={cx('menu-item', i === data.menuIndex && 'is-hi')}
              style={{ '--k': `var(--${k})` } as CSSProperties}
              onClick={() => add(item.id, k)}
            >
              <span className="dn-chip">
                <KindIcon kind={k} size={13} />
              </span>
              {KINDS[k].addLabel}
              <kbd className="menu-kbd">{i + 1}</kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const DecisionNode = memo(DecisionNodeImpl);
