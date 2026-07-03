// Artifact comments sidebar (Plan 5, Part B).
//
// Lists threads for a published restricted artifact, with compose / reply /
// resolve, and live updates over SSE (fetch + iterateSSE, upsert-by-id with a
// version guard). Talks only to cowork-server, which attaches the user's creds
// and proxies to the inference backend. The on-artifact marker anchoring from
// the published shell (comments_ui.py LAYER_JS) is a deliberate follow-up; this
// panel delivers the thread list + realtime core.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addCommentReply,
  createCommentThread,
  listCommentThreads,
  openCommentsStream,
  setCommentThreadStatus,
} from '../../api';
import {
  maxUpdatedAt,
  replyAuthorEmail,
  threadAuthorEmail,
  threadReplies,
  threadText,
  upsertThread,
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

export function CommentsPanel({ userDir, reportId, onClose }) {
  const [threads, setThreads] = useState([]);
  const [tab, setTab] = useState('open');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const threadsRef = useRef([]);
  threadsRef.current = threads;

  const apply = useCallback((event) => {
    setThreads((prev) => upsertThread(prev, event));
  }, []);

  // Initial load, then subscribe from the max updated_at (closes the gap).
  // Reconnect on any drop with the latest `since` (B2), capped backoff; a terminal
  // 401/403 stops for good (session expired) instead of hammering the server.
  useEffect(() => {
    if (!userDir || !reportId) return undefined;
    let cancelled = false;
    let ctrl = null;
    let retryTimer = null;
    let attempts = 0;

    const connect = (since) => {
      if (cancelled) return;
      ctrl = openCommentsStream(userDir, reportId, since, {
        onEvent: (ev) => { attempts = 0; apply(ev); },
        onExpired: () => setExpired(true), // terminal — no reconnect
        onError: () => {
          if (cancelled) return;
          const delay = Math.min(30000, 1000 * 2 ** attempts);
          attempts += 1;
          retryTimer = setTimeout(() => connect(maxUpdatedAt(threadsRef.current)), delay);
        },
      });
    };

    listCommentThreads(userDir, reportId, 'all')
      .then((data) => {
        if (cancelled) return;
        const loaded = (data && data.threads) || [];
        setThreads(loaded);
        connect(maxUpdatedAt(loaded));
      })
      .catch((e) => !cancelled && setError(e.message || 'Failed to load comments'));

    return () => {
      cancelled = true;
      if (ctrl) ctrl.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [userDir, reportId, apply]);

  const visible = useMemo(() => {
    if (tab === 'all') return threads.filter((t) => t.status !== 'dismissed');
    if (tab === 'resolved') return threads.filter((t) => t.status === 'resolved');
    return threads.filter((t) => !isClosed(t));
  }, [threads, tab]);

  const submitNew = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try {
      const created = await createCommentThread(userDir, reportId, { selector: null, text });
      apply({ ...created, type: created.type || 'thread.created' });
    } catch (e) {
      setError(e.message || 'Failed to post');
    }
  }, [draft, userDir, reportId, apply]);

  const reply = useCallback(async (id, text) => {
    if (!text.trim()) return;
    try {
      const updated = await addCommentReply(userDir, reportId, id, text.trim());
      apply({ ...updated, type: 'thread.updated' });
    } catch (e) {
      setError(e.message || 'Failed to reply');
    }
  }, [userDir, reportId, apply]);

  const setStatus = useCallback(async (id, status) => {
    try {
      const updated = await setCommentThreadStatus(userDir, reportId, id, status);
      apply({ ...updated, type: 'thread.updated' });
    } catch (e) {
      setError(e.message || 'Failed to update');
    }
  }, [userDir, reportId, apply]);

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
          <ThreadCard key={t.id} thread={t} onReply={reply} onStatus={setStatus} />
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

function ThreadCard({ thread, onReply, onStatus }) {
  const [replyText, setReplyText] = useState('');
  const resolved = thread.status === 'resolved';
  const dismissed = thread.status === 'dismissed';
  return (
    <div style={S.card}>
      <div style={S.cardTop}>
        <span style={S.name}>{nameOf(threadAuthorEmail(thread))}</span>
        <div>
          {dismissed && <span style={S.badge}>Dismissed</span>}
          <button type="button" style={S.pill} onClick={() => onStatus(thread.id, resolved ? 'open' : 'resolved')}>
            {resolved ? 'Reopen' : 'Resolve'}
          </button>
          {!resolved && !dismissed && (
            <button type="button" style={S.pill} onClick={() => onStatus(thread.id, 'dismissed')}>Dismiss</button>
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
            if (e.key === 'Enter') { e.preventDefault(); onReply(thread.id, replyText); setReplyText(''); }
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
