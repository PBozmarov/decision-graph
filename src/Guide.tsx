import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { optionStats, type Item, type Kind } from './model';
import { Dots } from './DecisionNode';
import { IconClose, KindIcon } from './icons';

export type GuideState = { problemId: string; step: 'options' | 'weigh'; index: number };

type Store = {
  add: (parentId: string, kind: Kind, title: string) => string;
  update: (id: string, patch: Partial<Item>) => void;
  remove: (id: string) => void;
};

type ListHandle = { commit: () => void };

const k = (kind: string) => ({ '--k': `var(--${kind})` }) as CSSProperties;

/** Editable list of one kind of child: every row is a real card, the trailing ghost input adds the next one. */
function GuideList({
  kind,
  parentId,
  items,
  placeholder,
  weighted = false,
  autoFocus = false,
  store,
  onGhost,
  ref,
}: {
  kind: Kind;
  parentId: string;
  items: Item[];
  placeholder: string;
  weighted?: boolean;
  autoFocus?: boolean;
  store: Store;
  onGhost?: (v: string) => void;
  ref?: Ref<ListHandle>;
}) {
  const [ghost, setGhostState] = useState('');
  const setGhost = (v: string) => {
    setGhostState(v);
    onGhost?.(v);
  };
  const rows = useRef(new Map<string, HTMLInputElement>());
  const ghostRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) ghostRef.current?.focus();
  }, [autoFocus]);

  // New rows push the ghost down; keep it in view while typing (the phone sheet scrolls).
  useEffect(() => {
    const el = ghostRef.current;
    if (el && el === document.activeElement) el.scrollIntoView({ block: 'nearest' });
  }, [items.length]);

  const addLines = (lines: string[]) => {
    for (const l of lines.map((s) => s.trim()).filter(Boolean)) store.add(parentId, kind, l);
  };

  useImperativeHandle(ref, () => ({
    commit: () => {
      if (ghost.trim()) addLines([ghost]);
      setGhost('');
    },
  }));

  // Row i, or the ghost input past the end.
  const focusAt = (i: number) => {
    const el = i >= 0 && i < items.length ? rows.current.get(items[i].id) : i >= items.length ? ghostRef.current : null;
    el?.focus();
  };

  return (
    <div className="guide-list" style={k(kind)}>
      {items.map((it, i) => (
        <div key={it.id} className="guide-row">
          <span className="dn-chip">
            <KindIcon kind={kind} size={13} />
          </span>
          <input
            ref={(el) => {
              if (el) rows.current.set(it.id, el);
              else rows.current.delete(it.id);
            }}
            value={it.title}
            placeholder={`Untitled ${kind}`}
            onChange={(e) => store.update(it.id, { title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                focusAt(i + 1);
              } else if (e.key === 'Backspace' && !it.title) {
                e.preventDefault();
                store.remove(it.id);
                if (i > 0) focusAt(i - 1);
                else ghostRef.current?.focus();
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                focusAt(i - 1);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusAt(i + 1);
              }
            }}
          />
          {weighted && <Dots value={it.weight} onChange={(v) => store.update(it.id, { weight: v })} />}
          <button className="guide-del" aria-label="Remove" onClick={() => store.remove(it.id)}>
            <IconClose size={12} />
          </button>
        </div>
      ))}
      <div className="guide-row guide-ghost">
        <span className="dn-chip">
          <KindIcon kind={kind} size={13} />
        </span>
        <input
          ref={ghostRef}
          value={ghost}
          placeholder={placeholder}
          onChange={(e) => setGhost(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (ghost.trim()) addLines([ghost]);
              setGhost('');
            } else if (e.key === 'ArrowUp' || (e.key === 'Backspace' && !ghost)) {
              if (!items.length) return;
              e.preventDefault();
              focusAt(items.length - 1);
            }
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (!/[\r\n]/.test(text)) return;
            // Several lines pasted: one card per line.
            e.preventDefault();
            const el = e.currentTarget;
            const merged = ghost.slice(0, el.selectionStart ?? ghost.length) + text + ghost.slice(el.selectionEnd ?? ghost.length);
            addLines(merged.split(/\r?\n/));
            setGhost('');
          }}
        />
      </div>
    </div>
  );
}

