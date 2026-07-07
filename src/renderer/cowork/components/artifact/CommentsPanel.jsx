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

import { useCallback, useMemo, useRef, useState } from 'react';
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

// Resizable-panel bounds (mirrors mindshub_services): min 260px, max the
// smaller of 720px and (viewport - 60px), default 340px. Width persists.
const WIDTH_KEY = 'antonCommentsSidebarWidth';
const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 260;
function clampWidth(w) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const max = Math.min(720, Math.max(MIN_WIDTH, vw - 60));
  return Math.min(max, Math.max(MIN_WIDTH, w));
}

function nameOf(email) {
  const s = String(email || '');
  const i = s.indexOf('@');
  return i > 0 ? s.slice(0, i) : s || 'Anonymous';
}

// Icons mirror the mindshub_services layer/sidebar so the compose + reply rows
// look identical (single-line input + send/clear icon buttons).
function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
// Check-in-circle for Resolve, crosshair for Go-to — same glyphs as the
// mindshub_services sidebar.
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
function LocateIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
    </svg>
  );
}

// Shared single-line input + send/clear row used by the composer and each
// card's reply box. `onSubmit` fires on the send button or Enter; `onClear`
// wipes the field.
function InputRow({ value, onChange, onSubmit, onClear, placeholder, sendTitle }) {
  const canSend = !!value.trim();
  return (
    <div style={S.replyRow}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
        placeholder={placeholder}
        style={S.replyInput}
      />
      <button
        type="button"
        style={{ ...S.iconSend, opacity: canSend ? 1 : 0.45, cursor: canSend ? 'pointer' : 'default' }}
        title={sendTitle}
        disabled={!canSend}
        onClick={onSubmit}
      >
        <SendIcon />
      </button>
      <button type="button" style={S.iconCancel} title="Clear" onClick={onClear}>
        <CloseIcon />
      </button>
    </div>
  );
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

  // Resizable width, persisted across opens (mirrors the mindshub_services
  // overlay panel). The panel is anchored right and overlays the preview, so
  // dragging the left-edge handle leftwards widens it.
  const [width, setWidth] = useState(() => {
    let saved = 0;
    try { saved = parseInt(localStorage.getItem(WIDTH_KEY), 10) || 0; } catch { /* ignore */ }
    return clampWidth(saved || DEFAULT_WIDTH);
  });
  const dragRef = useRef(null);

  const onResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    // Pointer capture routes every move/up to the handle even while the cursor
    // travels over the cross-origin iframe (which would otherwise swallow them).
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = { startX, startW };
  }, [width]);

  const onResizeMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    setWidth(clampWidth(d.startW + (d.startX - e.clientX)));
  }, []);

  const onResizeEnd = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
  }, [width]);

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
    <div className="ac-panel" style={{ ...S.panel, width }}>
      <div
        style={S.resizer}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        title="Drag to resize"
      />
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
        <InputRow
          value={draft}
          onChange={setDraft}
          onSubmit={submitNew}
          onClear={() => setDraft('')}
          placeholder="Add a comment…"
          sendTitle="Comment"
        />
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
        <div style={S.actions}>
          {dismissed && <span style={S.badge}>Dismissed</span>}
          {anchored ? (
            <button
              type="button"
              style={S.goto}
              title="Open this comment on the element"
              onClick={() => onFocus && onFocus(thread.id)}
            >
              <LocateIcon />
            </button>
          ) : (
            <span style={S.unanchored} title="Not attached to a page element">unanchored</span>
          )}
          <button
            type="button"
            style={{ ...S.resolve, ...(resolved ? S.resolveActive : null) }}
            title={resolved ? 'Reopen this comment' : 'Mark as resolved'}
            onClick={() => onStatus && onStatus(thread.id, resolved ? 'open' : 'resolved')}
          >
            <CheckIcon />
            <span>{resolved ? 'Resolved' : 'Resolve'}</span>
          </button>
        </div>
      </div>
      <div style={S.text}>{threadText(thread)}</div>
      {threadReplies(thread).map((r, i) => (
        <div key={r.id || i} style={S.reply}>
          <span style={S.name}>{nameOf(replyAuthorEmail(r))}</span>
          <span style={S.replyText}>{r.text}</span>
        </div>
      ))}
      <InputRow
        value={replyText}
        onChange={setReplyText}
        onSubmit={() => { onReply && onReply(thread.id, replyText); setReplyText(''); }}
        onClear={() => setReplyText('')}
        placeholder="Reply…"
        sendTitle="Send reply"
      />
    </div>
  );
}

// Self-contained inline styles (no CSS file dependency).
const S = {
  // Overlay panel: floats over the preview (doesn't shift it), anchored to the
  // right edge of the body region. Width is applied inline (resizable).
  panel: { position: 'absolute', top: 0, right: 0, bottom: 0, maxWidth: '90vw',
    display: 'flex', flexDirection: 'column', zIndex: 30,
    borderLeft: '1px solid var(--ac-border, #2a3a48)', background: 'var(--ac-bg, #0c141d)',
    color: '#e7eef3', boxShadow: '-8px 0 28px rgba(0,0,0,0.35)' },
  // Left-edge drag handle; slightly overhangs the border so it's easy to grab.
  resizer: { position: 'absolute', left: -3, top: 0, bottom: 0, width: 7, cursor: 'col-resize',
    zIndex: 2, touchAction: 'none' },
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
  badge: { fontSize: 11, color: '#9fb0bd', border: '1px solid #2a3a48', borderRadius: 999, padding: '1px 8px' },
  // Actions row + affordances mirror the mindshub_services sidebar.
  actions: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  unanchored: { display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px',
    borderRadius: 999, fontSize: 11, fontWeight: 600, color: '#9fb0bd', background: '#16202b',
    border: '1px dashed #2a3a48', whiteSpace: 'nowrap' },
  goto: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26,
    borderRadius: 999, border: '1px solid #2a3a48', background: 'transparent', color: '#9fb0bd',
    cursor: 'pointer', flexShrink: 0 },
  resolve: { display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px',
    borderRadius: 999, border: '1px solid #2a3a48', background: 'transparent', color: '#9fb0bd',
    fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  resolveActive: { borderColor: 'rgba(74,201,126,0.35)', background: 'rgba(74,201,126,0.12)', color: '#66d39a' },
  reply: { marginTop: 8, paddingLeft: 8, borderLeft: '2px solid #223040' },
  replyText: { fontSize: 12, marginLeft: 6 },
  // Single-line input + send/clear icon buttons, matching the mindshub_services
  // reply row. Used by both the composer and each card's reply box.
  replyRow: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 },
  replyInput: { flex: 1, minWidth: 0, boxSizing: 'border-box', height: 34, padding: '0 12px',
    background: '#0b121a', border: '1px solid #283845', borderRadius: 8, color: '#e7eef3', outline: 'none' },
  iconSend: { flexShrink: 0, width: 34, height: 34, borderRadius: 8, background: 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    border: '1px solid #2a3a48', color: '#cfdae2' },
  iconCancel: { flexShrink: 0, width: 34, height: 34, borderRadius: 8, background: 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    border: '1px solid #4a2530', color: '#e0556a' },
  composer: { borderTop: '1px solid #2a3a48', padding: 12 },
};

export default CommentsPanel;
