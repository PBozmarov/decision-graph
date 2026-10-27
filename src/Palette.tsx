import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { kindLabel, type Item, type Kind } from './model';
import type { Doc } from './store';
import { ago, summary } from './summary';
import { IconCheck, IconSearch, KindIcon } from './icons';

/** What the palette jumps to: a whole decision (`itemId` null) or one card in it. */
export type PaletteResult = { docId: string; itemId: string | null };

/* ---------- matching ---------- */

/** Case- and accent-folded text, with where each folded character came from (for highlighting). */
type Folded = { text: string; from: number[] };
function fold(s: string): Folded {
  let text = '';
  const from: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = ch.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    for (let k = 0; k < f.length; k++) from.push(i);
    text += f;
    i += ch.length;
  }
  from.push(s.length);
  return { text, from };
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
/** Where `w` starts a word in `t`, or -1. */
function wordStart(t: string, w: string) {
  for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) if (!isWordChar(t[i - 1])) return i;
  return -1;
}

/** 3 query is a title prefix · 2 every word starts a title word · 1 title substring · 0.5 notes only · 0 no match. */
function score(title: string, notes: string, q: string, words: string[]) {
  if (words.every((w) => title.includes(w))) {
    if (title.startsWith(q)) return 3;
    if (words.every((w) => wordStart(title, w) >= 0)) return 2;
    return 1;
  }
  return words.every((w) => title.includes(w) || notes.includes(w)) ? 0.5 : 0;
}

