import { memo, useEffect, useRef, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { KINDS, isWeighted, type Item, type Stats } from './model';
import { pillText } from './compact';
import { useActions } from './actions';
import { IconCheck, IconChevron, IconPlus, KindIcon } from './icons';

export type DNodeData = {
  item: Item;
  stats: Stats | null;
  childCount: number;
  optionCount: number;
  leading: boolean;
  dimmed: boolean;
  faded: boolean;
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
        <span className="t-pro">+{s.pro}</span>
        <span className="t-con">−{s.con}</span>
        <span className="t-risk">!{s.risk}</span>
        <span className="dn-spacer" />
        {s.reqTotal > 0 && (
          <span className={missing ? 't-warn' : 't-ok'}>
            {missing ? `${missing} missing` : 'All requirements met'}
          </span>
        )}
      </div>
    </>
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
  return (
    <textarea
      ref={ref}
      rows={2}
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

function Pill({ p, selected }: { p: Item; selected: boolean }) {
  const { select, startEdit } = useActions();
  const ticked = (p.kind === 'requirement' && p.met) || (p.kind === 'action' && p.done);
  return (
    <button
      className={cx('pill-item nodrag', selected && 'is-sel', ticked && 'is-ticked', p.kind === 'action' && p.done && 'is-done')}
      style={{ '--k': `var(--${p.kind})` } as CSSProperties}
      title={pillText(p)}
      onClick={(e) => {
        e.stopPropagation();
        select(p.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        startEdit(p.id);
      }}
    >
      <span className="pill-ic">{ticked ? <IconCheck size={10} /> : <KindIcon kind={p.kind} size={11} />}</span>
      <span className={cx('pill-tx', !p.title && 'ph')}>{pillText(p)}</span>
    </button>
  );
}

function DecisionNodeImpl({ data, selected }: NodeProps<DNode>) {
  const { item, stats, childCount, optionCount, leading, dimmed, faded, w, h, pills, selectedPill } = data;
  const { add, update, toggleMenu } = useActions();
  const meta = KINDS[item.kind];
  const canAdd = meta.children.length > 0;
  const menu = data.menuOpen;

  const style = { width: w, height: h, '--k': `var(--${item.kind})` } as CSSProperties;

  return (
    <div
      className={cx(
        'dn',
        `dn-${item.kind}`,
        selected && 'is-selected',
        dimmed && 'is-dimmed',
        faded && 'is-faded',
        data.editing && 'is-editing',
        item.collapsed && childCount > 0 && 'is-collapsed',
        item.chosen && 'is-chosen',
      )}
      style={style}
    >
      <Handle type="target" position={Position.Left} className="dn-handle" isConnectable={false} />

      <div className="dn-head">
        <span className="dn-chip">
          <KindIcon kind={item.kind} size={14} />
        </span>
        <span className="dn-kind">{meta.label}</span>
        {item.chosen && (
          <span className="badge badge-chosen">
            <IconCheck size={11} /> Chosen
          </span>
        )}
        {leading && !item.chosen && <span className="badge badge-lead">Leading</span>}
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
            <Pill key={p.id} p={p} selected={p.id === selectedPill} />
          ))}
        </div>
      )}
      {item.kind === 'problem' && (
        <div className="dn-foot">
          {optionCount === 0
            ? 'No options yet'
            : `${optionCount} option${optionCount === 1 ? '' : 's'}`}
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
