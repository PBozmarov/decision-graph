import { KINDS, SIZE, type Item } from './model';

// Pill geometry — must match .pill-item in index.css.
export const PILL_H = 22;
export const PILL_GAP = 5;
const PILL_CHROME = 7 + 12 + 5 + 9; // left pad + icon + gap + right pad
const PILLS_TOP = 10; // space above the pill block
const INNER_W = SIZE.option.w - 28 - 4; // card padding, plus a little slack
export const PILL_MAX = INNER_W;
const FONT = '560 11.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif';

let ctx: CanvasRenderingContext2D | null = null;
function textWidth(t: string) {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return t.length * 6.5;
  ctx.font = FONT;
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

export function compactOptionHeight(pills: Item[]) {
  const rows = pillRows(pills);
  return SIZE.option.h + (rows ? PILLS_TOP + rows * PILL_H + (rows - 1) * PILL_GAP : 0);
}
