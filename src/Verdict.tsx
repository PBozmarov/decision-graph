import type { ReactNode } from 'react';
import type { Verdict } from './model';
import { IconCheck } from './icons';

/** One-line summary of which option is ahead; shared by the decision card, compare sheet and inspector. */
export function VerdictHeadline({ v, className = '' }: { v: Verdict; className?: string }) {
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
  return <div className={`vd-text vd-${v.state} ${v.state === 'allBlocked' ? 't-con' : ''} ${className}`}>{body}</div>;
}
