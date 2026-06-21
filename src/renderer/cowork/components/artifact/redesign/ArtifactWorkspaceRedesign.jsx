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
import { WorkspaceShell, IconRail, TopBar } from './index.js';
import { StoryRail } from './storyRailIndex.js';
import { EditableBlock } from './editIndex.js';
import { VersionScrubber, HistoryPanel } from './scrubberIndex.js';
import { ReviewBanner } from './reviewIndex.js';

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
} from '../../../api';

// ── Flag ──────────────────────────────────────────────────────────────────────
export const REDESIGN_FLAG_KEY = 'anton:artifact-workspace-direction-2';

/**
 * shouldUseRedesign — true when the per-machine localStorage flag is explicitly
 * on. Default OFF (and safe when localStorage is unavailable), so existing
 * behavior is byte-identical unless a user opts in via:
 *   localStorage.setItem('anton:artifact-workspace-direction-2', 'true')
 *
 * Accepts the workspace props for parity / future per-artifact gating, but the
 * current decision is global.
 */
export function shouldUseRedesign(_props) {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(REDESIGN_FLAG_KEY) === 'true';
  } catch {
    return false;
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
    events.push({
      id: `c-${c?.id || events.length}`,
      kind: c?.kind === 'suggestion' ? 'review' : 'comment',
      author: { name, initials: initialsOf(name), color: '#3a4d6e' },
      title: c?.kind === 'suggestion' ? 'suggested a change' : 'commented',
      body: c?.body || c?.text || '',
      when: relativeWhen(c?.createdAt || c?.created_at || c?.when),
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
  }, [path, versionId]);

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
        if (err?.status === 404 || err?.status === 405 || err?.status === 501) {
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
        if (err?.status === 404 || err?.status === 405 || err?.status === 501) {
          // No accept endpoint yet — mock a successful commit so Keep works.
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

function HtmlCanvas({ artifact, path, versionId }) {
  const [state, setState] = useState({ loading: true, error: '', url: '' });

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
  }, [path, versionId, artifact]);

  if (state.loading) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', fontSize: 13 }}>Loading preview…</div>;
  }
  if (state.error) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>{state.error}</div>;
  }
  return (
    <div style={{ flex: 1, minHeight: 0, background: 'var(--surface-2)' }}>
      <iframe
        title={`${displayName(path)} preview`}
        src={state.url}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
      />
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

// ── Dock (right-rail tabs that aren't the Story timeline) ───────────────────────
function Dock({ tab, onTab, versions, currentN, onPreview, onCompare, onRestore, review }) {
  const tabs = [
    { id: 'history', label: 'History' },
    { id: 'review', label: 'Review' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)', borderLeft: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', gap: 4, padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            className="rd-no-truncate"
            style={{
              height: 28,
              padding: '0 12px',
              borderRadius: 8,
              border: `1px solid ${tab === t.id ? 'var(--accent)' : 'var(--line-2)'}`,
              background: tab === t.id ? 'var(--accent-bg)' : 'transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--ink-3)',
              fontSize: 12,
              fontWeight: tab === t.id ? 600 : 500,
              fontFamily: 'var(--font-body)',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === 'history' ? (
          <HistoryPanel versions={versions} current={currentN} onPreview={onPreview} onCompare={onCompare} onRestore={onRestore} />
        ) : (
          <div style={{ padding: 14 }}>
            <ReviewBanner
              reviewer={review.reviewer}
              verdict={review.verdict}
              commentCount={review.commentCount}
              note={review.note}
              onFixWithAI={review.onFixWithAI}
              onView={review.onView}
            />
            {/* TODO: full ReviewerView / VerdictBar flow wired to the review API */}
          </div>
        )}
      </div>
    </div>
  );
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

  // Versions (real, from api.js). currentVersionId drives the M1 compare-and-swap.
  const [versionsState, setVersionsState] = useState({ versions: [], currentVersionId: '' });
  const [storyEvents, setStoryEvents] = useState(null); // null → StoryRail mock
  const [viewingN, setViewingN] = useState(null);

  useEffect(() => {
    if (!open || !path) return undefined;
    let cancelled = false;
    fetchArtifactVersions(path)
      .then((res) => {
        if (cancelled || !res || res.available === false) return;
        const mapped = mapVersions(res.versions);
        const currentVersionId = res.currentVersionId || res.latestVersionId || (mapped.length ? mapped[mapped.length - 1].id : '');
        setVersionsState({ versions: mapped, currentVersionId });
      })
      .catch(() => { /* graceful: keep mock scrubber */ });
    return () => { cancelled = true; };
  }, [open, path]);

  useEffect(() => {
    if (!open || !path) return undefined;
    let cancelled = false;
    fetchArtifactComments(path)
      .then((res) => {
        if (cancelled || !res || res.available === false) return;
        const events = mapStoryEvents({ comments: res.comments, activity: res.activity });
        if (events.length) setStoryEvents(events);
      })
      .catch(() => { /* graceful: keep mock story */ });
    return () => { cancelled = true; };
  }, [open, path]);

  const versions = versionsState.versions;
  const baseVersionId = versionsState.currentVersionId || '';
  const currentN = versions.length ? versions[versions.length - 1].n : undefined;
  const versionLabel = versions.length
    ? (versions.find((v) => v.id === baseVersionId)?.label || versions[versions.length - 1].label)
    : (artifact?.version ? `v${artifact.version}` : 'v1');

  // Restore a version (forward-restore) via the real API; tell the host so the
  // outer list refreshes, mirroring the legacy onChange contract.
  const handleRestore = useCallback(
    async (n) => {
      const target = versions.find((v) => v.n === n);
      if (!path || !target?.id) { flash('Cannot restore this version yet.'); return; }
      try {
        const result = await restoreArtifactVersion(path, target.id, { createCheckpoint: true });
        flash(`Restored ${target.label} — earlier versions kept`);
        onChange?.({ ...artifact, restoredVersionId: target.id, mtime: Date.now(), ...(result?.artifact || {}) });
        setViewingN(null);
      } catch (err) {
        flash(err?.message || 'Could not restore that version.');
      }
    },
    [versions, path, artifact, onChange, flash],
  );

  // StoryRail composer → hand off to a follow-up task (real wiring via onHandoff).
  const handleSend = useCallback(
    async (text) => {
      if (!text) return;
      if (onHandoff) {
        try {
          await onHandoff(artifact, { path, prompt: text });
          flash('Started a follow-up task');
          return;
        } catch (err) {
          flash(err?.message || 'Could not start a task.');
          return;
        }
      }
      // No handoff host → persist as a comment so the message isn't lost.
      try {
        await createArtifactComment(path, { body: text });
        flash('Added to the conversation');
      } catch {
        flash('Message noted'); // TODO: real chat transport
      }
    },
    [onHandoff, artifact, path, flash],
  );

  const handleCommitted = useCallback(
    ({ versionId }) => {
      flash(versionId ? 'Kept your change' : 'Saved');
      onChange?.({ ...artifact, mtime: Date.now(), ...(versionId ? { reviewVersionId: versionId } : {}) });
    },
    [artifact, onChange, flash],
  );

  const handleBlockComment = useCallback(
    async ({ text }) => {
      if (!text) return;
      try { await createArtifactComment(path, { body: text }); flash('Comment added'); }
      catch { flash(`Comment: "${text}"`); }
    },
    [path, flash],
  );

  const [dockTab, setDockTab] = useState('history');

  // Presence is mock/derived for now (TODO: real presence channel).
  const presence = useMemo(() => {
    const list = [{ initials: 'AN', color: 'linear-gradient(135deg,#A78BFA,#22D3EE)', tip: 'Anton — AI' }];
    if (artifact?.owner || artifact?.author) {
      const name = artifact.owner || artifact.author;
      list.push({ initials: initialsOf(name), color: '#3a4d6e', tip: `${name} — viewing` });
    }
    return list;
  }, [artifact]);

  if (!open || !artifact) return null;

  // Canvas selection.
  let canvas;
  if (isText) {
    canvas = (
      <ProseCanvas
        artifact={artifact}
        path={path}
        versionId={viewingN != null ? (versions.find((v) => v.n === viewingN)?.id || '') : ''}
        baseVersionId={baseVersionId}
        title={title}
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
        versionId={viewingN != null ? (versions.find((v) => v.n === viewingN)?.id || '') : ''}
      />
    );
  } else {
    canvas = <PlaceholderCanvas path={path} ext={ext} />;
  }

  const review = {
    reviewer: { name: 'Maya Chen', initials: 'MC', color: 'linear-gradient(135deg,#A78BFA,#22D3EE)' },
    verdict: 'changes',
    commentCount: (storyEvents || []).filter((e) => e.kind === 'comment' || e.kind === 'review').length || 2,
    note: 'Review feedback appears here once a reviewer responds.', // TODO: real review summary
    onFixWithAI: () => flash('Hand the review notes to Anton (TODO: wire to M1 pipeline)'),
    onView: () => setDockTab('review'),
  };

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
        iconRail={<IconRail activeNav="artifact" />}
        topBar={
          <TopBar
            title={title}
            breadcrumb={projectName}
            versionLabel={versionLabel}
            presence={presence}
            onShare={() => { onPublish?.(artifact); flash('Share / publish'); }}
            primaryCta={{ label: 'Present', onClick: () => flash('Present (TODO)') }}
          />
        }
        rail={
          <StoryRail
            events={storyEvents || undefined}
            onSend={handleSend}
            composerPlaceholder="Ask Anton, or @mention…"
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
        {/* Body: canvas + dock side-by-side. The Story rail is the WorkspaceShell
            `rail` slot; the dock (History/Review) sits between canvas and rail. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {canvas}
          </div>
          <div style={{ width: 300, flexShrink: 0 }}>
            <Dock
              tab={dockTab}
              onTab={setDockTab}
              versions={versions}
              currentN={currentN}
              onPreview={(n) => setViewingN(n)}
              onCompare={(n) => { setViewingN(n); setDockTab('history'); }}
              onRestore={handleRestore}
              review={review}
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
