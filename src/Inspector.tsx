import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { KINDS, isWeighted, type Item, type Stats } from './model';
import { Dots } from './DecisionNode';
import { IconCheck, IconClose, IconTrash, KindIcon } from './icons';

const IMPACT = ['', 'Minor', 'Low', 'Moderate', 'High', 'Critical'];

function AutoText({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
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

export function Inspector({
  item,
  stats,
  fresh,
  onUpdate,
  onAdd,
  onChoose,
  onDelete,
  onClose,
}: {
  item: Item;
  stats: Stats | null;
  fresh: boolean;
  onUpdate: (patch: Partial<Item>) => void;
  onAdd: (kind: Item['kind']) => void;
  onChoose: () => void;
  onDelete: () => void;
  onClose: () => void;
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
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <IconClose size={14} />
        </button>
      </header>

      <AutoText
        className="insp-title"
        value={item.title}
        placeholder={meta.placeholder}
        onChange={(v) => onUpdate({ title: v })}
        autoFocus={fresh}
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

      <footer className="insp-foot">
        <button className="btn-danger" onClick={onDelete}>
          <IconTrash size={14} /> Delete{meta.children.length ? ' branch' : ''}
        </button>
        <span className="kbd-hint">⌫</span>
      </footer>
    </aside>
  );
}