/** Two calm steps after "Start": list the options, then weigh each one. Cards appear live on the canvas. */
export function Guide({
  problem,
  options,
  childrenOf,
  guide,
  setGuide,
  store,
  onDone,
  onSkip,
}: {
  problem: Item;
  options: Item[];
  childrenOf: (id: string) => Item[];
  guide: GuideState;
  setGuide: (g: GuideState) => void;
  store: Store;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [pending, setPending] = useState('');
  const optList = useRef<ListHandle>(null);
  const proList = useRef<ListHandle>(null);
  const conList = useRef<ListHandle>(null);
  const weigh = guide.step === 'weigh';
  const option = weigh ? options[guide.index] : undefined;
  const last = guide.index >= options.length - 1;

  const commitWeigh = () => {
    proList.current?.commit();
    conList.current?.commit();
  };

  let body: ReactNode;
  if (!weigh) {
    body = (
      <>
        <div className="guide-intro">
          <div className="dn-kind guide-eyebrow">Options</div>
          <h2 className="guide-title">What are your options?</h2>
          <p className="guide-sub">Add each path you're considering. Every line becomes a card.</p>
        </div>
        <div className="guide-context" style={k('problem')}>
          <span className="dn-chip">
            <KindIcon kind="problem" size={12} />
          </span>
          <span className="guide-context-title">{problem.title || 'Untitled decision'}</span>
        </div>
        <GuideList
          ref={optList}
          kind="option"
          parentId={problem.id}
          items={options}
          placeholder={options.length ? 'Another option…' : 'First option…'}
          autoFocus
          store={store}
          onGhost={setPending}
        />
      </>
    );
  } else if (option) {
    const kids = childrenOf(option.id);
    const s = optionStats(kids);
    const total = s.pro + s.con + s.risk;
    const pct = (v: number) => (total ? `${(v / total) * 100}%` : '0%');
    body = (
      <>
        <div className="guide-intro">
          <div className="dn-kind guide-eyebrow">
            Weigh · Option {guide.index + 1} of {options.length}
          </div>
          <h2 className="guide-title">{option.title || 'Untitled option'}</h2>
          <p className="guide-sub">What's good about it, and what's the catch? Rate how much each one matters.</p>
        </div>
        <section className="guide-section">
          <div className="insp-label guide-label" style={k('pro')}>
            <span>
              <KindIcon kind="pro" size={13} /> Pros
            </span>
          </div>
          <GuideList
            ref={proList}
            kind="pro"
            parentId={option.id}
            items={kids.filter((c) => c.kind === 'pro')}
            placeholder="Add a pro…"
            weighted
            autoFocus
            store={store}
          />
        </section>
        <section className="guide-section">
          <div className="insp-label guide-label" style={k('con')}>
            <span>
              <KindIcon kind="con" size={13} /> Cons
            </span>
          </div>
          <GuideList
            ref={conList}
            kind="con"
            parentId={option.id}
            items={kids.filter((c) => c.kind === 'con')}
            placeholder="Add a con…"
            weighted
            store={store}
          />
        </section>
        <div className="guide-result">
          <div className="balance">
            <span className="seg seg-pro" style={{ width: pct(s.pro) }} />
            <span className="seg seg-con" style={{ width: pct(s.con) }} />
            <span className="seg seg-risk" style={{ width: pct(s.risk) }} />
          </div>
          <div className="net">
            Net
            <b className={s.net > 0 ? 't-pro' : s.net < 0 ? 't-con' : ''}>{s.net > 0 ? `+${s.net}` : s.net}</b>
          </div>
        </div>
      </>
    );
  }

  return (
    <aside className="inspector guide glass" aria-label="Guided start">
      <header className="guide-head">
        <span className="guide-steps" aria-label={weigh ? 'Step 2 of 2' : 'Step 1 of 2'}>
          <i className={!weigh ? 'on' : ''} />
          <i className={weigh ? 'on' : ''} />
        </span>
        <span className="dn-spacer" />
        <button className="guide-skip" onClick={onSkip}>
          Skip
        </button>
      </header>

      {/* Remount per step/option so the first input takes focus and the content fades in. */}
      <div className="guide-body" key={`${guide.step}-${option?.id ?? ''}`}>
        {body}
      </div>

      <footer className="guide-foot">
        {!weigh ? (
          <>
            <button
              className="btn-primary"
              disabled={!options.length && !pending.trim()}
              onClick={() => {
                optList.current?.commit();
                setPending('');
                setGuide({ ...guide, step: 'weigh', index: 0 });
              }}
            >
              Next: weigh them
            </button>
            <span className="guide-tip">
              <kbd>↵</kbd> adds the next one
            </span>
          </>
        ) : (
          <div className="guide-nav">
            <button
              className="btn-secondary"
              onClick={() => {
                commitWeigh();
                setGuide(guide.index === 0 ? { ...guide, step: 'options', index: 0 } : { ...guide, index: guide.index - 1 });
              }}
            >
              Back
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                commitWeigh();
                if (last) onDone();
                else setGuide({ ...guide, index: guide.index + 1 });
              }}
            >
              {last ? 'Done' : 'Next option'}
            </button>
          </div>
        )}
      </footer>
    </aside>
  );
}
