import { KINDS, SIZE, PILL_KINDS, type Item, type Kind, type Size } from './model';

// Pill geometry — must match .pill-item in index.css.
export const PILL_H = 22;
export const PILL_GAP = 5;
const PILL_CHROME = 7 + 12 + 5 + 9; // left pad + icon + gap + right pad
const PILLS_TOP = 10; // space above the pill block
const INNER_W = SIZE.option.w - 28 - 4; // card padding, plus a little slack
export const PILL_MAX = INNER_W;
const FONT = '560 11.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif';

let ctx: CanvasRenderingContext2D | null = null;
function textWidth(t: string, font = FONT) {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return t.length * 6.5;
  ctx.font = font;
  return ctx.measureText(t).width;
}

export const pillText = (it: Item) => it.title || `Untitled ${KINDS[it.kind].label.toLowerCase()}`;

export function pillWidth(it: Item) {
  return Math.min(PILL_MAX, Math.ceil(textWidth(pillText(it))) + PILL_CHROME);
}

/** Number of wrapped rows the pills take inside an option card. */
export function pillRows(pills: Item[]) {
  let rows = 0;
  let x = 0;
  for (const p of pills) {
    const w = pillWidth(p);
    if (rows === 0 || x + w > INNER_W) {
      rows++;
      x = w + PILL_GAP;
    } else x += w + PILL_GAP;
  }
  return rows;
}

/* ---------- card titles ---------- */

// Title typography per card type — must match .dn-title rules in index.css.
const STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif';
const TITLE: Record<'problem' | 'option' | 'note' | 'leaf', { font: string; line: number; width: number }> = {
  problem: { font: `650 17px ${STACK}`, line: 21, width: SIZE.problem.w - 32 },
  option: { font: `620 15.5px ${STACK}`, line: 20, width: SIZE.option.w - 28 },
  note: { font: `450 13.5px ${STACK}`, line: 18, width: SIZE.note.w - 28 },
  leaf: { font: `560 14.5px ${STACK}`, line: 19, width: SIZE.pro.w - 28 },
};
const titleSpec = (k: Kind) =>
  k === 'problem' || k === 'option' || k === 'note' ? TITLE[k] : TITLE.leaf;

/** 1 or 2: how many lines the card title wraps to (titles are clamped to 2). */
export function titleLines(it: Item) {
  const spec = titleSpec(it.kind);
  const text = it.title || KINDS[it.kind].placeholder;
  if (textWidth(text, spec.font) <= spec.width) return 1;
  let line = '';
  let lines = 1;
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, spec.font) > spec.width) {
      lines++;
      line = word;
      if (lines >= 2) return 2;
    } else line = next;
  }
  return lines;
}

/** Card size: shorter when the title fits on one line; compact options grow with their pills. */
export function cardSize(it: Item, pills: Item[] | null): Size {
  const base = SIZE[it.kind];
  let h = base.h - (titleLines(it) === 1 ? titleSpec(it.kind).line : 0);
  if (pills) {
    const rows = pillRows(pills.filter((p) => PILL_KINDS.has(p.kind)));
    if (rows) h += PILLS_TOP + rows * PILL_H + (rows - 1) * PILL_GAP;
  }
  return { w: base.w, h };
}
