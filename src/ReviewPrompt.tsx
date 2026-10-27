import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { OUTCOME, type Item, type Outcome, type OutcomeRating } from './model';
import { TrendIcon } from './icons';
import { relPast } from './dates';

const RATINGS: OutcomeRating[] = [-1, 0, 1];

/** Looking back on a choice: how did it turn out, and what did you learn? Shares the Why prompt's sheet. */
export function ReviewPrompt({
  problem,
  option,
  edit,
  onSave,
  onLater,
  onClose,
}: {
  problem: Item;
  option: Item;
  /** Editing a saved outcome: prefilled, and the quiet button cancels instead of snoozing. */
  edit: boolean;
  onSave: (outcome: Outcome) => void;
  onLater: () => void;
  onClose: () => void;
}) {
  const [rating, setRating] = useState<OutcomeRating | null>(edit ? (problem.outcome?.rating ?? null) : null);
  const [note, setNote] = useState(edit ? (problem.outcome?.note ?? '') : '');
  const ref = useRef<HTMLTextAreaElement>(null);
  // Grow with the text (up to the CSS max-height, then scroll).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [note]);

  const save = useCallback(() => {
    if (rating === null) return;
    onSave({ rating, note: note.trim() || undefined, at: Date.now() });
  }, [rating, note, onSave]);

  // Esc closes without changes and ⌘↵ saves, wherever the focus is (a palette or compare sheet on top goes first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.pal-backdrop, .cmp-backdrop')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        save();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, save]);

  return (
    <div className="why review glass" role="dialog" aria-label="Looking back">
      <div className="why-text">
        <div className="review-eyebrow">Looking back</div>
        <div className="why-title review-title">
          <span>You chose</span>{' '}
          <b>{option.title || 'Untitled option'}</b>
          {problem.decidedAt !== undefined && <> <span>{relPast(problem.decidedAt)}</span></>}
        </div>
        <div className="why-sub review-sub">{problem.title || (problem.kind === 'option' ? 'Untitled option' : 'Untitled decision')}</div>
      </div>
      {problem.rationale?.trim() && (
        <div className="review-why">
          <div className="review-why-label">Your reasoning</div>
          <div className="review-quote">{problem.rationale}</div>
        </div>
      )}
      <div className="review-rates" role="radiogroup" aria-label="How did it turn out?">
        {RATINGS.map((r) => (
          <button
            key={r}
            role="radio"
            aria-checked={rating === r}
            className={`review-rate ${rating === r ? 'is-on' : ''}`}
            style={{ '--k': OUTCOME[r].color } as CSSProperties}
            onClick={() => setRating(r)}
          >
            <TrendIcon rating={r} size={15} />
            <span className="rate-long">{OUTCOME[r].long}</span>
            <span className="rate-short">{OUTCOME[r].short}</span>
          </button>
        ))}
      </div>
      <textarea
        ref={ref}
        rows={1}
        className="insp-notes why-input"
        value={note}
        placeholder="What did you learn?"
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="why-foot">
        <button className="why-skip" onClick={edit ? onClose : onLater}>
          {edit ? 'Cancel' : 'Later'}
        </button>
        <button className="btn-primary why-done" onClick={save} disabled={rating === null}>
          Save <span className="why-kbd">⌘↵</span>
        </button>
      </div>
    </div>
  );
}
