// Artifact comments sidebar (Plan 5, Part B).
//
// Presentational list of threads for a published restricted artifact, with
// compose / reply / resolve. The comments state (initial load + realtime SSE +
// mutations) lives in the shared `useArtifactComments` hook, instantiated once
// in ArtifactViewer so the SAME set also backs the on-artifact marker layer
// (comments_layer.py + useArtifactCommentLayer). This panel receives that state
// and the layer's imperative controls as props:
//   - hovering a card highlights the anchored element in the iframe (onHover/onLeave)
//   - the "go to" affordance scrolls to it and opens its thread (onFocus)

import { useCallback, useMemo, useState } from 'react';
import {
  replyAuthorEmail,
  threadAuthorEmail,
  threadReplies,
  threadText,
} from '../../lib/commentsReducer';

const TABS = [
  ['open', 'Open'],
  ['resolved', 'Resolved'],
  ['all', 'All'],
];

function nameOf(email) {
  const s = String(email || '');
  const i = s.indexOf('@');
  return i > 0 ? s.slice(0, i) : s || 'Anonymous';
}

function isClosed(t) {
  return t.status === 'resolved' || t.status === 'dismissed';
}

export function CommentsPanel({
  threads = [],
  error = '',
  expired = false,
  onCreate,
  onReply,
  onStatus,
  onClose,
  onHoverThread,
  onLeaveThread,
  onFocusThread,
}) {
  const [tab, setTab] = useState('open');
  const [draft, setDraft] = useState('');

  const visible = useMemo(() => {
    if (tab === 'all') return threads.filter((t) => t.status !== 'dismissed');
    if (tab === 'resolved') return threads.filter((t) => t.status === 'resolved');
    return threads.filter((t) => !isClosed(t));
  }, [threads, tab]);

  const submitNew = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    // Unanchored comment (no element selected). Element-anchored comments are
    // created from the on-artifact layer, which supplies the selector.
    onCreate && onCreate({ selector: null, text });
  }, [draft, onCreate]);

  return (
    <div className="ac-panel" style={S.panel}>
      <div style={S.header}>
        <strong>Comments</strong>
        <button type="button" onClick={onClose} style={S.close} aria-label="Close comments">×</button>
      </div>

      {expired && (
        <div style={S.banner}>Session expired — reload to see new comments.</div>
      )}
      {error && <div style={S.error}>{error}</div>}

      <div style={S.tabs}>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{ ...S.tab, ...(tab === key ? S.tabActive : null) }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={S.list}>
        {visible.length === 0 && <div style={S.empty}>No comments</div>}
        {visible.map((t) => (
          <ThreadCard
            key={t.id}
            thread={t}
            onReply={onReply}
            onStatus={onStatus}
            onHover={onHoverThread}
            onLeave={onLeaveThread}
            onFocus={onFocusThread}
          />
        ))}
      </div>

      <div style={S.composer}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitNew(); }
          }}
          placeholder="Add a comment…"
          rows={2}
          style={S.textarea}
        />
        <button type="button" onClick={submitNew} disabled={!draft.trim()} style={S.primary}>
          Comment
        </button>
      </div>
    </div>
  );
}

