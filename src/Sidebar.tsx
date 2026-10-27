import type { Doc, SyncStatus } from './store';
import type { Account } from './cloud';
import { useRef } from 'react';
import { OUTCOME } from './model';
import { IconCheck, IconDownload, IconPlus, IconSearch, IconSparkle, IconTrash, IconUpload, TrendIcon } from './icons';
import { ago, summary } from './summary';

const SYNC_LABEL: Record<SyncStatus, string> = {
  local: 'On this device',
  loading: 'Loading…',
  saving: 'Saving…',
  saved: 'Synced',
  offline: 'Offline, will sync later',
  error: "Couldn't sync",
};

const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

export function Sidebar({
  docs,
  activeId,
  onSelect,
  onNew,
  onSearch,
  onDelete,
  onTemplate,
  onBackup,
  onRestore,
  account,
  syncStatus,
  onSignIn,
  onSignOut,
  dueDocs,
}: {
  docs: Doc[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** Opens the ⌘K palette. */
  onSearch: () => void;
  onDelete: (id: string) => void;
  onTemplate: () => void;
  onBackup: () => void;
  onRestore: (file: File) => void;
  /** undefined = accounts not configured; null = signed out. */
  account?: Account | null;
  syncStatus: SyncStatus;
  onSignIn: () => void;
  onSignOut: () => void;
  /** Decisions with a look back that's due. */
  dueDocs?: Set<string>;
}) {
  const sorted = [...docs].sort((a, b) => b.updatedAt - a.updatedAt);
  // Once something is decided, split the list; each part keeps the last-edited-first order.
  const decided = sorted.filter((d) => summary(d).chosen !== null);
  const open = sorted.filter((d) => summary(d).chosen === null);
  const fileRef = useRef<HTMLInputElement>(null);
  const row = (d: Doc) => {
    const s = summary(d);
    return (
      <div
        key={d.id}
        role="button"
        tabIndex={0}
        className={`side-row ${d.id === activeId ? 'is-active' : ''}`}
        onClick={() => onSelect(d.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect(d.id);
        }}
      >
        <div className="side-title">{s.title}</div>
        <div className="side-meta">
          {s.chosen ? (
            <span className="side-chosen">
              <IconCheck size={11} /> <span className="side-chosen-tx">{s.chosen}</span>
              {s.outcome && (
                <span className="side-outcome" style={{ color: OUTCOME[s.outcome.rating].color }} title={OUTCOME[s.outcome.rating].long}>
                  <TrendIcon rating={s.outcome.rating} size={11} />
                </span>
              )}
            </span>
          ) : (
            <span>{s.options ? `${s.options} option${s.options === 1 ? '' : 's'}` : 'No options yet'}</span>
          )}
          <span className="side-dot" />
          {dueDocs?.has(d.id) ? <span className="side-due">Review due</span> : <span>{ago(d.updatedAt)}</span>}
        </div>
        <button
          className="side-del"
          title="Delete decision"
          aria-label="Delete decision"
          onClick={(e) => {
            e.stopPropagation();
            if (!d.items.length || confirm(`Delete “${s.title}”? You can't undo this.`)) onDelete(d.id);
          }}
        >
          <IconTrash size={13} />
        </button>
      </div>
    );
  };
  return (
    <aside className="sidebar glass">
      <header className="side-head">
        <span>Decisions</span>
        <button className="icon-btn side-new" onClick={onNew} title="New decision" aria-label="New decision">
          <IconPlus size={15} />
        </button>
      </header>

      <button className="side-search" onClick={onSearch}>
        <IconSearch size={14} />
        <span>Search</span>
        <span className="kbd-hint side-search-kbd">⌘K</span>
      </button>

      <div className="side-list">
        {decided.length ? (
          <>
            {open.length > 0 && <div className="side-sec">Open · {open.length}</div>}
            {open.map(row)}
            <div className="side-sec">Decided · {decided.length}</div>
            {decided.map(row)}
          </>
        ) : (
          sorted.map(row)
        )}
      </div>

      <footer className="side-foot">
        <button className="side-example" onClick={onTemplate}>
          <IconSparkle size={13} /> Start from a template
        </button>
        <div className="side-backup">
          <button
            className="side-example"
            onClick={onBackup}
            disabled={!docs.some((d) => d.items.length)}
            title="Download all decisions as a backup file"
          >
            <IconDownload size={13} /> Back up
          </button>
          <button
            className="side-example"
            onClick={() => fileRef.current?.click()}
            title="Add decisions from a backup file"
          >
            <IconUpload size={13} /> Restore
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onRestore(f);
            }}
          />
        </div>
        {account === null && (
          <div className="account">
            <button className="google-btn" onClick={onSignIn}>
              <GoogleMark />
              Sign in with Google
            </button>
            <div className="account-note">Owner sign-in. Without an account, decisions stay in this browser.</div>
          </div>
        )}
        {account && (
          <div className="account account-in">
            {account.photo ? (
              <img className="avatar" src={account.photo} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="avatar avatar-letter">{account.name.slice(0, 1).toUpperCase()}</span>
            )}
            <div className="account-who">
              <div className="account-name">{account.name}</div>
              <div className={`sync sync-${syncStatus}`}>
                <span className="sync-dot" />
                {SYNC_LABEL[syncStatus]}
              </div>
            </div>
            <button className="account-out" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}
      </footer>
    </aside>
  );
}
