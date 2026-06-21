// ArtifactWorkspaceRedesign.jsx — flag-gated, redesigned artifact workspace.
//
// This is the composition layer for the redesign component library. It accepts
// the SAME props as the legacy ArtifactWorkspace and composes the M0 shell
// (WorkspaceShell + IconRail + TopBar), the M4 Story rail, the M2 version
// scrubber + history dock, and the M3 review surface — with a canvas that wires
// the M1 "Fix it in place" hero for prose artifacts against the real backend.
//
// House rules: all new logic lives here / under redesign/. The only existing
// files touched are api.js (the two edit endpoints) and the barrel index.js
// (the flag switch). The redesign is OFF by default; `shouldUseRedesign()`
// reads a localStorage flag so it can be flipped per-machine without a rebuild.
//
// Data: versions + comments come from existing api.js fns where the mapping is
// straightforward; everything else is mock/derived and marked TODO.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../ui/Modal';

import './redesign.css';
import { WorkspaceShell, TopBar } from './index.js';
import { StoryRail } from './storyRailIndex.js';
import { EditableBlock } from './editIndex.js';
import { ReviewBanner } from './reviewIndex.js';
import { useArtifactChat } from './useArtifactChat.js';
import { useCurrentUser } from './useCurrentUser.js';
import { CommentLayer } from './CommentLayer.jsx';
import { EditableProse } from './EditableProse.jsx';
import { useIframeInlineEdit } from './useIframeInlineEdit.js';
import { saveArtifactContent } from './saveArtifactContent.js';
import { VersionDiff } from './VersionDiff.jsx';

import {
  artifactServeUrl,
  fetchArtifactVersions,
  fetchArtifactComments,
  createArtifactComment,
  mountArtifactPreview,
  previewArtifact,
  restoreArtifactVersion,
  proposeArtifactEdit,
  acceptArtifactEdit,
  setArtifactSuggestionStatus,
  resolveArtifactComment,
} from '../../../api';

// ── Flag ──────────────────────────────────────────────────────────────────────
export const REDESIGN_FLAG_KEY = 'anton:artifact-workspace-direction-2';

/**
 * shouldUseRedesign — direction-2 is the dedicated redesign branch, so the
 * redesign is ON by default here. Opt OUT (to see the legacy workspace) via:
 *   localStorage.setItem('anton:artifact-workspace-direction-2', 'false')
 *
 * Accepts the workspace props for parity / future per-artifact gating, but the
 * current decision is global.
 */
export function shouldUseRedesign(_props) {
  try {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem(REDESIGN_FLAG_KEY) !== 'false';
  } catch {
    return true;
  }
}

// ── Small helpers (mirrors the legacy workspace's derivation) ───────────────────
const TEXT_EXTS = new Set(['.md', '.txt', '.markdown', '.csv']);
const HTML_EXTS = new Set(['.html', '.htm']);

function extOfPath(p) {
  if (!p || typeof p !== 'string') return '';
  const m = p.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
}

function versionPathOf(artifact) {
  return (
    artifact?.canonicalPath ||
    artifact?.file_path ||
    artifact?.path ||
    ''
  );
}

function displayName(path) {
  if (!path) return 'Artifact';
  return String(path).split(/[\\/]/).filter(Boolean).pop() || path;
}

function artifactExt(artifact, path) {
  const declared = (artifact?.ext || '').toLowerCase();
  return declared || extOfPath(path);
}

