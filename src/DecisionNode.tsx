import { memo, useEffect, useState, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { KINDS, SIZE, isWeighted, type Item, type Stats } from './model';
import { useActions } from './actions';
import { IconCheck, IconChevron, IconPlus, KindIcon } from './icons';

export type DNodeData = {
  item: Item;
  stats: Stats | null;
  childCount: number;
  optionCount: number;
  leading: boolean;
  dimmed: boolean;
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

function DecisionNodeImpl({ data, selected }: NodeProps<DNode>) {
  const { item, stats, childCount, optionCount, leading, dimmed } = data;
  const { add, update, select } = useActions();
  const [menu, setMenu] = useState(false);
  const meta = KINDS[item.kind];
  const { w, h } = SIZE[item.kind];
  const canAdd = meta.children.length > 0;

  useEffect(() => {
    if (!selected) setMenu(false);
  }, [selected]);

  const style = { width: w, height: h, '--k': `var(--${item.kind})` } as CSSProperties;

  return (
    <div
      className={cx(
        'dn',
        `dn-${item.kind}`,
        selected && 'is-selected',
        dimmed && 'is-dimmed',
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

      <div className={cx('dn-title', item.kind === 'action' && item.done && 'is-done')}>
        {item.title || <span className="ph">{meta.placeholder}</span>}
      </div>

      {item.kind === 'option' && stats && <Balance s={stats} />}
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
            if (!selected) select(item.id);
            setMenu((m) => !m);
          }}
        >
          <IconPlus size={14} />
        </button>
      )}

      {menu && (
        <div className="menu glass nodrag nowheel" onClick={(e) => e.stopPropagation()}>
          {meta.children.map((k) => (
            <button
              key={k}
              className="menu-item"
              style={{ '--k': `var(--${k})` } as CSSProperties}
              onClick={() => {
                setMenu(false);
                add(item.id, k);
              }}
            >
              <span className="dn-chip">
                <KindIcon kind={k} size={13} />
              </span>
              {KINDS[k].addLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const DecisionNode = memo(DecisionNodeImpl);
