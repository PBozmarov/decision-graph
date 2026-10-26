import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { GUT_KEY, groupChildren, isBlocked, optionStats, verdictOf, type Item, type Kind, type Stats } from './model';
import { GutIcon, IconCheck, IconClose, KindIcon } from './icons';
import { VerdictHeadline } from './Verdict';

const ROWS: { kind: Kind; title: string }[] = [
  { kind: 'requirement', title: 'Needs' },
  { kind: 'pro', title: 'Pros' },
  { kind: 'con', title: 'Cons' },
  { kind: 'risk', title: 'Risks' },
  { kind: 'action', title: 'Actions' },
];

const GUT_LABEL = { [-1]: 'Feels uneasy', 0: 'Neutral', 1: 'Feels good' } as const;

const k = (kind: string) => ({ '--k': `var(--${kind})` }) as CSSProperties;

function Entry({ it }: { it: Item }) {
  const ticked = (it.kind === 'requirement' && it.met) || (it.kind === 'action' && it.done);
  const weighted = it.kind === 'pro' || it.kind === 'con' || it.kind === 'risk';
  return (
    <li className={`cmp-entry ${it.kind === 'action' && it.done ? 'is-done' : ''}`} style={k(it.kind)}>
      <span className={`cmp-ic ${ticked ? 'is-ticked' : ''}`}>
        {ticked ? <IconCheck size={10} /> : <KindIcon kind={it.kind} size={12} />}
      </span>
      <span className="cmp-tx">{it.title || <span className="ph">Untitled</span>}</span>
      {it.kind === 'requirement' && it.must && <span className="cmp-must">Must</span>}
      {weighted && (
        <span className="cmp-w" aria-label={`Impact ${it.weight} of 5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <i key={n} className={n <= it.weight ? 'on' : ''} />
          ))}
        </span>
      )}
    </li>
  );
}

export function Compare({
  problem,
  items,
  onChoose,
  onClose,
}: {
  problem: Item;
  items: Item[];
  onChoose: (optionId: string) => void;
  onClose: () => void;
}) {
  const kids = useMemo(() => groupChildren(items), [items]);
  const options = (kids.get(problem.id) ?? []).filter((c) => c.kind === 'option');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = options.filter((o) => !hidden.has(o.id));

  const stats = useMemo(() => {
    const m = new Map<string, Stats>();
    for (const o of options) m.set(o.id, optionStats(kids.get(o.id) ?? []));
    return m;
  }, [options, kids]);

  // Same verdict as the decision card, but over the options currently shown.
  const verdict = verdictOf(shown, (id) => stats.get(id)!);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The search palette may sit on top; its own Escape comes first.
      if (e.key === 'Escape' && !document.querySelector('.pal-backdrop')) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="cmp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="cmp glass" role="dialog" aria-label="Compare options">
        <header className="cmp-head">
          <div>
            <div className="cmp-eyebrow">Compare options</div>
            <h2>{problem.title || 'Untitled decision'}</h2>
            <VerdictHeadline v={verdict} className="cmp-verdict" />
          </div>
          <button className="icon-btn cmp-close" onClick={onClose} aria-label="Close">
            <IconClose size={15} />
          </button>
        </header>

        <div className="cmp-toggles">
          {options.map((o) => {
            const on = !hidden.has(o.id);
            return (
              <button
                key={o.id}
                className={`cmp-toggle ${on ? 'is-on' : ''}`}
                aria-pressed={on}
                onClick={() =>
                  setHidden((h) => {
                    const n = new Set(h);
                    if (n.has(o.id)) n.delete(o.id);
                    else if (options.length - n.size > 1) n.add(o.id); // keep at least one
                    return n;
                  })
                }
              >
                <span className="cmp-box">{on && <IconCheck size={10} />}</span>
                {o.title || 'Untitled option'}
              </button>
            );
          })}
        </div>

        <div className="cmp-scroll">
          <div className="cmp-grid" style={{ gridTemplateColumns: `96px repeat(${shown.length}, minmax(220px, 1fr))` }}>
            {/* header row */}
            <div className="cmp-rowlabel" />
            {shown.map((o) => {
              const s = stats.get(o.id)!;
              const total = s.pro + s.con + s.risk;
              const pct = (v: number) => (total ? `${(v / total) * 100}%` : '0%');
              const isBest = verdict.leaderId === o.id;
              return (
                <div key={o.id} className={`cmp-col-head ${o.chosen ? 'is-chosen' : ''}`}>
                  <div className="cmp-opt">
                    <span className="dn-chip" style={k('option')}>
                      <KindIcon kind="option" size={13} />
                    </span>
                    <span className="cmp-opt-title">{o.title || 'Untitled option'}</span>
                  </div>
                  <div className="cmp-net">
                    <b className={s.net > 0 ? 't-pro' : s.net < 0 ? 't-con' : ''}>{s.net > 0 ? `+${s.net}` : s.net}</b>
                    <span>net score</span>
                    {isBest && <span className="badge badge-lead">Best</span>}
                    {o.chosen && (
                      <span className="badge badge-chosen">
                        <IconCheck size={11} /> Chosen
                      </span>
                    )}
                    {isBlocked(s) && <span className="badge badge-blocked">Blocked</span>}
                    {o.gut !== undefined && (
                      <span className={`cmp-gut gut-ic gut-${GUT_KEY[o.gut]}`}>
                        <GutIcon gut={o.gut} size={13} />
                        {GUT_LABEL[o.gut]}
                      </span>
                    )}
                  </div>
                  <div className="balance">
                    <span className="seg seg-pro" style={{ width: pct(s.pro) }} />
                    <span className="seg seg-con" style={{ width: pct(s.con) }} />
                    <span className="seg seg-risk" style={{ width: pct(s.risk) }} />
                  </div>
                </div>
              );
            })}

            {ROWS.map((row) => {
              if (!shown.some((o) => (kids.get(o.id) ?? []).some((c) => c.kind === row.kind))) return null;
              return (
                <div className="cmp-row" key={row.kind} style={{ display: 'contents' }}>
                  <div className="cmp-rowlabel" style={k(row.kind)}>
                    <KindIcon kind={row.kind} size={13} />
                    {row.title}
                  </div>
                  {shown.map((o) => {
                    const list = (kids.get(o.id) ?? []).filter((c) => c.kind === row.kind);
                    const s = stats.get(o.id)!;
                    const sum =
                      row.kind === 'requirement'
                        ? `${s.reqMet}/${s.reqTotal} met`
                        : row.kind === 'action'
                          ? `${list.filter((c) => c.done).length}/${list.length} done`
                          : list.length
                            ? `${list.reduce((t, c) => t + c.weight, 0)} pts`
                            : '';
                    return (
                      <div key={o.id} className="cmp-cell">
                        {list.length ? (
                          <>
                            <div className="cmp-sum" style={k(row.kind)}>
                              {sum}
                              {row.kind === 'requirement' && s.mustMissing > 0 && (
                                <span className="t-con"> · {s.mustMissing} must-have missing</span>
                              )}
                            </div>
                            <ul>
                              {list.map((it) => (
                                <Entry key={it.id} it={it} />
                              ))}
                            </ul>
                          </>
                        ) : (
                          <span className="cmp-none">None</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            <div className="cmp-rowlabel" />
            {shown.map((o) => (
              <div key={o.id} className="cmp-cell cmp-foot">
                <button className={`btn-primary ${o.chosen ? 'is-on' : ''}`} onClick={() => onChoose(o.id)}>
                  {o.chosen ? (
                    <>
                      <IconCheck size={15} /> Chosen
                    </>
                  ) : (
                    'Choose'
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>

        {options.length < 2 && (
          <p className="cmp-empty">Add at least two options to compare them.</p>
        )}
      </section>
    </div>
  );
}