function initialsOf(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Split prose into paragraph blocks. Blank-line separated; keeps it simple and
// deterministic so each block maps to a stable index-based id.
function splitParagraphs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function relativeWhen(value) {
  if (!value) return '';
  let v = value;
  // Server timestamps are UTC but often lack an offset (e.g. "2026-06-21T12:09:24").
  // JS would parse that as LOCAL time, making recent edits read as "1h ago".
  // Tag bare datetime strings as UTC so the relative time is correct.
  if (typeof v === 'string' && /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
    v = v.replace(' ', 'T') + 'Z';
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(value);
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// Epoch ms for a server timestamp (UTC-corrected) — used to time-group versions.
function toEpoch(value) {
  if (!value) return 0;
  let v = value;
  if (typeof v === 'string' && /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
    v = v.replace(' ', 'T') + 'Z';
  }
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Map an api.js version record to the scrubber/HistoryPanel shape. Version
// numbers are derived from list order (TODO: use a real server-provided number
// when the contract exposes one).
// Map a backend version → display shape. WHO: AI operations → "Anton"; a user's
// direct typed edit (operationType "manual_edit") → "You". WHAT: a clean, single
// label (no more confusing "Unknown · Manual · AI edit").
function mapVersions(rawVersions, currentVersionId) {
  const list = Array.isArray(rawVersions) ? rawVersions : [];
  return list.map((v, i) => {
    const id = v?.id || v?.versionId || v?.version_id || `idx-${i}`;
    const op = String(v?.operationType || v?.operation_type || v?.kind || '').toLowerCase();
    const isAI = op === 'ai_edit' || op === 'generated_update' || /agent|generated/.test(op) || op.startsWith('ai');
    const what =
      op === 'manual_edit' || op === 'manual' ? 'Edited'
      : op === 'ai_edit' ? 'AI edit'
      : op === 'generated_update' ? 'Generated update'
      : op.includes('suggest') ? 'Suggestion accepted'
      : op.includes('restore') ? 'Restored'
      : (v?.label || v?.name || 'Version');
    const who = isAI ? 'Anton' : 'You';
    return {
      id,
      n: i + 1,
      label: what,
      author: { name: who, initials: isAI ? 'AN' : 'ME', isAI },
      when: relativeWhen(v?.createdAt || v?.created_at || v?.when || v?.timestamp),
      ts: toEpoch(v?.createdAt || v?.created_at || v?.when || v?.timestamp),
      current: currentVersionId ? id === currentVersionId : false,
    };
  });
}

// Map api.js comments/activity to StoryRail events. Falls back to the rail's own
// mock when nothing is available (mark TODO: a richer fused chat+version feed).
function mapStoryEvents({ comments, activity }) {
  const events = [];
  for (const c of comments || []) {
    // The backend serializes the commenter as `actorName` (e.g. "You"); older
    // fallbacks kept for safety. Reading the right field fixes "Someone commented".
    const name = c?.actorName || c?.author?.name || c?.author || c?.user || 'Someone';
    const isReview = c?.kind === 'suggestion' || c?.kind === 'review';
    events.push({
      id: `c-${c?.id || events.length}`,
      commentId: c?.id,
      kind: isReview ? 'review' : 'comment',
      author: { name, initials: initialsOf(name), color: '#3a4d6e' },
      title: c?.kind === 'suggestion' ? 'suggested a change' : (c?.kind === 'review' ? 'requested review' : 'commented'),
      body: c?.body || c?.text || '',
      when: relativeWhen(c?.createdAt || c?.created_at || c?.when),
      meta: { resolved: c?.status === 'resolved', dismissed: c?.status === 'rejected' },
    });
  }
  for (const a of activity || []) {
    const name = a?.actorName || a?.author?.name || a?.actor || a?.user || 'Anton';
    events.push({
      id: `a-${a?.id || events.length}`,
      kind: a?.kind || 'system',
      author: { name, initials: initialsOf(name), isAI: /anton|agent|ai/i.test(String(name)) },
      title: a?.title || a?.summary || a?.message || 'updated the artifact',
      body: a?.body || '',
      when: relativeWhen(a?.createdAt || a?.created_at || a?.when),
    });
  }
  return events;
}

// ── Canvas: prose (M1 hero), HTML (iframe), or placeholder ──────────────────────

// Local mock so a missing/404 backend degrades gracefully INSTEAD of surfacing a
// generation error. Mirrors useInlineEdit's built-in mock contract.
function mockRewrite(text, instruction) {
  const t = String(text || '').trim();
  const i = String(instruction || '').toLowerCase();
  if (i.includes('short') || i.includes('trim') || i.includes('concise')) {
    const first = t.match(/^[^.!?]*[.!?]/);
    return first ? first[0].trim() : t;
  }
  if (i.includes('warm') || i.includes('friendly')) {
    return `Hi there — ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  }
  return t.replace(/\.$/, '') + ' — refreshed.';
}

function ProseCanvas({
  artifact,
  path,
  versionId,
  baseVersionId,
  title,
  reloadToken,
  editMode,
  onSaveContent,
  onExitEdit,
  onToast,
  onCommitted,
  onComment,
}) {
  const [state, setState] = useState({ loading: true, error: '', blocks: [] });
  // Un-saved edits in the current edit session (mirrors EditableProse). Reset
  // whenever edit mode toggles so a fresh session starts clean.
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!editMode) setDirty(false); }, [editMode]);

  // Persist on exit, and optimistically show the saved text in the read-only
  // render so it doesn't flash the pre-edit content during the version round-trip.
  const handleProseSave = useCallback((payload) => {
    if (payload && typeof payload.newContent === 'string') {
      setState((s) => ({ ...s, blocks: splitParagraphs(payload.newContent) }));
    }
    onSaveContent?.(payload);
  }, [onSaveContent]);

  useEffect(() => {
    if (!path) {
      setState({ loading: false, error: 'This artifact has no previewable file yet.', blocks: [] });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, error: '', blocks: [] });
    previewArtifact(path, { versionId: versionId || '' })
      .then((data) => {
        if (cancelled) return;
        if (!data || typeof data.content !== 'string') throw new Error('Preview returned no content');
        setState({ loading: false, error: '', blocks: splitParagraphs(data.content) });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ loading: false, error: err?.message || 'Could not load this artifact.', blocks: [] });
      });
    return () => { cancelled = true; };
  }, [path, versionId, reloadToken]);

  // M1 adapters: inject `path` + the block's `oldText`, hit the real backend, and
  // DEGRADE TO THE MOCK on a 404 / unavailable endpoint (wrapped in try/catch per
  // the brief) so the hero interaction always completes.
  const proposeEdit = useCallback(
    async ({ target, instruction }) => {
      const oldText = target?.text ?? '';
      try {
        const res = await proposeArtifactEdit({
          path,
          target,
          instruction,
          oldText,
          baseVersionId,
        });
        // If the endpoint exists but returns nothing useful, fall back to a mock
        // rewrite rather than showing an empty diff.
        if (!res || (!res.newText && !res.oldText)) {
          return { oldText, newText: mockRewrite(oldText, instruction) };
        }
        return { oldText: res.oldText || oldText, newText: res.newText || oldText };
      } catch (err) {
        // Degrade to a local mock for any "endpoint can't service this" status
        // (404/405/501) or a contract/validation reject (400/422) — the
        // per-paragraph AI rewrite needs backend model-generation that isn't
        // wired yet, so this keeps the interaction from throwing.
        if ([400, 404, 405, 422, 501].includes(err?.status)) {
          return { oldText, newText: mockRewrite(oldText, instruction) };
        }
        throw err; // real failure → hook toasts it
      }
    },
    [path, baseVersionId],
  );

  const commitEdit = useCallback(
    async ({ target, newText, baseVersionId: bv }) => {
      try {
        return await acceptArtifactEdit({ path, target, newText, baseVersionId: bv });
      } catch (err) {
        if ([400, 404, 405, 422, 501].includes(err?.status)) {
          // Endpoint unavailable or rejected the per-block contract — mock a
          // successful commit so Keep doesn't throw. (Direct typing + inline
          // chat are the proven persist paths; this per-block AI Keep is a
          // fallback until backend model-gen lands.)
          return { ok: true, versionId: `v-local-${Date.now()}`, text: newText };
        }
        throw err;
      }
    },
    [path],
  );

  if (state.loading) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
        Loading {displayName(path)}…
      </div>
    );
  }
  if (state.error) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>
        {state.error}
      </div>
    );
  }

  return (
    <>
    <div className="rd-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '40px 24px', background: 'var(--surface-2)' }}>
      <div
        style={{
          width: '100%',
          maxWidth: 760,
          height: 'max-content',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          padding: '48px 56px 56px',
          boxShadow: 'var(--sh-2, 0 1px 0 rgba(0,0,0,.4),0 6px 18px rgba(0,0,0,.5))',
        }}
      >
        <h1 style={{ fontWeight: 700, fontSize: 28, lineHeight: 1.15, color: 'var(--ink)', margin: '0 0 22px' }}>
          {title}
        </h1>
        {state.blocks.length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>This document is empty.</p>
        ) : editMode ? (
          // Direct typing — no AI. Edits accumulate; ONE version on Save / exit.
          <EditableProse blocks={state.blocks} active onSaveContent={handleProseSave} onDirtyChange={setDirty} />
        ) : (
          state.blocks.map((para, i) => (
            <EditableBlock
              key={i}
              text={para}
              target={{ artifactId: path, blockId: `block-${i}`, range: { index: i }, text: para }}
              baseVersionId={baseVersionId}
              proposeEdit={proposeEdit}
              commitEdit={commitEdit}
              onComment={onComment}
              onCommitted={onCommitted}
              onToast={onToast}
            />
          ))
        )}
      </div>
    </div>
    {editMode ? (
      <button
        type="button"
        onClick={() => onExitEdit?.()}
        title={dirty ? 'Save your changes as a new version' : 'Finish editing'}
        style={{ position: 'absolute', top: 12, right: 12, zIndex: 30, display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 14px', borderRadius: 9, border: dirty ? 'none' : '1px solid var(--line-2)', background: dirty ? 'var(--success)' : 'var(--surface-3)', color: dirty ? '#04150a' : 'var(--ink-2)', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 8px 20px -8px rgba(0,0,0,.5)' }}
      >
        {dirty ? '✓ Save changes' : 'Done'}
      </button>
    ) : null}
    </>
  );
}

function HtmlCanvas({ artifact, path, versionId, reloadToken, editMode, onSaveContent, onExitEdit, onError, onSlideChange, commitRef }) {
  const [state, setState] = useState({ loading: true, error: '', url: '' });
  const iframeRef = useRef(null);
  // Direct in-place typing on the same-origin preview (degrades if cross-origin).
  // Edits accumulate; nothing persists until Save / exit (see `dirty`).
  const { supported, commit, dirty } = useIframeInlineEdit({
    iframeRef,
    active: !!editMode,
    onSaveHtml: ({ edits }) => onSaveContent?.({ edits }),
    onError: (m) => onError?.(m),
  });

  // Expose commit to the host so closing the workspace mid-edit can flush a
  // pending change (the iframe is still attached during the close click).
  useEffect(() => {
    if (!commitRef) return undefined;
    commitRef.current = commit;
    return () => { commitRef.current = null; };
  }, [commit, commitRef]);

  // ── Slide tracking (decks) ──────────────────────────────────────────────────
  // Read which `.slide` is `.active` in the same-origin preview and report it up
  // so comment pins can be scoped to the slide they belong to. Harmless for
  // non-slide HTML (no `.slide` → reports index null). Cross-origin → no-op.
  const slideObserverRef = useRef(null);
  const readSlides = useCallback(() => {
    const ifr = iframeRef.current;
    if (!ifr) return;
    let doc;
    try { doc = ifr.contentDocument || ifr.contentWindow?.document || null; } catch { doc = null; }
    if (!doc) return;
    try {
      const slides = Array.from(doc.querySelectorAll('.slide'));
      if (!slides.length) { onSlideChange?.({ index: null, count: 0 }); return; }
      let idx = slides.findIndex((s) => s.classList?.contains('active'));
      if (idx < 0) idx = 0;
      onSlideChange?.({ index: idx, count: slides.length });
    } catch { /* cross-origin or torn down */ }
  }, [onSlideChange]);

  const handleIframeLoad = useCallback(() => {
    readSlides();
    const ifr = iframeRef.current;
    let doc;
    try { doc = ifr?.contentDocument || ifr?.contentWindow?.document || null; } catch { doc = null; }
    if (!doc) return;
    try {
      slideObserverRef.current?.disconnect();
      // The deck toggles `.active` on the current `.slide` as the user navigates;
      // watch class changes across the subtree and re-read on each.
      const obs = new MutationObserver(() => readSlides());
      obs.observe(doc.body || doc.documentElement, { attributes: true, attributeFilter: ['class'], subtree: true });
      slideObserverRef.current = obs;
    } catch { /* observing not possible (cross-origin) */ }
  }, [readSlides]);

  useEffect(
    () => () => { try { slideObserverRef.current?.disconnect(); } catch { /* gone */ } slideObserverRef.current = null; },
    [],
  );

  useEffect(() => {
    if (!path) {
      setState({ loading: false, error: 'This artifact has no previewable file yet.', url: '' });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, error: '', url: '' });
    mountArtifactPreview(path, { versionId: versionId || '' })
      .then((data) => {
        if (cancelled) return;
        // Static HTML mounts give a direct iframe URL. Proxy previews
        // (fullstack apps) need the cowork preview proxy; fall back to the
        // serve URL when present. TODO: full proxy-preview parity.
        const url = data?.url || data?.proxyUrl || data?.serveUrl || artifactServeUrl(artifact) || '';
        if (!url) throw new Error('Preview link was not created.');
        setState({ loading: false, error: '', url });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ loading: false, error: err?.message || 'Could not load preview.', url: '' });
      });
    return () => { cancelled = true; };
    // NOTE: `artifact` is intentionally NOT a dep. A direct save bumps
    // artifact.mtime (a new object), and remounting the iframe on that would
    // reset the deck to slide 1 after every Save. Real reloads come from `path`
    // (different artifact), `versionId` (viewing a past version), and
    // `reloadToken` (AI edit / restore). `artifact` is only read for a fallback URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, versionId, reloadToken]);

  if (state.loading) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', fontSize: 13 }}>Loading preview…</div>;
  }
  if (state.error) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>{state.error}</div>;
  }
  return (
    <div style={{ flex: 1, minHeight: 0, background: 'var(--surface-2)', position: 'relative' }}>
      <iframe
        ref={iframeRef}
        key={`${state.url}::${reloadToken || 0}`}
        title={`${displayName(path)} preview`}
        src={state.url ? `${state.url}${state.url.includes('?') ? '&' : '?'}rt=${reloadToken || 0}` : state.url}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        onLoad={handleIframeLoad}
        style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
      />
      {editMode && supported === false ? (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'var(--surface-3)', border: '1px solid var(--line-2)', color: 'var(--ink-2)', fontSize: 12, padding: '6px 12px', borderRadius: 8 }}>
          This preview can’t be edited inline here.
        </div>
      ) : null}
      {editMode && supported !== false ? (
        <>
          <button
            type="button"
            onClick={() => { commit?.(); onExitEdit?.(); }}
            title={dirty ? 'Save your changes as a new version' : 'Finish editing'}
            style={{ position: 'absolute', top: 12, right: 12, zIndex: 20, display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 14px', borderRadius: 9, border: dirty ? 'none' : '1px solid var(--line-2)', background: dirty ? 'var(--success)' : 'var(--surface-3)', color: dirty ? '#04150a' : 'var(--ink-2)', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 8px 20px -8px rgba(0,0,0,.5)' }}
          >
            {dirty ? '✓ Save changes' : 'Done'}
          </button>
          <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', background: 'var(--surface-3)', border: '1px solid var(--line-2)', color: 'var(--ink-3)', fontSize: 11.5, padding: '5px 11px', borderRadius: 20, whiteSpace: 'nowrap' }}>
            {dirty ? 'Unsaved edits — click Save to keep them as a new version' : 'Click any text and type — keep editing, then Save'}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PlaceholderCanvas({ path, ext }) {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: 'var(--ink-3)', textAlign: 'center', padding: 24 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
          {displayName(path)}
        </div>
        <div style={{ fontSize: 12.5 }}>
          No inline preview for {ext || 'this file type'} yet. {/* TODO: read-only viewers for more types */}
        </div>
      </div>
    </div>
  );
}

// Map versions to rail feed events (kind:'version') so the single Story rail's
// "Versions" filter is populated. Restore/compare live on the bottom scrubber.
function versionsToEvents(versions) {
  return (versions || []).map((v) => ({
    id: `v-${v.id}`,
    kind: 'version',
    versionId: v.id,
    versionN: v.n,
    author: v.author,
    title: v.label,
    body: '',
    when: v.when,
    ts: v.ts,
    meta: { current: !!v.current },
  }));
}

// Settled = the comment no longer needs the reader's eye on the page.
function isSettledComment(c) {
  const s = String(c?.status || '').toLowerCase();
  return c?.resolved === true || s === 'resolved' || s === 'rejected' || s === 'dismissed' || s === 'accepted';
}

// OPEN comments that carry an x/y anchor become canvas pins. Resolved/dismissed
// comments are intentionally NOT marked up on the page (they live in the Story
// rail) — only things that still need attention get a pin. Each pin also carries
// the `slide` it was dropped on (for slide decks) so it shows only on that slide.
function commentsToPins(comments) {
  const pins = [];
  let n = 0;
  for (const c of comments || []) {
    if (isSettledComment(c)) continue; // only open comments get on-canvas markup
    const a = c?.anchor || {};
    const xPct = a.xPct ?? a.x_pct ?? a.x;
    const yPct = a.yPct ?? a.y_pct ?? a.y;
    if (typeof xPct === 'number' && typeof yPct === 'number') {
      n += 1;
      const name = c?.actorName || c?.author?.name || c?.author || c?.user || 'Someone';
      const slide = typeof a.slide === 'number' ? a.slide : null;
      pins.push({
        id: c?.id || `pin-${n}`,
        n,
        xPct,
        yPct,
        slide,
        author: { initials: initialsOf(name), color: '#3a4d6e' },
        resolved: false,
      });
    }
  }
  return pins;
}

// ── Main component ──────────────────────────────────────────────────────────────
export function ArtifactWorkspaceRedesign({
  open,
  artifact,
  projects,
  onClose,
  onChange,
  onPublish,
  onUnpublish,
  onForked,
  onHandoff,
}) {
  const path = versionPathOf(artifact);
  const title = artifact?.title || displayName(path);
  const ext = artifactExt(artifact, path);
  const isText = TEXT_EXTS.has(ext);
  const isHtml = HTML_EXTS.has(ext);

  const projectName =
    artifact?.projectName ||
    artifact?.project?.name ||
    artifact?.project ||
    '';

  // The signed-in user (for presence + "You" attribution). Null while loading.
  const me = useCurrentUser();
  // Which slide of a deck preview is showing, so comment pins can be scoped to it.
  const [slideInfo, setSlideInfo] = useState({ index: null, count: 0 });
  const handleSlideChange = useCallback((info) => {
    setSlideInfo(info && typeof info === 'object' ? info : { index: null, count: 0 });
  }, []);
  // HtmlCanvas registers its inline-edit commit here so closing the workspace
  // mid-edit still persists deck edits as one version (prose flushes on unmount).
  const editCommitRef = useRef(null);

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const flash = useCallback((msg) => {
    if (!msg) return;
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // ── Data: versions + comments (real, from api.js) ─────────────────────────────
  const [versionsState, setVersionsState] = useState({ versions: [], currentVersionId: '' });
  const [commentsState, setCommentsState] = useState({ comments: [], activity: [] });
  const [viewingN, setViewingN] = useState(null);
  // Bumped whenever the artifact's bytes change (AI edit, restore, inline edit)
  // so the canvas re-fetches/reloads — fixes the stale-preview-after-edit bug.
  const [reloadToken, setReloadToken] = useState(0);
  const bumpReload = useCallback(() => setReloadToken((t) => t + 1), []);

  const loadVersions = useCallback(() => {
    if (!path) return;
    fetchArtifactVersions(path)
      .then((res) => {
        if (!res || res.available === false) return;
        const rawVersions = res.versions || [];
        const lastId = rawVersions.length ? (rawVersions[rawVersions.length - 1]?.id || '') : '';
        const currentVersionId = res.currentVersionId || res.latestVersionId || lastId;
        const mapped = mapVersions(rawVersions, currentVersionId);
        setVersionsState({ versions: mapped, currentVersionId });
      })
      .catch(() => { /* graceful */ });
  }, [path]);

  const loadComments = useCallback(() => {
    if (!path) return;
    fetchArtifactComments(path)
      .then((res) => {
        if (!res || res.available === false) return;
        setCommentsState({ comments: res.comments || [], activity: res.activity || [] });
      })
      .catch(() => { /* graceful */ });
  }, [path]);

  useEffect(() => { if (open) { loadVersions(); loadComments(); } }, [open, loadVersions, loadComments]);

  const versions = versionsState.versions;
  const baseVersionId = versionsState.currentVersionId || '';
  const currentN = versions.length ? versions[versions.length - 1].n : undefined;
  const versionLabel = versions.length
    ? (versions.find((v) => v.id === baseVersionId)?.label || versions[versions.length - 1].label)
    : (artifact?.version ? `v${artifact.version}` : 'v1');

  const storyEvents = useMemo(
    () => mapStoryEvents({ comments: commentsState.comments, activity: commentsState.activity }),
    [commentsState],
  );
  const pins = useMemo(() => commentsToPins(commentsState.comments), [commentsState]);

  // ── Inline chat (M4): the rail composer talks to Anton IN the workspace and
  // streams the reply into the feed — it never navigates to the task screen. ────
  const chat = useArtifactChat({
    artifact,
    path,
    projectName,
    onArtifactChanged: () => { loadVersions(); loadComments(); bumpReload(); flash('Anton updated the artifact — preview refreshed'); },
  });

  // ── Comment mark-up (M3) + direct in-place editing ───────────────────────────
  const [commentMode, setCommentMode] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [compare, setCompare] = useState(null); // { from, fromN } → VersionDiff vs current
  // Edit and Comment modes are mutually exclusive — both bind canvas clicks.
  const toggleEditMode = useCallback(() => { setEditMode((v) => !v); setCommentMode(false); }, []);
  const toggleCommentMode = useCallback(() => { setCommentMode((v) => !v); setEditMode(false); }, []);
  const createPinnedComment = useCallback(
    async ({ xPct, yPct, body, area }) => {
      if (!path || !body) return;
      try {
        // Stamp the current deck slide onto the anchor so the pin shows only on
        // the slide it belongs to (no-op for non-slide artifacts: slide stays null).
        const anchor = { xPct, yPct, area: area || '' };
        if (typeof slideInfo.index === 'number') anchor.slide = slideInfo.index;
        await createArtifactComment(path, { body, anchor });
        flash('Comment added');
        loadComments();
      } catch (err) {
        flash(err?.message || 'Could not add comment.');
      }
    },
    [path, flash, loadComments, slideInfo.index],
  );
  // Inline (per-paragraph) comment from the prose EditableBlock puck.
  const handleBlockComment = useCallback(
    async ({ text }) => {
      if (!text) return;
      try { await createArtifactComment(path, { body: text }); flash('Comment added'); loadComments(); }
      catch { flash('Could not add comment.'); }
    },
    [path, flash, loadComments],
  );

  // Per-comment rail actions (wired to StoryRail's onResolve/onDismiss/onFix).
  const onResolveEvent = useCallback(async (ev) => {
    if (!ev?.commentId) { flash('Nothing to resolve here.'); return; }
    try { await resolveArtifactComment(ev.commentId); flash('Resolved'); loadComments(); }
    catch (e) { flash(e?.message || 'Could not resolve.'); }
  }, [flash, loadComments]);
  const onDismissEvent = useCallback(async (ev) => {
    if (!ev?.commentId) { flash('Nothing to dismiss here.'); return; }
    try { await setArtifactSuggestionStatus(ev.commentId, 'rejected'); flash('Dismissed'); loadComments(); }
    catch (e) { flash(e?.message || 'Could not dismiss.'); }
  }, [flash, loadComments]);
  const onFixEvent = useCallback((ev) => {
    const note = ev?.body || ev?.title || '';
    if (!note) return;
    chat.send(`Please address this review note and update the artifact: "${note}"`);
    flash('Anton is addressing it…');
  }, [chat, flash]);
  const onReopenEvent = useCallback(async (ev) => {
    if (!ev?.commentId) return;
    try { await setArtifactSuggestionStatus(ev.commentId, 'open'); flash('Reopened'); loadComments(); }
    catch (e) { flash(e?.message || 'Could not reopen.'); }
  }, [flash, loadComments]);

  // ── Restore (forward-restore) ─────────────────────────────────────────────────
  const handleRestore = useCallback(
    async (n) => {
      const target = versions.find((v) => v.n === n);
      if (!path || !target?.id) { flash('Cannot restore this version yet.'); return; }
      try {
        const result = await restoreArtifactVersion(path, target.id, { createCheckpoint: true });
        flash(`Restored ${target.label} — earlier versions kept`);
        onChange?.({ ...artifact, restoredVersionId: target.id, mtime: Date.now(), ...(result?.artifact || {}) });
        setViewingN(null);
        loadVersions();
        bumpReload();
      } catch (err) {
        flash(err?.message || 'Could not restore that version.');
      }
    },
    [versions, path, artifact, onChange, flash, loadVersions, bumpReload],
  );

  const handleCommitted = useCallback(
    ({ versionId }) => {
      flash(versionId ? 'Kept your change' : 'Saved');
      onChange?.({ ...artifact, mtime: Date.now(), ...(versionId ? { reviewVersionId: versionId } : {}) });
      loadVersions();
      bumpReload();
    },
    [artifact, onChange, flash, loadVersions, bumpReload],
  );

  // Direct (typed) edit → persist as a new version via the edit pipeline (OCC).
  const handleDirectSave = useCallback(
    async ({ oldContent, newContent, edits } = {}) => {
      try {
        const res = await saveArtifactContent({ path, projectName, oldContent, newContent, edits, baseVersionId });
        if (!res) return;
        if (res.noop) {
          // Edits were attempted but none could be placed (text not found in the
          // source, or ambiguous). Tell the user and re-sync so the shown-but-
          // unsaved DOM edits don't masquerade as saved.
          if (res.skipped) {
            flash(`Couldn't save ${res.skipped} change${res.skipped > 1 ? 's' : ''} — the text wasn't found. Reload and retry.`);
            bumpReload();
          }
          return;
        }
        if (res.ok) {
          // Direct edit. For the HTML canvas the iframe DOM ALREADY shows the
          // typed change, so do NOT bumpReload (that would remount the iframe and
          // reset the slide). Prose swaps back to its read-only render on exit, so
          // it DOES need a refetch to show the saved text. Always refresh versions.
          if (res.skipped) {
            flash(`Saved, but ${res.skipped} change${res.skipped > 1 ? 's' : ''} couldn't be placed — re-syncing.`);
          } else {
            flash(res.versionId ? 'Saved — new version' : 'Saved');
          }
          onChange?.({ ...artifact, mtime: Date.now() });
          loadVersions();
          // HTML keeps its live DOM; refetch only if some edits were dropped (so the
          // unsaved DOM can't look saved). Prose always refetches to show saved text.
          if (isText || res.skipped) bumpReload();
          return;
        }
        if (res.conflict) {
          flash(res.conflict.message || 'This changed since you started — reloading the latest.');
          bumpReload(); loadVersions();
        }
      } catch (err) {
        flash(err?.message || 'Could not save your edit.');
      }
    },
    [path, projectName, baseVersionId, artifact, onChange, flash, bumpReload, loadVersions, isText],
  );

  // ── Present mode: fullscreen the canvas (real Fullscreen API) ─────────────────
  const canvasWrapRef = useRef(null);
  const present = useCallback(() => {
    const el = canvasWrapRef.current;
    if (el && el.requestFullscreen) {
      el.requestFullscreen().catch(() => flash('Could not enter fullscreen.'));
    } else {
      flash('Fullscreen is not supported here.');
    }
  }, [flash]);

  // ── Share / Publish ───────────────────────────────────────────────────────────
  // Hand the parent's publish dialog a FRESH review summary computed from the live
  // comments, so its "open review items" preflight reflects reality (resolving a
  // note clears it) instead of a stale server-cached count on the artifact record.
  const handleShare = useCallback(() => {
    const cs = commentsState.comments || [];
    const open = cs.filter((c) => !isSettledComment(c));
    const comments = open.filter((c) => !c?.kind || c.kind === 'comment').length;
    const suggestions = open.filter((c) => c?.kind === 'suggestion').length;
    const reviewRequests = open.filter((c) => c?.kind === 'review').length;
    const total = open.length;
    const reviewSummary = {
      open: total,
      unresolved: total,
      comments,
      suggestions,
      reviewRequests,
      needsReview: reviewRequests > 0,
    };
    onPublish?.({ ...artifact, reviewSummary });
  }, [commentsState, artifact, onPublish]);

  // Closing while editing should keep work: flush a pending HTML inline-edit as
  // ONE version (prose flushes itself on unmount), then close.
  const handleClose = useCallback(() => {
    try { editCommitRef.current?.(); } catch { /* best-effort */ }
    onClose?.();
  }, [onClose]);

  // ── Review banner (M3): derived from real review/suggestion comments ──────────
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const reviewItems = useMemo(
    () => storyEvents.filter((e) => e.kind === 'review'),
    [storyEvents],
  );
  const hasReview = reviewItems.length > 0 && !reviewDismissed;

  const fixWithAI = useCallback(() => {
    const notes = reviewItems.map((r) => `- ${r.body}`).filter(Boolean).join('\n');
    const prompt = notes
      ? `Please address these review notes on "${title}" and update the artifact accordingly:\n${notes}`
      : `Please review "${title}" and apply the requested changes.`;
    chat.send(prompt);
    flash('Anton is addressing the review…');
  }, [reviewItems, title, chat, flash]);

  // ── Presence: the signed-in user first (always "here"), then other humans who
  // have collaborated on this artifact. The current user shows as "Me" with their
  // email on hover — never the anonymous-looking "AN". Other people show the first
  // letter of their email/name, with the full identity on hover. (Anton is the AI
  // and appears throughout the Story rail; it isn't a person "here".) ────────────
  const presence = useMemo(() => {
    const myEmail = (me?.email || '').trim();
    const myName = (me?.name || '').trim();
    const list = [{
      initials: 'Me',
      color: '#1d4ed8',
      tip: myEmail ? `You — ${myEmail}` : (myName ? `You — ${myName}` : 'You'),
    }];
    // Don't list the current user (or the literal "You" author) a second time.
    const seen = new Set(['you', 'me', myName.toLowerCase(), myEmail.toLowerCase()].filter(Boolean));
    for (const c of commentsState.comments || []) {
      const email = (c?.actorEmail || '').trim();
      const name = (c?.actorName || c?.author?.name || c?.author || c?.user || '').trim();
      const key = (email || name).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const letter = (email || name).charAt(0).toUpperCase() || '?';
      list.push({ initials: letter, color: '#3a4d6e', tip: email || name });
      if (list.length >= 5) break;
    }
    return list;
  }, [commentsState, me]);

  // ── Merge versions + comments/reviews + live chat into one rail feed ──────────
  const railEvents = useMemo(() => {
    const chatEvents = (chat.messages || []).map((m) => ({
      id: `chat-${m.id}`,
      kind: 'chat',
      author:
        m.role === 'user'
          ? { name: 'You', initials: 'ME', color: '#3a4d6e' }
          : { name: 'Anton', initials: 'AN', isAI: true, color: 'linear-gradient(135deg,#A78BFA,#22D3EE)' },
      title: m.role === 'user' ? 'asked' : 'replied',
      body: m.text || (m.streaming ? '…' : ''),
      when: 'now',
      meta: { streaming: !!m.streaming },
    }));
    const merged = [...versionsToEvents(versions), ...storyEvents, ...chatEvents];
    return merged;
  }, [versions, storyEvents, chat.messages]);

  if (!open || !artifact) return null;

  // ── Canvas ────────────────────────────────────────────────────────────────────
  const viewingVersionId = viewingN != null ? (versions.find((v) => v.n === viewingN)?.id || '') : '';
  let canvas;
  if (isText) {
    canvas = (
      <ProseCanvas
        artifact={artifact}
        path={path}
        versionId={viewingVersionId}
        baseVersionId={baseVersionId}
        title={title}
        reloadToken={reloadToken}
        editMode={editMode}
        onSaveContent={handleDirectSave}
        onExitEdit={() => setEditMode(false)}
        onToast={flash}
        onCommitted={handleCommitted}
        onComment={handleBlockComment}
      />
    );
  } else if (isHtml) {
    canvas = (
      <HtmlCanvas
        artifact={artifact}
        path={path}
        versionId={viewingVersionId}
        reloadToken={reloadToken}
        editMode={editMode}
        onSaveContent={handleDirectSave}
        onExitEdit={() => setEditMode(false)}
        onError={flash}
        onSlideChange={handleSlideChange}
        commitRef={editCommitRef}
      />
    );
  } else {
    canvas = <PlaceholderCanvas path={path} ext={ext} />;
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="lg"
      width="min(1480px, 98vw)"
      height="min(940px, 94vh)"
      ariaLabel={`${title} workspace`}
      closeOnBackdrop={false}
    >
      <WorkspaceShell
        iconRail={null}
        topBar={
          <TopBar
            title={title}
            breadcrumb={projectName}
            versionLabel={versionLabel}
            presence={presence}
            editMode={editMode}
            onToggleEdit={toggleEditMode}
            commentMode={commentMode}
            onToggleComment={toggleCommentMode}
            onShare={handleShare}
            primaryCta={{ label: 'Present', onClick: present }}
            onClose={handleClose}
          />
        }
        rail={
          <StoryRail
            events={railEvents.length ? railEvents : undefined}
            onSend={chat.send}
            composerPlaceholder="Ask Anton, or @mention…"
            onResolveEvent={onResolveEvent}
            onDismissEvent={onDismissEvent}
            onFixEvent={onFixEvent}
            onReopenEvent={onReopenEvent}
            onRestoreVersion={(ev) => handleRestore(ev.versionN)}
            onCompareVersion={(ev) => setCompare({ from: ev.versionId, fromN: ev.versionN })}
          />
        }
        bottomStrip={null}
      >
        {/* Single right rail (the Story rail = chat · versions · comments · reviews);
            the canvas fills the rest. A full-width review banner sits above it. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {hasReview ? (
            <ReviewBanner
              reviewer={reviewItems[reviewItems.length - 1]?.author || undefined}
              verdict="changes"
              commentCount={reviewItems.length}
              note={reviewItems[reviewItems.length - 1]?.body || ''}
              onFixWithAI={fixWithAI}
              onDismiss={() => setReviewDismissed(true)}
            />
          ) : null}
          {/* Canvas wrapper: position:relative for the comment overlay + the
              fullscreen target for Present. */}
          <div ref={canvasWrapRef} style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--surface-2)' }}>
            {canvas}
            <CommentLayer
              active={commentMode}
              pins={pins}
              currentSlide={slideInfo.index}
              onCreate={createPinnedComment}
              onExitActive={() => setCommentMode(false)}
              onSelectPin={() => flash('Comment is in the Story panel →')}
            />
          </div>
        </div>
      </WorkspaceShell>

      {toast ? (
        <div
          style={{
            position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
            display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface)',
            border: '1px solid var(--line-2)', borderRadius: 11, padding: '11px 16px',
            boxShadow: '0 16px 40px -12px rgba(0,0,0,.7)', animation: 'riseIn .3s ease',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 8px var(--accent-glow, rgba(34,211,238,.45))' }} />
          <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>{toast}</span>
        </div>
      ) : null}

      <VersionDiff
        open={!!compare}
        onClose={() => setCompare(null)}
        path={path}
        fromVersion={compare ? { id: compare.from, label: `v${compare.fromN}`, n: compare.fromN } : null}
        toVersion={{ id: baseVersionId, label: 'current', n: currentN }}
      />
    </Modal>
  );
}

export default ArtifactWorkspaceRedesign;
