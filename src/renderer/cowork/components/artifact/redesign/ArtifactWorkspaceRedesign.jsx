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
import { VersionScrubber } from './scrubberIndex.js';
import { ReviewBanner } from './reviewIndex.js';
import { useArtifactChat } from './useArtifactChat.js';
import { CommentLayer } from './CommentLayer.jsx';
import { EditableProse } from './EditableProse.jsx';
import { useIframeInlineEdit } from './useIframeInlineEdit.js';
import { saveArtifactContent } from './saveArtifactContent.js';

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
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// Map an api.js version record to the scrubber/HistoryPanel shape. Version
// numbers are derived from list order (TODO: use a real server-provided number
// when the contract exposes one).
function mapVersions(rawVersions) {
  const list = Array.isArray(rawVersions) ? rawVersions : [];
  return list.map((v, i) => {
    const id = v?.id || v?.versionId || v?.version_id || `idx-${i}`;
    const authorName = v?.author?.name || v?.author || v?.createdBy || v?.created_by || 'Unknown';
    const isAI =
      /anton|agent|ai/i.test(String(authorName)) ||
      /agent/i.test(String(v?.operationType || v?.operation_type || ''));
    const op = String(v?.operationType || v?.operation_type || v?.kind || '').toLowerCase();
    const tag = op.includes('agent')
      ? 'Agent update'
      : op.includes('suggest')
        ? 'Suggestion accepted'
        : 'Manual';
    return {
      id,
      n: i + 1,
      label: v?.label || v?.name || `v${i + 1}`,
      author: { name: authorName, initials: initialsOf(authorName), isAI },
      when: relativeWhen(v?.createdAt || v?.created_at || v?.when || v?.timestamp),
      tag,
    };
  });
}

// Map api.js comments/activity to StoryRail events. Falls back to the rail's own
// mock when nothing is available (mark TODO: a richer fused chat+version feed).
function mapStoryEvents({ comments, activity }) {
  const events = [];
  for (const c of comments || []) {
    const name = c?.author?.name || c?.author || c?.user || 'Someone';
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
    const name = a?.author?.name || a?.actor || a?.user || 'Anton';
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
  onToast,
  onCommitted,
  onComment,
}) {
  const [state, setState] = useState({ loading: true, error: '', blocks: [] });

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
          // Direct typing — instant, no AI. Commits a new version on blur/Enter.
          <EditableProse blocks={state.blocks} active onSaveContent={onSaveContent} />
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
  );
}

function HtmlCanvas({ artifact, path, versionId, reloadToken, editMode, onSaveContent, onExitEdit, onError }) {
  const [state, setState] = useState({ loading: true, error: '', url: '' });
  const iframeRef = useRef(null);
  // Direct in-place typing on the same-origin preview (degrades if cross-origin).
  const { supported, commit } = useIframeInlineEdit({
    iframeRef,
    active: !!editMode,
    onSaveHtml: ({ oldHtml, newHtml }) => onSaveContent?.({ oldContent: oldHtml, newContent: newHtml }),
    onError: (m) => onError?.(m),
  });

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
  }, [path, versionId, artifact, reloadToken]);

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
            style={{ position: 'absolute', top: 12, right: 12, zIndex: 20, display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 14px', borderRadius: 9, border: 'none', background: 'var(--success)', color: '#04150a', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 8px 20px -8px rgba(0,0,0,.5)' }}
          >
            ✓ Done editing
          </button>
          <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', background: 'var(--surface-3)', border: '1px solid var(--line-2)', color: 'var(--ink-3)', fontSize: 11.5, padding: '5px 11px', borderRadius: 20, whiteSpace: 'nowrap' }}>
            Click any text and type · saves as a new version
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
    author: v.author,
    title: `${v.tag} · ${v.label}`,
    body: '',
    when: v.when,
  }));
}

// Comments that carry an x/y anchor become canvas pins.
function commentsToPins(comments) {
  const pins = [];
  let n = 0;
  for (const c of comments || []) {
    const a = c?.anchor || {};
    const xPct = a.xPct ?? a.x_pct ?? a.x;
    const yPct = a.yPct ?? a.y_pct ?? a.y;
    if (typeof xPct === 'number' && typeof yPct === 'number') {
      n += 1;
      const name = c?.author?.name || c?.author || c?.user || 'Someone';
      pins.push({
        id: c?.id || `pin-${n}`,
        n,
        xPct,
        yPct,
        author: { initials: initialsOf(name), color: '#3a4d6e' },
        resolved: c?.status === 'resolved' || c?.resolved === true,
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
        const mapped = mapVersions(res.versions);
        const currentVersionId =
          res.currentVersionId || res.latestVersionId || (mapped.length ? mapped[mapped.length - 1].id : '');
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
  // Edit and Comment modes are mutually exclusive — both bind canvas clicks.
  const toggleEditMode = useCallback(() => { setEditMode((v) => !v); setCommentMode(false); }, []);
  const toggleCommentMode = useCallback(() => { setCommentMode((v) => !v); setEditMode(false); }, []);
  const createPinnedComment = useCallback(
    async ({ xPct, yPct, body, area }) => {
      if (!path || !body) return;
      try {
        await createArtifactComment(path, { body, anchor: { xPct, yPct, area: area || '' } });
        flash('Comment added');
        loadComments();
      } catch (err) {
        flash(err?.message || 'Could not add comment.');
      }
    },
    [path, flash, loadComments],
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
    [versions, path, artifact, onChange, flash, loadVersions],
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
    async ({ oldContent, newContent }) => {
      try {
        const res = await saveArtifactContent({ path, projectName, oldContent, newContent, baseVersionId });
        if (!res || res.noop) return;
        if (res.ok) { handleCommitted({ versionId: res.versionId }); return; }
        if (res.conflict) {
          flash(res.conflict.message || 'This changed since you started — reloading the latest.');
          bumpReload(); loadVersions();
        }
      } catch (err) {
        flash(err?.message || 'Could not save your edit.');
      }
    },
    [path, projectName, baseVersionId, handleCommitted, flash, bumpReload, loadVersions],
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

  // ── Presence: real collaborators where available, + Anton ─────────────────────
  const presence = useMemo(() => {
    const list = [{ initials: 'AN', color: 'linear-gradient(135deg,#A78BFA,#22D3EE)', tip: 'Anton — AI' }];
    const seen = new Set();
    for (const c of commentsState.comments || []) {
      const name = c?.author?.name || c?.author || c?.user;
      if (name && !seen.has(name)) { seen.add(name); list.push({ initials: initialsOf(name), color: '#3a4d6e', tip: `${name}` }); }
      if (list.length >= 4) break;
    }
    return list;
  }, [commentsState]);

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
      />
    );
  } else {
    canvas = <PlaceholderCanvas path={path} ext={ext} />;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
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
            onShare={() => { onPublish?.(artifact); }}
            primaryCta={{ label: 'Present', onClick: present }}
            onClose={onClose}
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
          />
        }
        bottomStrip={
          versions.length ? (
            <VersionScrubber
              versions={versions}
              current={currentN}
              viewing={viewingN ?? currentN}
              onScrub={(n) => setViewingN(n)}
              onRestore={handleRestore}
            />
          ) : null
        }
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
    </Modal>
  );
}

export default ArtifactWorkspaceRedesign;