/** `text` with every matched word in bold. */
function Hl({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const f = fold(text);
  const ranges: [number, number][] = [];
  for (const w of words) {
    let i = wordStart(f.text, w);
    if (i < 0) i = f.text.indexOf(w);
    if (i >= 0) ranges.push([f.from[i], f.from[i + w.length]]);
  }
  if (!ranges.length) return <>{text}</>;
  ranges.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (b <= at) continue;
    const s = Math.max(a, at);
    if (s > at) out.push(text.slice(at, s));
    out.push(
      <span key={s} className="pal-hl">
        {text.slice(s, b)}
      </span>,
    );
    at = b;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}

/** A short piece of the notes around the first match. */
function snippet(notes: string, words: string[]) {
  const f = fold(notes);
  const hits = words.map((w) => f.text.indexOf(w)).filter((i) => i >= 0);
  const at = hits.length ? f.from[Math.min(...hits)] : 0;
  let start = Math.max(0, at - 28);
  if (start > 0) {
    const space = notes.lastIndexOf(' ', at);
    start = space >= start ? space + 1 : start;
  }
  const end = Math.min(notes.length, start + 120);
  return `${start > 0 ? '…' : ''}${notes.slice(start, end).replace(/\s+/g, ' ').trim()}${end < notes.length ? '…' : ''}`;
}

/* ---------- index ---------- */

type DocEntry = { doc: Doc; title: string; root: Item | null; t: string };
type CardEntry = { doc: Doc; docTitle: string; item: Item; parentKind: Kind | null; t: string; n: string };

function buildIndex(docs: Doc[]) {
  const decisions: DocEntry[] = [];
  const cards: CardEntry[] = [];
  for (const doc of docs) {
    const root = doc.items.find((i) => i.parentId === null && i.kind === 'problem') ?? null;
    const title = summary(doc).title;
    decisions.push({ doc, title, root, t: fold(root?.title ?? '').text });
    const kindOf = new Map(doc.items.map((i) => [i.id, i.kind]));
    for (const item of doc.items)
      cards.push({
        doc,
        docTitle: title,
        item,
        parentKind: kindOf.get(item.parentId ?? '') ?? null,
        t: fold(item.title).text,
        n: fold(item.notes).text,
      });
  }
  return { decisions, cards };
}

type Row =
  | { type: 'doc'; key: string; entry: DocEntry; current: boolean }
  | { type: 'card'; key: string; entry: CardEntry; notesOnly: boolean };

const k = (kind: Kind) => ({ '--k': `var(--${kind})` }) as CSSProperties;

/** Spotlight-style "jump to" across every decision and every card in them. */
export function Palette({
  docs,
  activeId,
  onPick,
  onClose,
}: {
  docs: Doc[];
  activeId: string;
  onPick: (r: PaletteResult) => void;
  onClose: () => void;
}) {
  // Built once per opening; edits made while it's open don't matter for a jump.
  const [index] = useState(() => buildIndex(docs));
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Esc or a click outside hands focus back to where it was (e.g. the inspector title).
  const [before] = useState(() => document.activeElement as HTMLElement | null);
  const dismiss = () => {
    onClose();
    before?.focus({ preventScroll: true });
  };

  const words = fold(query).text.trim().split(/\s+/).filter(Boolean);
  const q = words.join(' ');
  const recent = (a: Doc, b: Doc) => b.updatedAt - a.updatedAt;

  const groups: { title: string; rows: Row[] }[] = [];
  if (!words.length) {
    const rows = index.decisions
      .slice()
      .sort((a, b) => recent(a.doc, b.doc))
      .slice(0, 6)
      .map((entry): Row => ({ type: 'doc', key: entry.doc.id, entry, current: entry.doc.id === activeId }));
    groups.push({ title: 'Recent', rows });
  } else {
    const byScore = <T extends { doc: Doc }>(list: { e: T; s: number }[]) =>
      list.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || recent(a.e.doc, b.e.doc));
    const decisions = byScore(index.decisions.map((e) => ({ e, s: score(e.t, '', q, words) }))).slice(0, 5); // titles only
    const listed = new Set(decisions.map((d) => d.e.root?.id));
    const cards = byScore(index.cards.filter((e) => !listed.has(e.item.id)).map((e) => ({ e, s: score(e.t, e.n, q, words) }))).slice(0, 12);
    if (decisions.length)
      groups.push({
        title: 'Decisions',
        rows: decisions.map(({ e }): Row => ({ type: 'doc', key: e.doc.id, entry: e, current: e.doc.id === activeId })),
      });
    if (cards.length)
      groups.push({
        title: 'Cards',
        rows: cards.map(({ e, s }): Row => ({ type: 'card', key: `${e.doc.id}:${e.item.id}`, entry: e, notesOnly: s < 1 })),
      });
  }
  const rows = groups.flatMap((g) => g.rows);
  const at = Math.min(active, rows.length - 1);

  const pick = (r: Row | undefined) => {
    if (!r) return;
    onPick(r.type === 'doc' ? { docId: r.entry.doc.id, itemId: null } : { docId: r.entry.doc.id, itemId: r.entry.item.id });
  };

  useEffect(() => {
    input.current?.focus();
  }, []);
  // Keep the active row in view while moving with the keyboard.
  useEffect(() => {
    list.current?.querySelector('.pal-row.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [at, query]);

  let n = 0;
  return (
    <div
      className="pal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        className="pal glass"
        role="dialog"
        aria-label="Search decisions and cards"
        // Clicks inside keep the focus in the input (so Esc and the arrows keep working).
        onMouseDown={(e) => {
          if (e.target !== input.current) e.preventDefault();
        }}
      >
        <div className="pal-input">
          <IconSearch size={19} />
          <input
            ref={input}
            value={query}
            placeholder="Search decisions and cards"
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded
            aria-controls="pal-list"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                dismiss();
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (rows.length) setActive((at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(rows[at]);
              }
            }}
          />
          <span className="kbd-hint pal-esc">esc</span>
        </div>

        <div className="pal-list" id="pal-list" role="listbox" ref={list}>
          {rows.length === 0 && <div className="pal-empty">No matches for “{query.trim()}”</div>}
          {groups.map((g) => (
            <div key={g.title} className="pal-group" role="group" aria-label={g.title}>
              <div className="pal-group-title">{g.title}</div>
              {g.rows.map((r) => {
                const i = n++;
                return (
                  <div
                    key={r.key}
                    role="option"
                    aria-selected={i === at}
                    className={`pal-row ${i === at ? 'is-active' : ''}`}
                    onMouseMove={() => i !== at && setActive(i)}
                    onClick={() => pick(r)}
                  >
                    {r.type === 'doc' ? <DocRow r={r} words={words} /> : <CardRow r={r} words={words} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DocRow({ r, words }: { r: Extract<Row, { type: 'doc' }>; words: string[] }) {
  const s = summary(r.entry.doc);
  return (
    <>
      <span className="dn-chip" style={k('problem')}>
        <KindIcon kind="problem" size={14} />
      </span>
      <div className="pal-text">
        <div className="pal-title">{r.entry.root?.title ? <Hl text={r.entry.root.title} words={words} /> : r.entry.title}</div>
        <div className="side-meta">
          {s.chosen ? (
            <span className="side-chosen">
              <IconCheck size={11} /> {s.chosen}
            </span>
          ) : (
            <span>{s.options ? `${s.options} option${s.options === 1 ? '' : 's'}` : 'No options yet'}</span>
          )}
          <span className="side-dot" />
          <span>{ago(r.entry.doc.updatedAt)}</span>
        </div>
      </div>
      {r.current && <span className="pal-tag">Current</span>}
    </>
  );
}

function CardRow({ r, words }: { r: Extract<Row, { type: 'card' }>; words: string[] }) {
  const it = r.entry.item;
  return (
    <>
      <span className="dn-chip" style={k(it.kind)}>
        <KindIcon kind={it.kind} size={14} />
      </span>
      <div className="pal-text">
        <div className="pal-title">
          {it.title ? <Hl text={it.title} words={words} /> : <span className="ph">Untitled {kindLabel(it.kind, r.entry.parentKind).toLowerCase()}</span>}
        </div>
        <div className="side-meta">
          <span>
            {r.notesOnly ? <Hl text={snippet(it.notes, words)} words={words} /> : <>in {r.entry.docTitle}</>}
          </span>
        </div>
      </div>
    </>
  );
}
