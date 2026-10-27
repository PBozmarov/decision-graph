import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Item } from './model';
import { IconCheck } from './icons';
import { quickPicks } from './dates';

/** Right after a path is chosen: ask for the reasoning while it's fresh. Typing saves live. */
export function WhyPrompt({
  option,
  rationale,
  onRationale,
  reviewAt,
  onReviewAt,
  onClose,
}: {
  option: Item;
  rationale: string;
  onRationale: (v: string) => void;
  /** The decision's check-back date; a chip sets it, clicking the selected one clears it. */
  reviewAt?: number;
  onReviewAt: (ts: number | undefined) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // Grow with the text (up to the CSS max-height, then scroll).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [rationale]);

  return (
    <div className="why glass" role="dialog" aria-label="Why this one?">
      <div className="why-head">
        <span className="why-check">
          <IconCheck size={14} />
        </span>
        <div className="why-text">
          <div className="why-title">
            You chose <b>{option.title || 'Untitled option'}</b>
          </div>
          <div className="why-sub">Why this one? A sentence now saves guessing later.</div>
        </div>
      </div>
      <textarea
        ref={ref}
        rows={1}
        className="insp-notes why-input"
        value={rationale}
        placeholder="Because…"
        onChange={(e) => onRationale(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onClose();
          } else if (e.key === 'Escape') {
            // Close instead of the global handler's plain blur.
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <div className="why-review">
        <span className="why-review-label">Check back in</span>
        {quickPicks().map((q) => (
          <button
            key={q.label}
            className={`chip chip-pick ${reviewAt === q.at ? 'is-on' : ''}`}
            aria-pressed={reviewAt === q.at}
            // Keep the caret in the reasoning (and ⌘↵ working) while picking.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onReviewAt(reviewAt === q.at ? undefined : q.at)}
          >
            {q.label}
          </button>
        ))}
      </div>
      <div className="why-foot">
        <button className="why-skip" onClick={onClose}>
          Skip
        </button>
        <button className="btn-primary why-done" onClick={onClose}>
          Done <span className="why-kbd">⌘↵</span>
        </button>
      </div>
    </div>
  );
}
