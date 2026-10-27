import type { ReactNode } from 'react';
import { OUTCOME, type Outcome, type Verdict } from './model';
import { IconCheck, IconFaceGood, IconFaceUneasy, TrendIcon } from './icons';

/** One-line summary of which option is ahead; shared by the decision card, compare sheet and inspector. */
export function VerdictHeadline({ v, className = '', outcome }: { v: Verdict; className?: string; outcome?: Outcome }) {
  const name = (id: string | null) => v.rows.find((r) => r.id === id)?.title || 'Untitled option';
  const pts = v.margin === 1 ? 'point' : 'points';
  let body: ReactNode;
  switch (v.state) {
    case 'none':
      return null;
    case 'decided':
      body = (
        <>
          <IconCheck size={11} /> Chose <b>{name(v.chosenId)}</b>
          {outcome && (
            <>
              {' · '}
              <span className="vd-outcome" style={{ color: OUTCOME[outcome.rating].color }}>
                <TrendIcon rating={outcome.rating} size={11} /> {OUTCOME[outcome.rating].short}
              </span>
            </>
          )}
        </>
      );
      break;
    case 'clear':
      body = (
        <>
          <b className="vd-lead">{name(v.leaderId)}</b> leads by {v.margin} {pts}
        </>
      );
      break;
    case 'close':
      body = (
        <>
          Close call · <b className="vd-lead">{name(v.leaderId)}</b> ahead by {v.margin}
        </>
      );
      break;
    case 'tie':
      body = (
        <>
          Tied: <b>{name(v.topIds[0])}</b> and <b>{name(v.topIds[1])}</b>
        </>
      );
      break;
    case 'onlyViable':
      body = (
        <>
          Only <b className="vd-lead">{name(v.leaderId)}</b> meets every must-have
        </>
      );
      break;
    case 'allBlocked':
      body = 'Every option is missing a must-have';
      break;
    case 'unscored':
      body = 'Weigh pros, cons and risks to see a leader';
      break;
  }
  // The gut disagrees with (or doubts) the numbers' leader: say so instead of the usual leader line.
  // The gut part comes first: when the line is cut short, the leader is still visible in the bars.
  const gut = v.state === 'clear' || v.state === 'close' || v.state === 'onlyViable' ? v.gutNote : null;
  if (gut?.kind === 'disagree') {
    body = (
      <>
        <span className="gut-ic gut-good">
          <IconFaceGood size={11} />
        </span>{' '}
        Gut favors <b>{name(gut.favoriteId)}</b> · numbers favor <b className="vd-lead">{name(v.leaderId)}</b>
      </>
    );
  } else if (gut?.kind === 'feelsOff') {
    body = (
      <>
        <span className="gut-ic gut-uneasy">
          <IconFaceUneasy size={11} />
        </span>{' '}
        <b className="vd-lead">{name(v.leaderId)}</b> leads, but it feels off
      </>
    );
  }
  // The gut line often runs past the card's one line; the full sentence is a hover away.
  const full =
    gut?.kind === 'disagree'
      ? `Gut favors ${name(gut.favoriteId)} · numbers favor ${name(v.leaderId)}`
      : gut?.kind === 'feelsOff'
        ? `${name(v.leaderId)} leads, but it feels off`
        : v.state === 'decided' && outcome
          ? `Chose ${name(v.chosenId)} · ${OUTCOME[outcome.rating].long}`
          : undefined;
  return (
    <div className={`vd-text vd-${v.state} ${v.state === 'allBlocked' ? 't-con' : ''} ${className}`} title={full}>
      {body}
    </div>
  );
}