function ThreadCard({ thread, onReply, onStatus, onHover, onLeave, onFocus }) {
  const [replyText, setReplyText] = useState('');
  const resolved = thread.status === 'resolved';
  const dismissed = thread.status === 'dismissed';
  const anchored = !!thread.selector;
  return (
    <div
      style={S.card}
      onMouseEnter={() => anchored && onHover && onHover(thread.id)}
      onMouseLeave={() => anchored && onLeave && onLeave(thread.id)}
    >
      <div style={S.cardTop}>
        <span style={S.name}>{nameOf(threadAuthorEmail(thread))}</span>
        <div>
          {dismissed && <span style={S.badge}>Dismissed</span>}
          {anchored && (
            <button
              type="button"
              style={S.pill}
              title="Go to the commented element"
              onClick={() => onFocus && onFocus(thread.id)}
            >
              Go to
            </button>
          )}
          <button type="button" style={S.pill} onClick={() => onStatus && onStatus(thread.id, resolved ? 'open' : 'resolved')}>
            {resolved ? 'Reopen' : 'Resolve'}
          </button>
          {!resolved && !dismissed && (
            <button type="button" style={S.pill} onClick={() => onStatus && onStatus(thread.id, 'dismissed')}>Dismiss</button>
          )}
        </div>
      </div>
      <div style={S.text}>{threadText(thread)}</div>
      {threadReplies(thread).map((r, i) => (
        <div key={r.id || i} style={S.reply}>
          <span style={S.name}>{nameOf(replyAuthorEmail(r))}</span>
          <span style={S.replyText}>{r.text}</span>
        </div>
      ))}
      <div style={S.replyRow}>
        <input
          type="text"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onReply && onReply(thread.id, replyText); setReplyText(''); }
          }}
          placeholder="Reply…"
          style={S.replyInput}
        />
      </div>
    </div>
  );
}

// Self-contained inline styles (no CSS file dependency).
const S = {
  panel: { display: 'flex', flexDirection: 'column', width: 340, maxWidth: '90vw', height: '100%',
    borderLeft: '1px solid var(--ac-border, #2a3a48)', background: 'var(--ac-bg, #0c141d)', color: '#e7eef3' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px',
    borderBottom: '1px solid #2a3a48' },
  close: { background: 'transparent', border: 'none', color: '#9fb0bd', fontSize: 20, cursor: 'pointer' },
  banner: { background: '#3a2a10', color: '#f0c674', padding: '8px 12px', fontSize: 12 },
  error: { background: '#3a1620', color: '#e0556a', padding: '8px 12px', fontSize: 12 },
  tabs: { display: 'flex', gap: 6, padding: '8px 12px' },
  tab: { flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid #2a3a48', background: 'transparent',
    color: '#9fb0bd', cursor: 'pointer', fontSize: 12 },
  tabActive: { color: '#04121a', background: '#00e5ff', borderColor: '#00e5ff' },
  list: { flex: 1, overflow: 'auto', padding: '4px 12px' },
  empty: { color: '#6c7a87', fontSize: 13, padding: '16px 0', textAlign: 'center' },
  card: { border: '1px solid #223040', borderRadius: 8, padding: 10, margin: '8px 0', background: '#0b121a' },
  cardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontWeight: 700, fontSize: 12, color: '#fff' },
  text: { fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  badge: { fontSize: 11, color: '#9fb0bd', border: '1px solid #2a3a48', borderRadius: 999, padding: '1px 8px', marginRight: 6 },
  pill: { fontSize: 11, color: '#9fb0bd', border: '1px solid #2a3a48', borderRadius: 999, padding: '2px 10px',
    marginLeft: 6, background: 'transparent', cursor: 'pointer' },
  reply: { marginTop: 8, paddingLeft: 8, borderLeft: '2px solid #223040' },
  replyText: { fontSize: 12, marginLeft: 6 },
  replyRow: { marginTop: 8 },
  replyInput: { width: '100%', boxSizing: 'border-box', height: 30, padding: '0 10px', background: '#0b121a',
    border: '1px solid #283845', borderRadius: 6, color: '#e7eef3' },
  composer: { borderTop: '1px solid #2a3a48', padding: 12 },
  textarea: { width: '100%', boxSizing: 'border-box', background: '#0b121a', border: '1px solid #283845',
    borderRadius: 6, color: '#e7eef3', padding: 8, resize: 'none' },
  primary: { marginTop: 8, width: '100%', height: 32, border: 'none', borderRadius: 6, background: '#00e5ff',
    color: '#04121a', fontWeight: 700, cursor: 'pointer' },
};

export default CommentsPanel;
