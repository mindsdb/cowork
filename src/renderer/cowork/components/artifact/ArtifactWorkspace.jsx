import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../Icons';
import { ConfirmModal } from '../ConfirmModal';
import { Modal } from '../ui/Modal';
import { MarkdownContent } from '../markdown/MarkdownContent';
import { copyText } from '../../lib/clipboard';
import { ArtifactWorkspaceA, shouldUseArtifactWorkspaceA } from './workspaceA/ArtifactWorkspaceA';
import {
  artifactServeUrl,
  createArtifactCheckpoint,
  createArtifactComment,
  createProjectNotificationHook,
  deleteProjectCollaborator,
  deleteProjectNotificationHook,
  fetchArtifactChanges,
  fetchArtifactComments,
  fetchArtifactVersions,
  fetchProjectCollaborators,
  fetchProjectInvitations,
  fetchProjectNotificationDeliveries,
  fetchProjectNotificationHooks,
  fetchProjects,
  forkArtifactVersion,
  inviteProjectCollaborator,
  markArtifactCommentsRead,
  mountArtifactPreview,
  previewArtifactCommentPatch,
  previewArtifact,
  publishTargetPath,
  restoreArtifactVersion,
  resendProjectInvitation,
  retryProjectNotificationDelivery,
  applyArtifactCommentPatch,
  revokeProjectInvitation,
  setArtifactCommentResolved,
  setArtifactSuggestionStatus,
  testProjectNotificationHook,
  updateProjectCollaborator,
  updateProjectNotificationHook,
} from '../../api';

const FONT_BODY = 'var(--font-body)';
const FONT_DISPLAY = 'var(--font-display)';
const FONT_MONO = 'var(--font-mono)';

const TEXT_PREVIEW_EXTS = new Set(['.md', '.txt', '.csv']);
const BACKEND_ARTIFACT_TYPES = new Set(['fullstack-stateless-app', 'fullstack-stateful-app']);

const TABS = [
  { id: 'comments', label: 'Comments', icon: Ico.chats },
  { id: 'changes', label: 'Compare', icon: Ico.code },
  { id: 'history', label: 'Versions', icon: Ico.clock },
  { id: 'activity', label: 'Activity', icon: Ico.list },
  { id: 'share', label: 'Share', icon: Ico.link },
];

const CURRENT_DRAFT_VALUE = '__current_draft__';

function extOfPath(p) {
  if (!p || typeof p !== 'string') return '';
  const m = p.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
}

function isTextArtifact(a) {
  if (!a) return false;
  const declared = (a.ext || '').toLowerCase();
  const ext = declared || extOfPath(a.canonicalPath || a.file_path || a.path);
  return TEXT_PREVIEW_EXTS.has(ext);
}

function isPreviewablePathForArtifact(path, { isText = false, isBackendArtifact = false } = {}) {
  if (!path) return false;
  const ext = extOfPath(path);
  if (isText) return TEXT_PREVIEW_EXTS.has(ext);
  if (isBackendArtifact) return true;
  return ext === '.html' || ext === '.htm';
}

function withVersion(url, version) {
  if (!url || version == null || version === '') return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(version)}`;
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function displayName(path) {
  if (!path) return 'Artifact';
  return String(path).split(/[\\/]/).filter(Boolean).pop() || path;
}

function fileOptionValue(file) {
  return file?.path || file?.name || '';
}

function fileOptionLabel(file) {
  if (!file) return '';
  const name = file.name || displayName(file.path);
  return file.role ? `${name} · ${file.role}` : name;
}

function anchorOf(comment) {
  const anchor = comment?.anchor || {};
  return anchor && typeof anchor === 'object' && !Array.isArray(anchor) ? anchor : {};
}

function anchorText(anchor) {
  const file = anchor?.file || anchor?.path || anchor?.target || '';
  const detail = anchor?.detail || anchor?.section || anchor?.line || anchor?.row || '';
  const fileText = file ? displayName(file) : '';
  if (fileText && detail) return `${fileText} · ${detail}`;
  return fileText || detail || '';
}

function anchorFileValue(anchor) {
  return anchor?.file || anchor?.path || anchor?.target || '';
}

function anchorDetailText(anchor) {
  return anchor?.detail || anchor?.section || anchor?.line || anchor?.row || '';
}

function reviewKindText(kind) {
  if (kind === 'suggestion') return 'Suggested change';
  if (kind === 'review') return 'Asked for review';
  if (kind === 'file') return 'File context';
  return 'Comment';
}

function reviewSelectionConsequence(selection) {
  if (!selection) return '';
  if (selection.kind === 'suggestion' && selection.hasPatch) {
    return 'Accepting applies this exact change to the current draft and saves a checkpoint. The public link stays pinned until republished.';
  }
  if (selection.kind === 'suggestion') {
    return 'Approving records the decision. It does not change the draft unless an exact change is attached.';
  }
  if (selection.kind === 'review') {
    return 'Use this as review context or start a follow-up task. The draft and public link do not change automatically.';
  }
  if (selection.kind === 'file') {
    return 'Showing file context only. No draft or published version changes from this selection.';
  }
  return 'This is context for discussion. The draft and public link do not change automatically.';
}

function suggestionStatusOfComment(comment) {
  return (
    comment?.suggestionStatus
    || comment?.suggestion_status
    || (['accepted', 'rejected', 'open'].includes(comment?.status) ? comment.status : '')
    || ''
  );
}

function isResolvedComment(comment) {
  return !!(comment?.resolved || comment?.status === 'resolved');
}

function isClosedReviewComment(comment) {
  const suggestionStatus = suggestionStatusOfComment(comment);
  return !!(isResolvedComment(comment) || suggestionStatus === 'accepted' || suggestionStatus === 'rejected');
}

function reviewSummaryFromComments(comments = []) {
  const list = Array.isArray(comments) ? comments : [];
  const openComments = list.filter((comment) => !isClosedReviewComment(comment));
  const commentsCount = openComments.filter((comment) => comment?.kind === 'comment').length;
  const suggestions = openComments.filter((comment) => comment?.kind === 'suggestion').length;
  const reviewRequests = openComments.filter((comment) => comment?.kind === 'review').length;
  return {
    open: openComments.length,
    comments: commentsCount,
    suggestions,
    reviewRequests,
    unresolved: openComments.length,
    openNotes: openComments.length,
    needsReview: suggestions > 0 || reviewRequests > 0,
    hasReview: list.length > 0 || openComments.length > 0 || suggestions > 0 || reviewRequests > 0,
  };
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function normalizeFiles(artifact) {
  const raw =
    (Array.isArray(artifact?.files) && artifact.files)
    || (Array.isArray(artifact?.manifest?.files) && artifact.manifest.files)
    || (Array.isArray(artifact?.structure?.files) && artifact.structure.files)
    || [];

  const files = raw
    .map((item) => {
      if (typeof item === 'string') return { path: item, name: displayName(item) };
      const path = item?.path || item?.file || item?.name || '';
      return {
        path,
        name: item?.name || displayName(path),
        role: item?.role || item?.kind || item?.type || '',
        size: item?.size || item?.bytes || null,
      };
    })
    .filter((item) => item.path || item.name);

  if (files.length) return files.slice(0, 24);

  const primary = artifact?.canonicalPath || artifact?.file_path || artifact?.path || '';
  if (!primary) return [];
  return [{
    path: primary,
    name: displayName(primary),
    role: 'Primary',
  }];
}

function versionPathOf(artifact) {
  return artifact?.canonicalPath
    || artifact?.file_path
    || artifact?.path
    || publishTargetPath(artifact)
    || '';
}

function truthyMeta(value) {
  return value === true || value === 'true' || value === 'yes' || value === 'requested' || value === 'broken';
}

function inferBrokenPreview(artifact, previewFailed) {
  return previewFailed
    || truthyMeta(artifact?.previewBroken)
    || truthyMeta(artifact?.brokenPreview)
    || artifact?.previewStatus === 'broken'
    || artifact?.preview_status === 'broken'
    || artifact?.draftPreviewStatus === 'broken'
    || artifact?.draft_preview_status === 'broken';
}

function statusChips(artifact, isBrokenPreview) {
  const reviewRequested = truthyMeta(artifact?.reviewRequested)
    || artifact?.reviewStatus === 'requested'
    || artifact?.review_status === 'requested';
  const draft = truthyMeta(artifact?.draft)
    || artifact?.status === 'draft'
    || artifact?.reviewStatus === 'draft';
  const lastKnownGood = artifact?.lastKnownGoodVersionId
    || artifact?.last_known_good_version_id
    || artifact?.lastGoodVersionId
    || artifact?.last_good_version_id
    || artifact?.lastGoodVersion
    || artifact?.last_good_version;
  return [
    { id: 'latest', label: 'Latest', active: !draft || artifact?.latest === true || artifact?.isLatest === true },
    { id: 'published', label: 'Published', active: !!artifact?.publishedUrl },
    { id: 'last-good', label: isBrokenPreview && lastKnownGood ? 'Last good available' : 'Last good', active: !!lastKnownGood },
    { id: 'draft', label: 'Draft', active: !!draft },
    { id: 'review', label: 'Review requested', active: !!reviewRequested },
    { id: 'broken', label: 'Broken preview', active: !!isBrokenPreview, danger: true },
  ];
}

function statusStyles(active, danger, tone) {
  const color = active
    ? danger ? 'var(--danger)' : tone === 'warning' ? 'var(--warning, var(--accent))' : 'var(--accent)'
    : 'var(--ink-4)';
  const activeColor = danger ? 'var(--danger)' : tone === 'warning' ? 'var(--warning, var(--accent))' : 'var(--accent)';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minHeight: 24,
    padding: '3px 8px',
    borderRadius: 999,
    border: `1px solid ${active
      ? `color-mix(in srgb, ${activeColor} 38%, transparent)`
      : 'var(--line)'}`,
    background: active
      ? `color-mix(in srgb, ${activeColor} 10%, transparent)`
      : 'transparent',
    color,
    fontFamily: FONT_BODY,
    fontSize: 11.5,
    fontWeight: active ? 600 : 500,
    whiteSpace: 'nowrap',
  };
}

function IconButton({ title, onClick, children, disabled }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 30,
        height: 30,
        borderRadius: 6,
        border: '1px solid var(--line)',
        background: 'transparent',
        color: disabled ? 'var(--ink-5)' : 'var(--ink-3)',
        display: 'inline-grid',
        placeItems: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseOver={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = 'var(--surface-2)';
        e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = disabled ? 'var(--ink-5)' : 'var(--ink-3)';
      }}
    >
      {children}
    </button>
  );
}

function TabButton({ tab, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={tab.label}
      style={{
        flex: '1 1 0',
        minWidth: 0,
        height: 34,
        border: 0,
        borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
        background: active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-3)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        fontFamily: FONT_BODY,
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>{tab.icon(13)}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.label}</span>
    </button>
  );
}

function RailSection({ title, children }) {
  return (
    <section style={{ padding: '14px 14px 0' }}>
      <div style={{
        fontFamily: FONT_MONO,
        fontSize: 10.5,
        color: 'var(--ink-4)',
        textTransform: 'uppercase',
        letterSpacing: 0,
        marginBottom: 8,
      }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function EmptyLine({ children }) {
  return (
    <div style={{
      padding: '10px 0',
      color: 'var(--ink-4)',
      fontFamily: FONT_BODY,
      fontSize: 12.5,
      lineHeight: 1.45,
    }}>
      {children}
    </div>
  );
}

function EmptyState({ icon, title, detail, children }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: icon ? '28px minmax(0, 1fr)' : 'minmax(0, 1fr)',
      gap: 10,
      alignItems: 'start',
      padding: '12px 0',
      color: 'var(--ink-4)',
    }}>
      {icon && (
        <span style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          display: 'inline-grid',
          placeItems: 'center',
          color: 'var(--ink-3)',
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
        }}>
          {icon}
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: FONT_BODY,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--ink-2)',
          lineHeight: 1.35,
        }}>
          {title}
        </div>
        {detail && (
          <div style={{
            marginTop: 3,
            fontFamily: FONT_BODY,
            fontSize: 12.5,
            color: 'var(--ink-4)',
            lineHeight: 1.45,
          }}>
            {detail}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function AnchorChip({ anchor, onSelect, active = false }) {
  const label = anchorText(anchor);
  if (!label) return null;
  const title = anchor?.file || anchor?.path || anchor?.target || label;
  const Tag = onSelect ? 'button' : 'span';
  return (
    <Tag
      type={onSelect ? 'button' : undefined}
      title={title}
      onClick={onSelect}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        maxWidth: '100%',
        minWidth: 0,
        border: '1px solid color-mix(in srgb, var(--accent) 26%, var(--line))',
        borderRadius: 999,
        background: active
          ? 'color-mix(in srgb, var(--accent) 16%, var(--surface))'
          : 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
        color: active ? 'var(--ink)' : 'var(--ink-3)',
        padding: '2px 7px',
        fontFamily: FONT_BODY,
        fontSize: 11.5,
        lineHeight: 1.2,
        cursor: onSelect ? 'pointer' : 'default',
      }}
    >
      <span style={{ display: 'inline-flex', color: 'var(--accent)', flexShrink: 0 }}>{Ico.link?.(11) || Ico.doc(11)}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </Tag>
  );
}

function SelectedReviewBar({ selection, onClear, onStartTask, taskBusy }) {
  if (!selection) return null;
  const anchorLabel = anchorText(selection.anchor);
  const consequence = reviewSelectionConsequence(selection);
  return (
    <div style={{
      flex: '0 0 auto',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      gap: 10,
      alignItems: 'center',
      padding: '9px 12px',
      borderBottom: '1px solid var(--line)',
      background: 'color-mix(in srgb, var(--accent) 7%, var(--surface))',
    }}>
      <div style={{ minWidth: 0, display: 'grid', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', color: 'var(--accent)' }}>{Ico.link?.(13) || Ico.doc(13)}</span>
          <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>
            {reviewKindText(selection.kind)}
          </span>
          {anchorLabel && <AnchorChip anchor={selection.anchor} active />}
        </div>
        <div style={{
          fontFamily: FONT_BODY,
          fontSize: 12,
          color: 'var(--ink-3)',
          lineHeight: 1.35,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {selection.body || consequence}
        </div>
        {consequence && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.35 }}>
            {consequence}
          </div>
        )}
      </div>
      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {onStartTask && selection.commentId && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onStartTask({
              commentId: selection.commentId,
              title: selection.taskTitle,
              prompt: selection.taskPrompt,
            })}
            disabled={taskBusy}
            style={{ height: 28, padding: '0 8px' }}
          >
            {taskBusy ? 'Starting...' : 'Follow-up task'}
          </button>
        )}
        <IconButton title="Clear review context" onClick={onClear}>
          {Ico.close(12)}
        </IconButton>
      </div>
    </div>
  );
}

function KeyValue({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '74px minmax(0, 1fr)', gap: 8, padding: '5px 0' }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: 'var(--ink-4)' }}>{label}</div>
      <div title={String(value)} style={{
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: FONT_BODY,
        fontSize: 12.5,
        color: 'var(--ink-2)',
      }}>
        {value}
      </div>
    </div>
  );
}

function SelectBox({ label, value, onChange, options, disabled }) {
  return (
    <label style={{
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 5,
    }}>
      <span style={{
        fontFamily: FONT_MONO,
        fontSize: 10.5,
        color: 'var(--ink-4)',
        textTransform: 'uppercase',
        letterSpacing: 0,
      }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        title={label}
        style={{
          width: '100%',
          minWidth: 0,
          height: 30,
          borderRadius: 8,
          border: '1px solid var(--line)',
          background: disabled ? 'var(--surface-2)' : 'var(--surface)',
          color: disabled ? 'var(--ink-5)' : 'var(--ink-2)',
          fontFamily: FONT_BODY,
          fontSize: 12.5,
          padding: '0 8px',
          outline: 0,
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DiffLine({ line, index }) {
  const added = line.startsWith('+') && !line.startsWith('+++');
  const removed = line.startsWith('-') && !line.startsWith('---');
  const meta = line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ');
  return (
    <div
      key={`${index}-${line}`}
      style={{
        padding: '0 10px',
        minHeight: 20,
        display: 'flex',
        alignItems: 'center',
        background: added
          ? 'color-mix(in srgb, var(--success) 12%, transparent)'
          : removed
            ? 'color-mix(in srgb, var(--danger) 10%, transparent)'
            : meta
              ? 'var(--surface-3)'
              : 'transparent',
        color: added
          ? 'color-mix(in srgb, var(--success) 78%, var(--ink))'
          : removed
            ? 'var(--danger)'
            : meta
              ? 'var(--ink-3)'
              : 'var(--ink-2)',
        fontFamily: FONT_MONO,
        fontSize: 11.5,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {line || ' '}
    </div>
  );
}

function VisualDiffPanel({ visualDiff }) {
  const [inspect, setInspect] = useState(null);
  const base = visualDiff?.base;
  const compare = visualDiff?.compare;
  const diffImage = visualDiff?.diff?.imageUrl;
  if (!visualDiff || visualDiff.available === false || (!base?.url && !compare?.url && !diffImage)) return null;
  const isPixelDiff = visualDiff.kind === 'screenshot-pixel-diff';
  const ratio = Number(visualDiff.ratio || 0);
  const sides = [
    {
      id: 'base',
      label: base?.label || base?.humanLabel || 'Before',
      url: base?.url,
      screenshotUrl: base?.screenshotUrl,
      path: base?.path,
    },
    {
      id: 'compare',
      label: compare?.label || compare?.humanLabel || 'After',
      url: compare?.url,
      screenshotUrl: compare?.screenshotUrl,
      path: compare?.path,
    },
  ];
  const openExternal = (url) => {
    if (!url || typeof window === 'undefined') return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const inspectAsset = ({ title, subtitle, url, kind = 'image' }) => {
    if (!url) return;
    setInspect({ title, subtitle, url, kind });
  };
  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 8,
      }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: 'var(--ink-4)' }}>
          Visual comparison
        </div>
        <span style={statusStyles(true, false)}>{isPixelDiff ? `${(ratio * 100).toFixed(ratio > 0 && ratio < 0.01 ? 2 : 1)}% changed` : 'Page preview'}</span>
      </div>
      {visualDiff.screenshotUnavailable && (
        <div style={{
          marginBottom: 8,
          border: '1px solid var(--line)',
          borderRadius: 8,
          background: 'var(--surface-2)',
          padding: '7px 9px',
          fontFamily: FONT_BODY,
          fontSize: 12,
          color: 'var(--ink-3)',
          lineHeight: 1.4,
        }}>
          Screenshot comparison is not available in this environment, so Cowork is showing live before-and-after previews.
        </div>
      )}
      {diffImage && (
        <div style={{
          border: '1px solid var(--line)',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--surface)',
          marginBottom: 8,
        }}>
          <div style={{
            height: 34,
            padding: '0 10px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            background: 'var(--surface-2)',
          }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink)', fontWeight: 600 }}>
              Difference
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)' }}>
                {visualDiff.changedPixels || 0} pixels
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => inspectAsset({
                  title: 'Visual difference',
                  subtitle: `${visualDiff.changedPixels || 0} changed pixels`,
                  url: diffImage,
                  kind: 'image',
                })}
                style={{ height: 26, padding: '0 8px' }}
              >
                Inspect
              </button>
            </span>
          </div>
          <div style={{ height: 260, background: '#fff', display: 'grid', placeItems: 'center' }}>
            <img
              src={diffImage}
              alt="Visual difference"
              loading="lazy"
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                display: 'block',
              }}
            />
          </div>
        </div>
      )}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 8,
      }}>
        {sides.map((side) => (
          <div key={side.id} style={{
            minWidth: 0,
            border: '1px solid var(--line)',
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--surface)',
          }}>
            <div style={{
              height: 34,
              padding: '0 10px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              background: 'var(--surface-2)',
            }}>
              <div title={side.label} style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                color: 'var(--ink)',
                fontWeight: 600,
              }}>
                {side.id === 'base' ? 'Before' : 'After'} · {side.label}
              </div>
              {side.path && (
                <span title={side.path} style={{
                  minWidth: 0,
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: FONT_MONO,
                  fontSize: 10.5,
                  color: 'var(--ink-4)',
                }}>
                  {side.path}
                </span>
              )}
              <span style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
                {(side.screenshotUrl || side.url) && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => inspectAsset({
                      title: `${side.id === 'base' ? 'Before' : 'After'} preview`,
                      subtitle: side.path || side.label,
                      url: side.screenshotUrl || side.url,
                      kind: side.screenshotUrl ? 'image' : 'page',
                    })}
                    style={{ height: 26, padding: '0 8px' }}
                  >
                    Inspect
                  </button>
                )}
                {side.url && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => openExternal(side.url)}
                    title="Open preview"
                    style={{ width: 28, height: 26, padding: 0, display: 'inline-grid', placeItems: 'center' }}
                  >
                    {Ico.externalLink(13)}
                  </button>
                )}
              </span>
            </div>
            <div style={{
              height: 280,
              background: '#fff',
            }}>
              {side.screenshotUrl ? (
                <img
                  src={side.screenshotUrl}
                  alt={`${side.id === 'base' ? 'Before' : 'After'} screenshot`}
                  loading="lazy"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: 'block',
                    background: '#fff',
                  }}
                />
              ) : side.url ? (
                <iframe
                  title={`${side.id === 'base' ? 'Before' : 'After'} preview`}
                  src={side.url}
                  sandbox="allow-same-origin allow-scripts allow-forms"
                  loading="lazy"
                  style={{
                    width: '100%',
                    height: '100%',
                    border: 0,
                    display: 'block',
                    background: '#fff',
                  }}
                />
              ) : (
                <div style={{
                  height: '100%',
                  display: 'grid',
                  placeItems: 'center',
                  padding: 16,
                  fontFamily: FONT_BODY,
                  fontSize: 12.5,
                  color: 'var(--ink-4)',
                  textAlign: 'center',
                }}>
                  Preview is not available for this side.
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <Modal
        open={!!inspect}
        onClose={() => setInspect(null)}
        size="lg"
        width="min(1180px, 94vw)"
        height="min(820px, 90vh)"
        ariaLabel={inspect?.title || 'Visual diff preview'}
      >
        <div style={{
          flexShrink: 0,
          padding: '12px 14px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--surface)',
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div title={inspect?.title} style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 17,
              fontWeight: 600,
              color: 'var(--ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {inspect?.title}
            </div>
            {inspect?.subtitle && (
              <div title={inspect.subtitle} style={{
                marginTop: 2,
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                color: 'var(--ink-3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {inspect.subtitle}
              </div>
            )}
          </div>
          {inspect?.url && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => openExternal(inspect.url)}
              style={{ height: 30, padding: '0 10px' }}
            >
              {Ico.externalLink(13)}
              <span>Open</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setInspect(null)}
            title="Close"
            aria-label="Close"
            style={{
              cursor: 'pointer',
              background: 'transparent',
              border: 0,
              color: 'var(--ink-3)',
              width: 30,
              height: 30,
              borderRadius: 6,
              display: 'inline-grid',
              placeItems: 'center',
            }}
          >
            {Ico.close(13)}
          </button>
        </div>
        <div style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          background: '#fff',
          display: 'grid',
          placeItems: 'center',
        }}>
          {inspect?.kind === 'page' ? (
            <iframe
              title={inspect?.title || 'Visual diff preview'}
              src={inspect.url}
              sandbox="allow-same-origin allow-scripts allow-forms"
              style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
            />
          ) : inspect?.url ? (
            <img
              src={inspect.url}
              alt={inspect?.title || 'Visual diff preview'}
              style={{ maxWidth: 'none', width: 'auto', minWidth: '100%', objectFit: 'contain', display: 'block' }}
            />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}

function normalizeVersion(v, index, meta = {}) {
  const id = v?.id || v?.versionId || v?.version_id || v?.checkpointId || v?.checkpoint_id || v?.version || `${index}`;
  const rawDate = v?.createdAt || v?.created_at || v?.timestamp || v?.mtime || v?.updatedAt || v?.updated_at;
  const dateLabel = formatDate(rawDate);
  const fallbackLabel = dateLabel ? `Saved version ${dateLabel}` : `Saved version ${index + 1}`;
  const label = v?.label || v?.title || v?.name || v?.message || fallbackLabel;
  const current = !!(v?.current || v?.isCurrent || v?.is_current || id === meta.currentVersionId);
  const latest = !!(v?.latest || v?.isLatest || v?.is_latest || id === meta.latestVersionId);
  const lastKnownGoodVersionId = meta.lastKnownGoodVersionId || meta.last_known_good_version_id || '';
  const filesHash = v?.filesHash || v?.files_hash || v?.manifest?.filesHash || v?.manifest?.files_hash || '';
  const manifestHash = v?.manifestHash || v?.manifest_hash || v?.manifest?.manifestHash || v?.manifest?.manifest_hash || '';
  const prompt = v?.prompt || v?.summary || '';
  return {
    id: String(id),
    label,
    dateLabel,
    summary: prompt || v?.description || v?.note || '',
    prompt,
    author: v?.author || v?.createdBy || v?.created_by || v?.actor || '',
    versionNumber: v?.versionNumber ?? v?.version_number ?? null,
    fileCount: v?.fileCount ?? v?.file_count ?? v?.manifest?.fileCount ?? v?.manifest?.file_count ?? null,
    totalBytes: v?.totalBytes ?? v?.total_bytes ?? null,
    filesHash,
    manifestHash,
    operationType: v?.operationType || v?.operation_type || '',
    previewStatus: v?.previewStatus || v?.preview_status || '',
    publishStatus: v?.publishStatus || v?.publish_status || '',
    sourceConversationId: v?.sourceConversationId || v?.source_conversation_id || v?.conversationId || v?.conversation_id || '',
    sourceMessageId: v?.sourceMessageId || v?.source_message_id || v?.messageId || v?.message_id || '',
    parentVersionId: v?.parentVersionId || v?.parent_version_id || '',
    restoredFromVersionId: v?.restoredFromVersionId || v?.restored_from_version_id || '',
    forkedFromVersionId: v?.forkedFromVersionId || v?.forked_from_version_id || '',
    branchName: v?.branchName || v?.branch_name || '',
    lastGood: !!(id && lastKnownGoodVersionId && String(id) === String(lastKnownGoodVersionId)),
    current,
    latest,
    raw: v,
  };
}

function compactHash(value) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= 12) return text;
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function compactBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function versionOperationLabel(value) {
  const key = String(value || '').toLowerCase();
  const labels = {
    auto: 'Automatic save',
    checkpoint: 'Saved manually',
    draft: 'Draft',
    fork: 'Remix created',
    generated_update: 'Agent update',
    import: 'Imported',
    manual: 'Saved manually',
    pre_delete: 'Before delete',
    pre_generated_update: 'Before agent update',
    preview: 'Preview passed',
    preview_failure: 'Preview failed',
    publish: 'Published',
    restore: 'Restored',
    restore_deleted: 'Recovered',
    restore_safety: 'Before restore',
    review_accept: 'Suggestion accepted',
    review_safety: 'Before suggestion',
    snapshot: 'Snapshot',
  };
  return labels[key] || (value ? displayName(String(value).replace(/_/g, ' ')) : '');
}

function statusBadgeLabel(value, fallback) {
  const text = String(value || '').trim();
  if (!text) return '';
  return `${fallback}: ${displayName(text.replace(/_/g, ' '))}`;
}

function shortId(value) {
  if (!value) return '';
  return String(value).slice(0, 8);
}

function versionBadges(version) {
  const operation = versionOperationLabel(version?.operationType);
  const preview = statusBadgeLabel(version?.previewStatus, 'Preview');
  const publish = version?.publishStatus && version.publishStatus !== 'unpublished'
    ? statusBadgeLabel(version.publishStatus, 'Publish')
    : '';
  return [
    operation ? { id: 'operation', label: operation, active: true, danger: version?.operationType === 'preview_failure' } : null,
    version?.latest ? { id: 'latest', label: 'Latest', active: true } : null,
    version?.current ? { id: 'current', label: 'Current', active: true } : null,
    version?.lastGood ? { id: 'last-good', label: 'Last good', active: true } : null,
    preview ? { id: 'preview', label: preview, active: version?.previewStatus === 'ready', danger: version?.previewStatus === 'failed' } : null,
    publish ? { id: 'publish', label: publish, active: version?.publishStatus === 'published', danger: version?.publishStatus === 'failed' } : null,
  ].filter(Boolean);
}

function versionDetailItems(version) {
  const fileCount = Number(version?.fileCount);
  const fileBits = [
    Number.isFinite(fileCount) ? `${fileCount} ${fileCount === 1 ? 'file' : 'files'}` : '',
    compactBytes(version?.totalBytes),
  ].filter(Boolean).join(' · ');
  return [
    version?.versionNumber != null ? { label: 'Version', value: `#${version.versionNumber}` } : null,
    version?.id ? { label: 'Version ID', value: shortId(version.id), title: version.id } : null,
    fileBits ? { label: 'Files', value: fileBits } : null,
    version?.filesHash ? { label: 'Fingerprint', value: compactHash(version.filesHash), title: version.filesHash } : null,
    version?.sourceConversationId ? { label: 'Source task', value: shortId(version.sourceConversationId), title: version.sourceConversationId } : null,
    version?.sourceMessageId ? { label: 'Source message', value: shortId(version.sourceMessageId), title: version.sourceMessageId } : null,
    version?.restoredFromVersionId ? { label: 'Restored from', value: shortId(version.restoredFromVersionId), title: version.restoredFromVersionId } : null,
    version?.forkedFromVersionId ? { label: 'Remixed from', value: shortId(version.forkedFromVersionId), title: version.forkedFromVersionId } : null,
  ].filter(Boolean);
}

function versionOptionLabel(version) {
  if (!version) return 'Current draft';
  const badges = [
    version.latest ? 'Latest' : '',
    version.current ? 'Current' : '',
  ].filter(Boolean);
  const parts = [
    version.label,
    version.dateLabel,
    ...badges,
  ].filter(Boolean);
  return parts.join(' · ');
}

function defaultCompareForVersions(versions) {
  if (!versions.length) return { from: '', to: CURRENT_DRAFT_VALUE };
  const preferredToIndex = versions.findIndex((version) => version.current || version.latest);
  const toIndex = preferredToIndex >= 0 ? preferredToIndex : 0;
  const to = versions[toIndex]?.id || CURRENT_DRAFT_VALUE;
  if (versions.length === 1) return { from: to, to: CURRENT_DRAFT_VALUE };
  const fromIndex = toIndex === 0 ? 1 : 0;
  return { from: versions[fromIndex]?.id || '', to };
}

function compareValueForApi(value) {
  if (!value) return undefined;
  return value === CURRENT_DRAFT_VALUE ? 'current' : value;
}

function compareLabel(value, versions) {
  if (value === CURRENT_DRAFT_VALUE) return 'Current draft, not published';
  const version = versions.find((item) => item.id === value);
  return version ? versionOptionLabel(version) : 'Saved version';
}

function requestedCompareForVersions(compareRequest, versions) {
  if (!compareRequest) return null;
  const known = new Set(versions.map((version) => version.id));
  const normalize = (value) => {
    if (!value) return '';
    const text = String(value);
    if (text === CURRENT_DRAFT_VALUE) return text;
    return known.has(text) ? text : '';
  };
  const from = normalize(compareRequest.from);
  const to = normalize(compareRequest.to);
  if (!from || !to || from === to) return null;
  return { from, to };
}

function manifestRows(manifest) {
  if (!manifest) return [];
  const compactValue = (value) => {
    if (!value && value !== 0) return '';
    if (typeof value === 'string' || typeof value === 'number') return value;
    if (typeof value === 'object') {
      if (Number.isFinite(Number(value.size))) return `${value.size} bytes`;
      return value.sha256 || value.contentHash || value.content_hash || value.path || '';
    }
    return String(value);
  };
  const textFrom = (...values) => {
    for (const value of values) {
      if (!value) continue;
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) {
        const lines = value.map((line) => {
          if (typeof line === 'string') return line;
          if (line && typeof line === 'object') return line.text || line.line || line.value || '';
          return '';
        }).filter(Boolean);
        if (lines.length) return lines.join('\n');
      }
      if (value && typeof value === 'object') {
        const nested = textFrom(value.textDiff, value.text_diff, value.diff, value.patch, value.content, value.hunks, value.lines);
        if (nested) return nested;
      }
    }
    return '';
  };
  const normalizeStatus = (raw) => raw?.status
    || raw?.kind
    || raw?.changeType
    || raw?.change_type
    || raw?.action
    || '';
  if (Array.isArray(manifest)) {
    return manifest.map((item, index) => {
      const raw = item && typeof item === 'object' ? item : {};
      const primitiveLabel = typeof item === 'string' || typeof item === 'number' ? String(item) : '';
      const label = raw.path || raw.name || raw.file || raw.filePath || raw.file_path || primitiveLabel || `Item ${index + 1}`;
      return {
        id: `${label}:${index}`,
        label,
        before: compactValue(raw.before ?? raw.old),
        after: compactValue(raw.after ?? raw.new),
        status: normalizeStatus(raw),
        kind: raw.kind || raw.type || '',
        textDiff: textFrom(raw.textDiff, raw.text_diff, raw.diff, raw.patch, raw.content, raw.hunks, raw.lines),
        sizeDelta: raw.sizeDelta ?? raw.size_delta ?? null,
        beforePayload: raw.before ?? raw.old ?? null,
        afterPayload: raw.after ?? raw.new ?? null,
        raw: item && typeof item === 'object' ? item : { path: primitiveLabel },
      };
    });
  }
  if (typeof manifest === 'object') {
    return Object.entries(manifest).map(([key, value], index) => {
      const raw = value && typeof value === 'object' ? value : {};
      const label = raw.path || raw.name || raw.file || raw.filePath || raw.file_path || key;
      return {
        id: `${label}:${index}`,
        label,
        before: compactValue(raw.before ?? raw.old),
        after: compactValue(raw.after ?? raw.new ?? (typeof value === 'string' ? value : '')),
        status: normalizeStatus(raw),
        kind: raw.kind || raw.type || '',
        textDiff: textFrom(raw.textDiff, raw.text_diff, raw.diff, raw.patch, raw.content, raw.hunks, raw.lines),
        sizeDelta: raw.sizeDelta ?? raw.size_delta ?? null,
        beforePayload: raw.before ?? raw.old ?? null,
        afterPayload: raw.after ?? raw.new ?? null,
        raw: value,
      };
    });
  }
  return [];
}

function filePayloadDetail(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const size = Number.isFinite(Number(payload.size)) ? compactBytes(payload.size) : '';
  const hash = payload.contentHash || payload.content_hash || payload.sha256 || payload.hash || '';
  const shortHash = hash ? `hash ${String(hash).slice(0, 10)}` : '';
  return [size, shortHash].filter(Boolean).join(' · ');
}

function fileChangeSummary(row) {
  const status = String(row?.status || '').toLowerCase();
  if (status === 'added') return 'Added in the newer version.';
  if (status === 'removed') return 'Removed from the newer version.';
  if (status === 'modified') return 'Updated between these versions.';
  return 'Changed between these versions.';
}

function fileSizeDeltaLabel(row) {
  const value = Number(row?.sizeDelta);
  if (!Number.isFinite(value) || value === 0) return '';
  const sign = value > 0 ? '+' : '-';
  return `${sign}${compactBytes(Math.abs(value))}`;
}

function FileDiffInspector({ row }) {
  if (!row) return null;
  const textDiff = row.textDiff || row.raw?.textDiff || row.raw?.text_diff || '';
  const beforeDetail = filePayloadDetail(row.beforePayload);
  const afterDetail = filePayloadDetail(row.afterPayload);
  const sizeDelta = fileSizeDeltaLabel(row);
  return (
    <div style={{
      border: '1px solid var(--line)',
      borderRadius: 8,
      background: 'var(--surface)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '9px 10px',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 10,
      }}>
        <div style={{ minWidth: 0 }}>
          <div title={row.label} style={{
            fontFamily: FONT_BODY,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {row.label}
          </div>
          <div style={{ marginTop: 3, fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>
            {fileChangeSummary(row)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {sizeDelta && <span style={statusStyles(true, Number(row.sizeDelta) < 0)}>{sizeDelta}</span>}
          {row.status && <span style={statusStyles(true, String(row.status).toLowerCase() === 'removed')}>{row.status}</span>}
        </div>
      </div>
      {(beforeDetail || afterDetail) && (
        <div style={{
          padding: 10,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 8,
          borderBottom: textDiff ? '1px solid var(--line)' : 0,
          background: 'var(--surface-2)',
        }}>
          {[
            ['Older version', beforeDetail || 'Not present'],
            ['Newer version', afterDetail || 'Not present'],
          ].map(([label, value]) => (
            <div key={label} style={{ minWidth: 0 }}>
              <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: 'var(--ink-4)', marginBottom: 3 }}>
                {label}
              </div>
              <div title={value} style={{
                fontFamily: FONT_BODY,
                fontSize: 12,
                color: 'var(--ink-2)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      )}
      {textDiff ? (
        <div style={{ maxHeight: 360, overflow: 'auto', background: 'var(--surface)' }}>
          {String(textDiff).split('\n').slice(0, 500).map((line, index) => (
            <DiffLine key={`${index}-${line}`} line={line} index={index} />
          ))}
        </div>
      ) : (
        <div style={{ padding: 10, fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.45 }}>
          File-level line changes are not available for this file. Cowork can still compare its status, size, and fingerprint.
        </div>
      )}
    </div>
  );
}

function compactRowValue(value) {
  if (value == null || value === '') return 'blank';
  const text = String(value);
  return text.length > 34 ? `${text.slice(0, 31)}...` : text;
}

function schemaList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([name, detail]) => {
      if (detail && typeof detail === 'object' && !Array.isArray(detail)) return { name, ...detail };
      return { name, value: detail };
    });
  }
  return [];
}

function firstSchemaList(schema, keys) {
  for (const key of keys) {
    const items = schemaList(schema?.[key]);
    if (items.length) return items;
  }
  return [];
}

function schemaItemName(item, index) {
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  return item?.name || item?.column || item?.field || item?.key || item?.path || `Column ${index + 1}`;
}

function schemaItemDetail(item) {
  if (!item || typeof item !== 'object') return '';
  const before = item.before ?? item.old ?? item.from ?? item.previous ?? item.beforeType ?? item.oldType;
  const after = item.after ?? item.new ?? item.to ?? item.next ?? item.afterType ?? item.newType ?? item.type ?? item.value;
  if ((before || before === 0) && (after || after === 0)) return `${compactRowValue(before)} -> ${compactRowValue(after)}`;
  if (after || after === 0) return compactRowValue(after);
  if (before || before === 0) return compactRowValue(before);
  return item.summary || item.detail || '';
}

function schemaChangeGroups(schema) {
  const added = firstSchemaList(schema, ['added', 'addedColumns', 'columnsAdded', 'newColumns']);
  const removed = firstSchemaList(schema, ['removed', 'removedColumns', 'columnsRemoved', 'deletedColumns']);
  const updated = firstSchemaList(schema, ['modified', 'updated', 'changed', 'changedColumns', 'typeChanges']);
  return [
    { id: 'added', label: 'Columns added', summary: 'column added', summaryPlural: 'columns added', items: added, danger: false },
    { id: 'removed', label: 'Columns removed', summary: 'column removed', summaryPlural: 'columns removed', items: removed, danger: true },
    { id: 'updated', label: 'Columns updated', summary: 'column updated', summaryPlural: 'columns updated', items: updated, danger: false },
  ];
}

function RowFieldChanges({ row }) {
  const fields = rowFieldChanges(row);
  if (!fields.length) return null;
  return (
    <div style={{ marginTop: 7, display: 'grid', gap: 4 }}>
      {fields.slice(0, 5).map((field, index) => (
        <div key={`${field.column || index}-${field.before}-${field.after}`} style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(70px, 0.75fr) minmax(0, 1fr)',
          gap: 7,
          alignItems: 'start',
          minWidth: 0,
          fontFamily: FONT_MONO,
          fontSize: 10.5,
          lineHeight: 1.35,
        }}>
          <span title={field.column} style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--ink-4)',
          }}>
            {field.column}
          </span>
          <span title={field.summary} style={{
            minWidth: 0,
            color: 'var(--ink-3)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {field.summary}
          </span>
        </div>
      ))}
      {fields.length > 5 && (
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)' }}>
          {fields.length - 5} more changed {fields.length - 5 === 1 ? 'field' : 'fields'}
        </div>
      )}
    </div>
  );
}

function SchemaChangeList({ schema }) {
  const groups = schemaChangeGroups(schema).filter((group) => group.items.length > 0);
  if (!groups.length) return null;
  return (
    <div style={{ marginTop: 8, display: 'grid', gap: 7 }}>
      {groups.map((group) => (
        <div key={group.id} style={{
          border: '1px solid var(--line)',
          borderRadius: 6,
          background: 'var(--surface-2)',
          padding: '7px 8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
              {group.label}
            </div>
            <span style={statusStyles(true, group.danger)}>{group.items.length}</span>
          </div>
          <div style={{ marginTop: 5, display: 'grid', gap: 4 }}>
            {group.items.slice(0, 6).map((item, index) => {
              const name = schemaItemName(item, index);
              const detail = schemaItemDetail(item);
              return (
                <div key={`${name}-${index}`} style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(86px, 0.9fr) minmax(0, 1fr)',
                  gap: 7,
                  minWidth: 0,
                  fontFamily: FONT_MONO,
                  fontSize: 10.5,
                  color: 'var(--ink-4)',
                  lineHeight: 1.35,
                }}>
                  <span title={name} style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--ink-3)',
                  }}>
                    {name}
                  </span>
                  <span title={detail} style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {detail || 'Changed'}
                  </span>
                </div>
              );
            })}
            {group.items.length > 6 && (
              <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)' }}>
                {group.items.length - 6} more
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function rowFieldChanges(row) {
  const explicit = [row?.changes, row?.cells, row?.columns, row?.fieldChanges, row?.cellChanges]
    .find((value) => Array.isArray(value));
  if (explicit) {
    return explicit.map((change, index) => {
      const column = change?.column || change?.field || change?.name || change?.key || `Field ${index + 1}`;
      const before = change?.before ?? change?.old ?? change?.from;
      const after = change?.after ?? change?.new ?? change?.to ?? change?.value;
      const summary = (before || before === 0) && (after || after === 0)
        ? `${compactRowValue(before)} -> ${compactRowValue(after)}`
        : compactRowValue(after ?? before ?? change?.summary ?? change?.detail);
      return { column, before, after, summary };
    });
  }

  const before = row?.before && typeof row.before === 'object' ? row.before : {};
  const after = row?.after && typeof row.after === 'object' ? row.after : {};
  const columns = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const status = String(row?.status || row?.kind || '').toLowerCase();
  return columns
    .filter((column) => status === 'added' || status === 'removed' || before[column] !== after[column])
    .map((column) => {
      const hasBefore = before[column] != null && before[column] !== '';
      const hasAfter = after[column] != null && after[column] !== '';
      const summary = hasBefore && hasAfter
        ? `${compactRowValue(before[column])} -> ${compactRowValue(after[column])}`
        : compactRowValue(hasAfter ? after[column] : before[column]);
      return { column, before: before[column], after: after[column], summary };
    });
}

function rowChangePreview(row) {
  return rowFieldChanges(row)
    .slice(0, 3)
    .map((field) => `${field.column}: ${field.summary}`)
    .join(' · ');
}

function dataRowStatus(row) {
  const status = String(row?.status || row?.kind || 'modified').toLowerCase();
  if (status === 'deleted') return 'removed';
  if (status === 'updated') return 'modified';
  return ['added', 'removed', 'modified'].includes(status) ? status : 'modified';
}

function dataRowKey(row, index) {
  return row?.key ?? row?.id ?? row?.rowId ?? row?.row_id ?? row?.index ?? index + 1;
}

function dataRowSearchText(row, index) {
  const parts = [
    dataRowStatus(row),
    dataRowKey(row, index),
    rowChangePreview(row),
    ...rowFieldChanges(row).flatMap((field) => [field.column, field.before, field.after, field.summary]),
  ];
  return parts.filter((part) => part != null).join(' ').toLowerCase();
}

function DatasetDiffCard({ diff }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [visibleLimit, setVisibleLimit] = useState(8);
  const schema = diff?.schema || {};
  const rowSummary = diff?.rows || {};
  const schemaBits = schemaChangeGroups(schema)
    .filter((group) => group.items.length)
    .map((group) => `${group.items.length} ${group.items.length === 1 ? group.summary : group.summaryPlural}`);
  const rowBits = [
    rowSummary.added ? `${rowSummary.added} rows added` : '',
    (rowSummary.modified || rowSummary.updated) ? `${rowSummary.modified || rowSummary.updated} rows updated` : '',
    rowSummary.removed ? `${rowSummary.removed} rows removed` : '',
  ].filter(Boolean);
  const changedRows = Array.isArray(diff?.changedRows)
    ? diff.changedRows
    : Array.isArray(diff?.rowChanges)
      ? diff.rowChanges
      : [];
  const cleanQuery = query.trim().toLowerCase();
  const filteredRows = changedRows.filter((row, index) => {
    const status = dataRowStatus(row);
    if (statusFilter !== 'all' && status !== statusFilter) return false;
    if (!cleanQuery) return true;
    return dataRowSearchText(row, index).includes(cleanQuery);
  });
  const visibleRows = filteredRows.slice(0, visibleLimit);
  const statusCounts = changedRows.reduce((acc, row) => {
    acc[dataRowStatus(row)] += 1;
    return acc;
  }, { all: changedRows.length, added: 0, modified: 0, removed: 0 });

  useEffect(() => {
    setVisibleLimit(8);
  }, [query, statusFilter, diff?.path]);

  const fieldStyle = {
    minWidth: 0,
    height: 30,
    borderRadius: 8,
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--ink-2)',
    fontFamily: FONT_BODY,
    fontSize: 12,
    padding: '0 8px',
    outline: 0,
  };

  return (
    <div style={{
      border: '1px solid var(--line)',
      borderRadius: 8,
      background: 'var(--surface)',
      padding: 10,
    }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
        {diff?.path || 'Dataset'}
      </div>
      <div style={{ marginTop: 4, fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>
        {[...schemaBits, ...rowBits].join(' · ') || 'No row or schema changes.'}
      </div>
      <SchemaChangeList schema={schema} />
      {changedRows.length > 0 && (
        <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 132px',
            gap: 6,
          }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search rows or fields"
              style={fieldStyle}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={fieldStyle}
            >
              <option value="all">All ({statusCounts.all})</option>
              <option value="added">Added ({statusCounts.added})</option>
              <option value="modified">Updated ({statusCounts.modified})</option>
              <option value="removed">Removed ({statusCounts.removed})</option>
            </select>
          </div>
          {filteredRows.length === 0 ? (
            <div style={{
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '9px 10px',
              background: 'var(--surface-2)',
              fontFamily: FONT_BODY,
              fontSize: 12.5,
              color: 'var(--ink-4)',
            }}>
              No row changes match this filter.
            </div>
          ) : (
            <>
              {visibleRows.map((row, rowIndex) => {
                const rowStatus = dataRowStatus(row);
                const rowKey = dataRowKey(row, rowIndex);
                const statusLabel = rowStatus === 'added'
                  ? 'Added'
                  : rowStatus === 'removed'
                    ? 'Removed'
                    : 'Updated';
                return (
                  <div key={`${rowKey}-${rowStatus}-${rowIndex}`} style={{
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                    padding: '7px 8px',
                    background: 'var(--surface-2)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={statusStyles(true, rowStatus === 'removed')}>
                        {statusLabel}
                      </span>
                      <span style={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: FONT_BODY,
                        fontSize: 12.5,
                        color: 'var(--ink)',
                      }}>
                        Row {rowKey}
                      </span>
                    </div>
                    {rowChangePreview(row) && (
                      <div style={{
                        marginTop: 5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: FONT_MONO,
                        fontSize: 10.5,
                        color: 'var(--ink-4)',
                      }}>
                        {rowChangePreview(row)}
                      </div>
                    )}
                    <RowFieldChanges row={row} />
                  </div>
                );
              })}
              {filteredRows.length > visibleRows.length && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setVisibleLimit((value) => value + 20)}
                  style={{ height: 30, padding: '0 10px', alignSelf: 'flex-start' }}
                >
                  Show {Math.min(20, filteredRows.length - visibleRows.length)} more
                </button>
              )}
              {diff?.changedRowsTruncated && filteredRows.length === visibleRows.length && (
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-4)' }}>
                  Additional row changes exist in the version store beyond this preview.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ChangesTab({ path, artifact, active, onVersionsLoaded, compareRequest }) {
  const [state, setState] = useState({ status: 'idle', available: null, data: null, error: '' });
  const [versionState, setVersionState] = useState({ status: 'idle', available: null, versions: [], meta: {}, error: '' });
  const [compareDraft, setCompareDraft] = useState({ from: '', to: CURRENT_DRAFT_VALUE });
  const [appliedCompare, setAppliedCompare] = useState({ from: '', to: CURRENT_DRAFT_VALUE });
  const [selectedFileId, setSelectedFileId] = useState('');

  const versions = useMemo(
    () => versionState.versions.map((item, index) => normalizeVersion(item, index, versionState.meta)),
    [versionState.versions, versionState.meta]
  );
  const versionOptions = useMemo(() => [
    { value: CURRENT_DRAFT_VALUE, label: 'Current draft, not published' },
    ...versions.map((version) => ({
      value: version.id,
      label: versionOptionLabel(version),
    })),
  ], [versions]);

  useEffect(() => {
    if (!active || !path) return undefined;
    let cancelled = false;
    setVersionState({ status: 'loading', available: null, versions: [], meta: {}, error: '' });
    fetchArtifactVersions(path)
      .then((data) => {
        if (cancelled) return;
        const available = data?.available !== false;
        const rawVersions = available ? (data?.versions || []) : [];
        const normalized = rawVersions.map((item, index) => normalizeVersion(item, index, data || {}));
        const nextCompare = requestedCompareForVersions(compareRequest, normalized) || defaultCompareForVersions(normalized);
        onVersionsLoaded?.(available ? { ...data, status: 'ready', error: '' } : { versions: [], status: 'unavailable', error: '' });
        setVersionState({
          status: 'ready',
          available,
          versions: rawVersions,
          meta: data || {},
          error: '',
        });
        setCompareDraft(nextCompare);
        setAppliedCompare(nextCompare);
      })
      .catch((err) => {
        if (cancelled) return;
        const fallbackCompare = { from: '', to: CURRENT_DRAFT_VALUE };
        const message = err?.message || 'Could not load saved versions.';
        onVersionsLoaded?.({ versions: [], status: 'error', error: message });
        setVersionState({
          status: 'error',
          available: true,
          versions: [],
          meta: {},
          error: message,
        });
        setCompareDraft(fallbackCompare);
        setAppliedCompare(fallbackCompare);
      });
    return () => { cancelled = true; };
  }, [active, path, onVersionsLoaded, compareRequest]);

  useEffect(() => {
    if (!active || !compareRequest?.key || !versions.length) return;
    const requested = requestedCompareForVersions(compareRequest, versions);
    if (!requested) return;
    setCompareDraft(requested);
    setAppliedCompare(requested);
  }, [active, compareRequest?.key, versions]);

  useEffect(() => {
    if (!active || !path) return undefined;
    if (appliedCompare.from && appliedCompare.to && appliedCompare.from === appliedCompare.to) {
      setState({ status: 'ready', available: true, data: {}, error: '' });
      return undefined;
    }
    let cancelled = false;
    setState({ status: 'loading', available: null, data: null, error: '' });
    fetchArtifactChanges(path, {
      from: compareValueForApi(appliedCompare.from),
      to: compareValueForApi(appliedCompare.to),
    })
      .then((data) => {
        if (cancelled) return;
        setState({
          status: 'ready',
          available: data?.available !== false,
          data,
          error: '',
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', available: true, data: null, error: err?.message || 'Could not load changes.' });
      });
    return () => { cancelled = true; };
  }, [active, path, appliedCompare.from, appliedCompare.to]);

  const data = state.data || {};
  const textDiff = typeof data.textDiff === 'string'
    ? data.textDiff
    : typeof data.text_diff === 'string'
      ? data.text_diff
      : typeof data.patch === 'string'
        ? data.patch
        : typeof data.content === 'string'
          ? data.content
          : typeof data.diff === 'string'
            ? data.diff
            : '';
  const manifest = data.manifestDiff
    || data.manifest_diff
    || data.changedFiles
    || data.changed_files
    || data.fileDiffs
    || data.file_diffs
    || data.changes
    || data.manifest
    || artifact?.manifestDiff
    || null;
  const rows = manifestRows(manifest);
  const rowIdsKey = rows.map((row) => row.id).join('\u001f');

  useEffect(() => {
    setSelectedFileId('');
  }, [path, appliedCompare.from, appliedCompare.to]);

  useEffect(() => {
    if (!selectedFileId || rows.some((row) => row.id === selectedFileId)) return;
    setSelectedFileId('');
  }, [selectedFileId, rowIdsKey]);

  const selectedFile = rows.find((row) => row.id === selectedFileId) || rows[0] || null;
  const summary = data.summary && typeof data.summary === 'object' ? data.summary : null;
  const summaryText = typeof data.summary === 'string' ? data.summary : '';
  const datasetDiffs = Array.isArray(data.datasetDiffs)
    ? data.datasetDiffs
    : Array.isArray(data.dataset_diffs)
      ? data.dataset_diffs
      : (data.datasetDiff ? [data.datasetDiff] : []);
  const visualDiff = data.visualDiff || data.visual_diff || null;
  const hasVisualDiff = !!(
    visualDiff
    && visualDiff.available !== false
    && (visualDiff.base?.url || visualDiff.compare?.url || visualDiff.diff?.imageUrl)
  );
  const hasChanges = !!(hasVisualDiff || textDiff || rows.length || summary || summaryText || datasetDiffs.length);

  if (!active) return null;

  const hasVersionControls = versionState.available !== false && versions.length > 0;
  const invalidCompare = !!(compareDraft.from && compareDraft.to && compareDraft.from === compareDraft.to);
  const compareChanged = compareDraft.from !== appliedCompare.from || compareDraft.to !== appliedCompare.to;
  const canApplyCompare = hasVersionControls && !invalidCompare && !!compareDraft.from && !!compareDraft.to && compareChanged;
  const appliedLabel = hasVersionControls && appliedCompare.from && appliedCompare.to
    ? `${compareLabel(appliedCompare.from, versions)} to ${compareLabel(appliedCompare.to, versions)}`
    : 'Latest changes';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: 'var(--surface-2)',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
	          <div style={{ minWidth: 0 }}>
	            <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
	              What changed
	            </div>
            <div title={appliedLabel} style={{
              marginTop: 2,
              fontFamily: FONT_MONO,
              fontSize: 10.5,
              color: 'var(--ink-4)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {appliedLabel}
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setAppliedCompare(compareDraft)}
            disabled={!canApplyCompare || state.status === 'loading'}
            style={{ height: 28, padding: '0 9px', flexShrink: 0 }}
          >
            Compare
          </button>
        </div>
        {hasVersionControls ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 8,
          }}>
	            <SelectBox
              label="Compare"
	              value={compareDraft.from}
	              onChange={(value) => setCompareDraft((prev) => ({ ...prev, from: value }))}
	              options={versionOptions}
	              disabled={state.status === 'loading'}
	            />
	            <SelectBox
              label="With"
	              value={compareDraft.to}
	              onChange={(value) => setCompareDraft((prev) => ({ ...prev, to: value }))}
	              options={versionOptions}
              disabled={state.status === 'loading'}
            />
          </div>
        ) : versionState.status === 'loading' ? (
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-4)' }}>
            Loading saved versions...
          </div>
        ) : versionState.error ? (
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-4)' }}>
            {versionState.error}
          </div>
        ) : (
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-4)' }}>
            Saved versions will appear here once this artifact has history.
          </div>
        )}
        {invalidCompare && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--danger)' }}>
            Choose two different points to compare.
          </div>
        )}
      </div>

      {state.status === 'loading' ? (
        <EmptyLine>Loading comparison...</EmptyLine>
      ) : state.status === 'error' ? (
        <EmptyState
          icon={Ico.refresh(14)}
          title="Comparison could not be loaded."
          detail={state.error}
        />
      ) : state.available === false ? (
        <EmptyState
          icon={Ico.code(14)}
              title="Change comparison is not available yet."
              detail="Change comparison is not set up for this workspace yet."
        />
      ) : !hasChanges ? (
        <EmptyState
          icon={Ico.check(14)}
          title="No differences found."
          detail={hasVersionControls ? 'The selected versions match for this artifact.' : 'No recorded changes are attached to this artifact yet.'}
        />
      ) : (
        <>
          {hasVisualDiff && (
            <VisualDiffPanel visualDiff={visualDiff} />
          )}
          {summaryText && (
            <div style={{
              border: '1px solid var(--line)',
              borderRadius: 8,
              background: 'var(--surface)',
              padding: 10,
              fontFamily: FONT_BODY,
              fontSize: 12.5,
              color: 'var(--ink-3)',
              lineHeight: 1.45,
            }}>
              {summaryText}
            </div>
          )}
          {summary && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 6,
            }}>
              {[
                ['Added', summary.added],
                ['Updated', summary.modified],
                ['Removed', summary.removed],
                ['Unchanged', summary.unchanged],
              ].map(([label, value]) => (
                <div key={label} style={{
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  background: 'var(--surface)',
                  padding: '8px 9px',
                  minWidth: 0,
                }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
                    {Number.isFinite(Number(value)) ? value : 0}
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)', marginTop: 1 }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>
          )}
          {datasetDiffs.length > 0 && (
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: 'var(--ink-4)', marginBottom: 8 }}>
                Data changes
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {datasetDiffs.map((diff, index) => (
                  <DatasetDiffCard key={diff?.path || `${index}-${JSON.stringify(diff).slice(0, 80)}`} diff={diff} />
                ))}
              </div>
            </div>
          )}
	          {rows.length > 0 && (
	            <div>
	              <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: 'var(--ink-4)', marginBottom: 8 }}>
	                Changed files
	              </div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                {rows.map((row) => (
                  <button key={row.id} type="button" onClick={() => setSelectedFileId(row.id)} style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: 8,
                    padding: '9px 10px',
                    borderTop: '1px solid var(--line)',
                    borderRight: 0,
                    borderBottom: 0,
                    borderLeft: 0,
                    marginTop: -1,
                    background: selectedFile?.id === row.id ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))' : 'var(--surface)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div title={row.label} style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: FONT_BODY,
                        fontSize: 12.5,
                        color: 'var(--ink)',
                        fontWeight: 600,
                      }}>
                        {row.label}
                      </div>
                      {(row.before || row.after) && (
                        <div style={{
                          marginTop: 3,
                          fontFamily: FONT_MONO,
                          fontSize: 10.5,
                          color: 'var(--ink-4)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {row.before ? `${row.before} -> ` : ''}{row.after}
                        </div>
                      )}
                    </div>
                    {row.status && (
                      <span style={statusStyles(true, String(row.status).toLowerCase() === 'removed')}>{row.status}</span>
                    )}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 8 }}>
                <FileDiffInspector row={selectedFile} />
              </div>
            </div>
          )}
		          {textDiff && (
		            <div>
		              <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: 'var(--ink-4)', marginBottom: 8 }}>
		                Detailed changes
		              </div>
	              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.4, marginBottom: 8 }}>
	                Added lines are highlighted in green and removed lines are highlighted in red.
	              </div>
	              <div style={{
	                border: '1px solid var(--line)',
                borderRadius: 8,
                overflow: 'auto',
                maxHeight: 420,
                background: 'var(--surface)',
              }}>
                {String(textDiff).split('\n').slice(0, 800).map((line, index) => (
                  <DiffLine key={`${index}-${line}`} line={line} index={index} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VersionActionModal({
  open,
  title,
  icon,
  primaryLabel,
  busyLabel,
  busy,
  nameLabel,
  nameValue,
  noteLabel,
  noteValue,
  notePlaceholder,
  consequence,
  error,
  children,
  onNameChange,
  onNoteChange,
  onConfirm,
  onClose,
}) {
  if (!open) return null;
  const nameMissing = !String(nameValue || '').trim();
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      width="min(520px, 94vw)"
      height="auto"
      ariaLabel={title}
    >
      <div style={{
        flex: '0 0 auto',
        padding: '14px 16px',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'var(--surface)',
      }}>
        <span style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          display: 'inline-grid',
          placeItems: 'center',
          color: 'var(--accent)',
          background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--accent) 24%, var(--line))',
          flexShrink: 0,
        }}>
          {icon || Ico.clock(14)}
        </span>
        <div style={{ minWidth: 0, fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
          {title}
        </div>
      </div>
      <div style={{
        flex: '0 0 auto',
        padding: 16,
        display: 'grid',
        gap: 12,
        background: 'var(--surface)',
      }}>
        <label style={{ display: 'grid', gap: 5, fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-4)' }}>
          {nameLabel}
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => onNameChange?.(e.target.value)}
            disabled={busy}
            style={{
              height: 34,
              minWidth: 0,
              borderRadius: 8,
              border: `1px solid ${nameMissing ? 'color-mix(in srgb, var(--danger) 44%, var(--line))' : 'var(--line)'}`,
              background: busy ? 'var(--surface-2)' : 'var(--surface)',
              color: 'var(--ink)',
              fontFamily: FONT_BODY,
              fontSize: 13,
              padding: '0 9px',
              outline: 0,
            }}
          />
        </label>
        {noteLabel && (
          <label style={{ display: 'grid', gap: 5, fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-4)' }}>
            {noteLabel}
            <textarea
              value={noteValue}
              onChange={(e) => onNoteChange?.(e.target.value)}
              disabled={busy}
              placeholder={notePlaceholder}
              rows={3}
              style={{
                width: '100%',
                minHeight: 72,
                boxSizing: 'border-box',
                resize: 'vertical',
                borderRadius: 8,
                border: '1px solid var(--line)',
                background: busy ? 'var(--surface-2)' : 'var(--surface)',
                color: 'var(--ink-2)',
                fontFamily: FONT_BODY,
                fontSize: 13,
                lineHeight: 1.4,
                padding: 9,
                outline: 0,
              }}
            />
          </label>
        )}
        {children}
        {consequence && (
          <div style={{
            border: '1px solid color-mix(in srgb, var(--accent) 20%, var(--line))',
            borderRadius: 8,
            background: 'color-mix(in srgb, var(--accent) 6%, var(--surface))',
            padding: '8px 9px',
            fontFamily: FONT_BODY,
            fontSize: 12.5,
            color: 'var(--ink-3)',
            lineHeight: 1.4,
          }}>
            {consequence}
          </div>
        )}
        {error && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--danger)', lineHeight: 1.35 }}>
            {error}
          </div>
        )}
      </div>
      <div style={{
        flex: '0 0 auto',
        padding: '12px 16px',
        borderTop: '1px solid var(--line)',
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 8,
        background: 'var(--surface-2)',
      }}>
        <button
          type="button"
          className="btn-secondary"
          onClick={onClose}
          disabled={busy}
          style={{ height: 30, padding: '0 10px' }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onConfirm}
          disabled={busy || nameMissing}
          style={{ height: 30, padding: '0 10px' }}
        >
          {busy ? busyLabel : primaryLabel}
        </button>
      </div>
    </Modal>
  );
}

function HistoryTab({
  path,
  active,
  artifact,
  onRestored,
  onLoaded,
  onStartTask,
  taskBusy,
  onCompareVersion,
  onPreviewVersion,
  onForked,
  onPublishVersion,
  previewVersionId,
  projects,
}) {
  const [state, setState] = useState({ status: 'idle', available: null, versions: [], meta: {}, error: '' });
  const [restoreId, setRestoreId] = useState('');
  const [forkId, setForkId] = useState('');
  const [publishId, setPublishId] = useState('');
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [pendingRestore, setPendingRestore] = useState(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveDraft, setSaveDraft] = useState({ label: '', note: '' });
  const [pendingFork, setPendingFork] = useState(null);
  const [forkDraft, setForkDraft] = useState({ name: '', targetProjectId: '' });
  const [message, setMessage] = useState('');

  const load = () => {
    if (!path) return;
    setState({ status: 'loading', available: null, versions: [], meta: {}, error: '' });
    setMessage('');
    fetchArtifactVersions(path)
      .then((data) => {
        const available = data?.available !== false;
        onLoaded?.(available ? { ...data, status: 'ready', error: '' } : { versions: [], status: 'unavailable', error: '' });
        setState({
          status: 'ready',
          available,
          versions: available ? (data?.versions || []) : [],
          meta: data || {},
          error: '',
        });
      })
      .catch((err) => {
        const message = err?.message || 'Could not load history.';
        onLoaded?.({ versions: [], status: 'error', error: message });
        setState({ status: 'error', available: true, versions: [], meta: {}, error: message });
      });
  };

  useEffect(() => {
    if (!active || !path) return;
    load();
  }, [active, path]);

  if (!active) return null;

  const versions = state.versions.map((item, index) => normalizeVersion(item, index, state.meta));
  const artifactTitle = artifact?.title || displayName(path);
  const projectOptions = Array.isArray(projects) ? projects.filter((project) => project?.id) : [];
  const currentVersion = versions.find((version) => version.current);
  const currentVersionNumber = Number(currentVersion?.versionNumber);
  const hasCurrentVersionNumber = Number.isFinite(currentVersionNumber);

  const restoreActionFor = (version) => {
    const versionNumber = Number(version?.versionNumber);
    const isRollForward = hasCurrentVersionNumber
      && Number.isFinite(versionNumber)
      && versionNumber > currentVersionNumber;
    return {
      isRollForward,
      actionLabel: isRollForward ? 'Roll forward' : 'Restore',
      busyLabel: isRollForward ? 'Rolling forward...' : 'Restoring...',
    };
  };

  const startVersionTask = (version) => {
    if (!onStartTask || !version?.id) return;
    onStartTask({
      versionId: version.id,
      title: `Work from ${version.label}`,
      prompt: `Continue work on "${artifactTitle}" from saved version "${version.label}". Review that version before making changes.`,
    });
  };

  const requestRestore = (version) => {
    if (!version?.id || restoreId) return;
    setPendingRestore({ ...version, ...restoreActionFor(version) });
  };

  const restoreConfirmed = async () => {
    const version = pendingRestore;
    if (!version?.id || restoreId) return;
    setRestoreId(version.id);
    setMessage('');
    try {
      const result = await restoreArtifactVersion(path, version.id);
      setMessage('Restored.');
      setPendingRestore(null);
      onRestored?.(result, version);
      load();
    } catch (err) {
      setMessage(err?.message || 'Restore failed.');
    } finally {
      setRestoreId('');
    }
  };

  const openSaveCheckpoint = () => {
    if (!path || checkpointBusy) return;
    const defaultName = `Saved ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    setSaveDraft({ label: defaultName, note: '' });
    setSaveModalOpen(true);
    setMessage('');
  };

  const saveCheckpointConfirmed = async () => {
    if (!path || checkpointBusy) return;
    const cleanLabel = saveDraft.label.trim();
    if (!cleanLabel) return;
    setCheckpointBusy(true);
    setMessage('');
    try {
      await createArtifactCheckpoint(path, { label: cleanLabel, prompt: saveDraft.note.trim() || undefined });
      setMessage(`Saved "${cleanLabel}".`);
      setSaveModalOpen(false);
      load();
    } catch (err) {
      setMessage(err?.message || 'Could not save version.');
    } finally {
      setCheckpointBusy(false);
    }
  };

  const onFork = async (version) => {
    if (!version?.id || forkId) return;
    const defaultName = `${artifact?.title || artifactTitle || 'Artifact'} remix`;
    setPendingFork(version);
    setForkDraft({ name: defaultName, targetProjectId: '' });
    setMessage('');
  };

  const forkConfirmed = async () => {
    const version = pendingFork;
    if (!version?.id || forkId) return;
    const cleanName = forkDraft.name.trim();
    if (!cleanName) return;
    setForkId(version.id);
    setMessage('');
    try {
      const result = await forkArtifactVersion(path, version.id, {
        name: cleanName,
        targetProjectId: forkDraft.targetProjectId || undefined,
      });
      setMessage(`Created "${cleanName}".`);
      setPendingFork(null);
      onForked?.(result);
      load();
    } catch (err) {
      setMessage(err?.message || 'Could not create remix.');
    } finally {
      setForkId('');
    }
  };

  const onPublishSavedVersion = async (version) => {
    if (!version?.id || publishId || !onPublishVersion) return;
    setPublishId(version.id);
    setMessage('');
    try {
      await onPublishVersion(version);
      load();
    } catch (err) {
      setMessage(err?.message || 'Could not publish this version.');
    } finally {
      setPublishId('');
    }
  };

  if (state.status === 'loading') return <EmptyLine>Loading history...</EmptyLine>;
  if (state.status === 'error') return <EmptyLine>{state.error}</EmptyLine>;
  const messageOk = message === 'Restored.' || message.startsWith('Saved "') || message.startsWith('Created "');
  if (state.available === false) {
    return (
      <div>
        <button
          type="button"
          className="btn-secondary"
          disabled
          style={{ width: '100%', height: 32, marginBottom: 10 }}
        >
          Save version
        </button>
        <EmptyState
          icon={Ico.clock(14)}
          title="Version history is not available yet."
          detail="This workspace can still preview and share the artifact."
        />
      </div>
    );
  }

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button
        type="button"
        className="btn-secondary"
        onClick={openSaveCheckpoint}
        disabled={!path || checkpointBusy}
        style={{ width: '100%', height: 32 }}
      >
        {checkpointBusy ? 'Saving...' : 'Save version'}
      </button>
      {message && (
        <div style={{
          padding: '8px 10px',
          borderRadius: 8,
          background: messageOk ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'var(--danger-bg)',
          color: messageOk ? 'color-mix(in srgb, var(--success) 80%, var(--ink))' : 'var(--danger)',
          fontFamily: FONT_BODY,
          fontSize: 12.5,
        }}>
          {message}
        </div>
      )}
      {versions.length === 0 && (
        <EmptyState
          icon={Ico.clock(14)}
          title="No saved versions yet."
          detail="Saved versions will appear here with restore controls."
        />
      )}
      {versions.map((version, index) => {
        const restoreAction = restoreActionFor(version);
        return (
        <div key={version.id} style={{
          display: 'grid',
          gridTemplateColumns: '16px minmax(0, 1fr)',
          gap: 10,
          paddingBottom: 12,
        }}>
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              marginTop: 5,
              background: version.current ? 'var(--accent)' : 'var(--ink-5)',
              boxShadow: version.current ? '0 0 8px var(--accent-glow)' : 'none',
            }} />
            {index < versions.length - 1 && (
              <span style={{
                position: 'absolute',
                top: 17,
                bottom: -12,
                width: 1,
                background: 'var(--line)',
              }} />
            )}
          </div>
          <div style={{
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: 10,
            background: 'var(--surface)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 9 }}>
              <div style={{ minWidth: 0 }}>
                <div title={version.label} style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--ink)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {version.label}
                </div>
	                <div style={{
	                  marginTop: 3,
	                  display: 'flex',
	                  alignItems: 'center',
	                  gap: 7,
	                  flexWrap: 'wrap',
	                  fontFamily: FONT_MONO,
	                  fontSize: 10.5,
	                  color: 'var(--ink-4)',
	                }}>
	                  {version.dateLabel && <span>{version.dateLabel}</span>}
	                  {version.author && <span>{version.author}</span>}
	                  {version.branchName && <span>{version.branchName}</span>}
	                </div>
	                {versionBadges(version).length > 0 && (
	                  <div style={{
	                    marginTop: 7,
	                    display: 'flex',
	                    alignItems: 'center',
	                    gap: 5,
	                    flexWrap: 'wrap',
	                  }}>
	                    {versionBadges(version).map((badge) => (
	                      <span key={badge.id} style={statusStyles(badge.active, badge.danger)}>
	                        {badge.label}
	                      </span>
	                    ))}
	                  </div>
	                )}
	              </div>
	              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
                {onPreviewVersion && (
                  <button
                    type="button"
                    onClick={() => onPreviewVersion(version)}
                    disabled={!version.id || previewVersionId === version.id}
                    className="btn-secondary"
                    style={{ height: 28, padding: '0 8px' }}
                    title={previewVersionId === version.id ? `Previewing ${version.label}` : `Preview ${version.label}`}
                  >
                    {previewVersionId === version.id ? 'Previewing' : 'Preview'}
                  </button>
                )}
                {onCompareVersion && (
                  <button
                    type="button"
                    onClick={() => onCompareVersion(version)}
                    disabled={!version.id}
                    className="btn-secondary"
                    style={{ height: 28, padding: '0 8px' }}
                    title={`Compare ${version.label} with the current draft`}
                  >
                    Compare
                  </button>
                )}
                {onPublishVersion && (
                  <button
                    type="button"
                    onClick={() => onPublishSavedVersion(version)}
                    disabled={!version.id || publishId === version.id}
                    className="btn-secondary"
                    style={{ height: 28, padding: '0 8px' }}
                    title={`Publish ${version.label}`}
                  >
                    {publishId === version.id ? 'Opening...' : 'Publish'}
                  </button>
                )}
                {onStartTask && (
                  <button
                    type="button"
                    onClick={() => startVersionTask(version)}
	                    disabled={taskBusy || !version.id}
	                    className="btn-secondary"
	                    style={{ height: 28, padding: '0 8px' }}
	                    title={`Start a follow-up task from ${version.label}`}
	                  >
	                    Follow-up task
	                  </button>
	                )}
                <button
                  type="button"
                  onClick={() => onFork(version)}
	                  disabled={forkId === version.id}
	                  className="btn-secondary"
	                  style={{ height: 28, padding: '0 8px' }}
	                  title={`Remix or fork from ${version.label}`}
	                >
	                  {forkId === version.id ? 'Creating...' : 'Remix / fork'}
	                </button>
	                <button
	                  type="button"
	                  onClick={() => requestRestore(version)}
	                  disabled={restoreId === version.id}
	                  className="btn-secondary"
	                  style={{ height: 28, padding: '0 8px' }}
	                  title={`${restoreAction.actionLabel} to ${version.label}`}
	                >
	                  {restoreId === version.id ? restoreAction.busyLabel : `${restoreAction.actionLabel}...`}
		                </button>
		              </div>
	            </div>
	            {version.prompt && (
	              <div style={{
	                marginTop: 9,
	                borderTop: '1px solid var(--line)',
	                paddingTop: 8,
	                fontFamily: FONT_BODY,
	                fontSize: 12.5,
	                color: 'var(--ink-3)',
	                lineHeight: 1.45,
	              }}>
	                <span style={{ color: 'var(--ink-4)', fontFamily: FONT_MONO, fontSize: 10.5, textTransform: 'uppercase' }}>
	                  Reason
	                </span>
	                <div style={{ marginTop: 3 }}>{version.prompt}</div>
	              </div>
	            )}
	            {versionDetailItems(version).length > 0 && (
	              <div style={{
	                marginTop: 9,
	                display: 'grid',
	                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
	                gap: '6px 10px',
	              }}>
	                {versionDetailItems(version).map((item) => (
	                  <div key={`${item.label}-${item.value}`} title={item.title || item.value} style={{ minWidth: 0 }}>
	                    <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: 'var(--ink-4)', marginBottom: 1 }}>
	                      {item.label}
	                    </div>
	                    <div style={{
	                      overflow: 'hidden',
	                      textOverflow: 'ellipsis',
	                      whiteSpace: 'nowrap',
	                      fontFamily: FONT_BODY,
	                      fontSize: 12,
	                      color: 'var(--ink-2)',
	                    }}>
	                      {item.value}
	                    </div>
	                  </div>
	                ))}
	              </div>
	            )}
	          </div>
        </div>
        );
      })}
	    </div>
	    <ConfirmModal
	      open={!!pendingRestore}
	      title={`${pendingRestore?.actionLabel || 'Restore'} to ${pendingRestore?.label || 'saved version'}?`}
	      message={pendingRestore?.isRollForward
	        ? 'Cowork will save the current draft as a checkpoint first, then bring the artifact forward to this saved version.'
	        : 'Cowork will save the current draft as a checkpoint first, then replace the artifact files with this saved version. You can roll forward again from Versions if needed.'}
	      confirmLabel={pendingRestore?.actionLabel || 'Restore'}
	      cancelLabel="Cancel"
	      busy={!!restoreId}
	      busyLabel={pendingRestore?.busyLabel || 'Restoring...'}
	      onConfirm={restoreConfirmed}
	      onClose={() => { if (!restoreId) setPendingRestore(null); }}
	    />
    <VersionActionModal
      open={saveModalOpen}
      title="Save Version"
      icon={Ico.clock(14)}
      primaryLabel="Save version"
      busyLabel="Saving..."
      busy={checkpointBusy}
      nameLabel="Version name"
      nameValue={saveDraft.label}
      noteLabel="Note"
      noteValue={saveDraft.note}
      notePlaceholder="What changed or why this version matters"
      consequence="Cowork saves the current draft as a restorable version. It does not publish or change the public link."
      error={!saveDraft.label.trim() ? 'Add a version name.' : ''}
      onNameChange={(label) => setSaveDraft((prev) => ({ ...prev, label }))}
      onNoteChange={(note) => setSaveDraft((prev) => ({ ...prev, note }))}
      onConfirm={saveCheckpointConfirmed}
      onClose={() => { if (!checkpointBusy) setSaveModalOpen(false); }}
    />
    <VersionActionModal
      open={!!pendingFork}
      title="Create Remix"
      icon={Ico.branch?.(14) || Ico.copy?.(14) || Ico.doc(14)}
      primaryLabel="Create remix"
      busyLabel="Creating..."
      busy={!!forkId}
      nameLabel="Remix name"
      nameValue={forkDraft.name}
      consequence={`Cowork creates a separate copy from "${pendingFork?.label || 'this version'}". The current draft and public link stay unchanged.`}
      error={!forkDraft.name.trim() ? 'Add a remix name.' : ''}
      onNameChange={(name) => setForkDraft((prev) => ({ ...prev, name }))}
      onConfirm={forkConfirmed}
      onClose={() => { if (!forkId) setPendingFork(null); }}
    >
      {projectOptions.length > 0 && (
        <label style={{ display: 'grid', gap: 5, fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-4)' }}>
          Save remix in
          <select
            value={forkDraft.targetProjectId}
            onChange={(e) => setForkDraft((prev) => ({ ...prev, targetProjectId: e.target.value }))}
            disabled={!!forkId}
            style={{
              height: 34,
              minWidth: 0,
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: forkId ? 'var(--surface-2)' : 'var(--surface)',
              color: 'var(--ink-2)',
              fontFamily: FONT_BODY,
              fontSize: 13,
              padding: '0 9px',
              outline: 0,
            }}
          >
            <option value="">Current artifact project</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>{project.name || project.path || project.id}</option>
            ))}
          </select>
        </label>
      )}
    </VersionActionModal>
    </>
  );
}

function ReviewSummaryStrip({
  comments,
  openCount,
  suggestionCount,
  reviewRequestCount,
  resolvedCount,
  viewerState,
  onMarkSeen,
  markSeenBusy,
  onAddressOpen,
  taskBusy,
}) {
  const hasOpen = openCount > 0;
  const unreadCount = Number(viewerState?.unreadComments || 0);
  const needsAction = Number(viewerState?.needsAction || viewerState?.reviewRequests?.needsAction || 0);
  const hasViewerAttention = unreadCount > 0 || needsAction > 0;
  const statusTitle = reviewRequestCount > 0
    ? 'Review requested'
    : hasOpen
      ? 'Review in progress'
      : comments.length > 0
        ? 'All review items resolved'
        : 'Ready for feedback';
  const detailParts = [
    openCount > 0 ? countLabel(openCount, 'open note') : '',
    suggestionCount > 0 ? countLabel(suggestionCount, 'suggested change') : '',
    reviewRequestCount > 0 ? countLabel(reviewRequestCount, 'review request') : '',
    unreadCount > 0 ? countLabel(unreadCount, 'new item') : '',
  ].filter(Boolean);
  const detail = detailParts.length
    ? detailParts.join(' · ')
    : 'Comments, requests, and suggested changes will appear here.';

  return (
    <div style={{
      border: '1px solid var(--line)',
      borderRadius: 8,
      background: 'color-mix(in srgb, var(--accent) 6%, var(--surface))',
      padding: 10,
      display: 'grid',
      gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0, display: 'grid', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              display: 'inline-grid',
              placeItems: 'center',
              color: hasOpen ? 'var(--accent)' : 'var(--success)',
              background: hasOpen
                ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))'
                : 'color-mix(in srgb, var(--success) 11%, var(--surface))',
              border: `1px solid ${hasOpen ? 'color-mix(in srgb, var(--accent) 28%, var(--line))' : 'color-mix(in srgb, var(--success) 26%, var(--line))'}`,
              flexShrink: 0,
            }}>
              {hasOpen ? Ico.chats(12) : Ico.check(12)}
            </span>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>
              {statusTitle}
            </span>
            {hasViewerAttention && (
              <span style={statusStyles(true, false)}>
                {needsAction > 0 ? `${needsAction} for you` : `${unreadCount} new`}
              </span>
            )}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>
            {detail}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
          {hasViewerAttention && onMarkSeen && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onMarkSeen}
              disabled={markSeenBusy}
              style={{ height: 28, padding: '0 9px' }}
            >
              {markSeenBusy ? 'Marking...' : 'Mark seen'}
            </button>
          )}
          {hasOpen && onAddressOpen && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onAddressOpen}
              disabled={taskBusy}
              style={{ height: 28, padding: '0 9px' }}
            >
              {taskBusy ? 'Starting...' : 'Follow-up task'}
            </button>
          )}
        </div>
      </div>
      {comments.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 6,
        }}>
          {[
            ['Open', openCount],
            ['Suggested changes', suggestionCount],
            ['Requests', reviewRequestCount],
            ['Resolved', resolvedCount],
          ].map(([label, value]) => (
            <div key={label} style={{
              border: '1px solid var(--line)',
              borderRadius: 7,
              background: 'var(--surface)',
              padding: '6px 7px',
              minWidth: 0,
            }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>
                {value}
              </div>
              <div style={{
                fontFamily: FONT_MONO,
                fontSize: 9.5,
                color: 'var(--ink-4)',
                marginTop: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentsTab({
  active,
  path,
  artifact,
  onLoaded,
  onStartTask,
  onArtifactChanged,
  onReviewSummaryChange,
  taskBusy,
  selectedReviewItem,
  onSelectReviewItem,
}) {
  const [state, setState] = useState({ status: 'idle', available: null, comments: [], error: '', viewerState: { available: false } });
  const [draft, setDraft] = useState('');
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyOpen, setReplyOpen] = useState('');
  const [replyBusy, setReplyBusy] = useState('');
  const [markSeenBusy, setMarkSeenBusy] = useState(false);
  const [filter, setFilter] = useState('open');
  const [kind, setKind] = useState('comment');
  const [showExactEdit, setShowExactEdit] = useState(false);
  const [patchDraft, setPatchDraft] = useState({ path: '', find: '', replace: '' });
  const [anchorDraft, setAnchorDraft] = useState({ file: '', detail: '' });
  const [busy, setBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState('');
  const [previewBusy, setPreviewBusy] = useState('');
  const [patchPreviews, setPatchPreviews] = useState({});
  const artifactFiles = useMemo(() => normalizeFiles(artifact), [artifact]);
  const anchorOptions = useMemo(() => {
    const seen = new Set();
    return artifactFiles
      .map((file) => ({ value: fileOptionValue(file), label: fileOptionLabel(file) }))
      .filter((option) => {
        if (!option.value || seen.has(option.value)) return false;
        seen.add(option.value);
        return true;
      });
  }, [artifactFiles]);

  const publishCollaborationState = (comments, activity = [], extra = {}) => {
    const nextComments = Array.isArray(comments) ? comments : [];
    onLoaded?.({ ...extra, comments: nextComments, activity });
    onReviewSummaryChange?.({
      ...reviewSummaryFromComments(nextComments),
      viewerState: extra.viewerState || extra.viewer_state || state.viewerState || { available: false },
    });
  };

  const load = () => {
    if (!path) return;
    setState((prev) => ({ ...prev, status: 'loading', error: '' }));
    fetchArtifactComments(path)
      .then((data) => {
        const available = data?.available !== false;
        const nextComments = available ? (data?.comments || []) : [];
        const nextActivity = available ? (data?.activity || []) : [];
        const viewerState = data?.viewerState || { available: false };
        publishCollaborationState(
          nextComments,
          nextActivity,
          available ? { ...data, viewerState, status: 'ready', error: '' } : { status: 'unavailable', error: '' }
        );
        setState({
          status: 'ready',
          available,
          comments: nextComments,
          viewerState,
          error: '',
        });
      })
      .catch((err) => {
        const message = err?.message || 'Could not load review activity.';
        publishCollaborationState([], [], { status: 'error', error: message });
        setState({ status: 'error', available: true, comments: [], viewerState: { available: false }, error: message });
      });
  };

  useEffect(() => {
    if (!active || !path) return;
    load();
  }, [active, path]);

  useEffect(() => {
    setPatchDraft({
      path: artifactFiles[0]?.path || artifactFiles[0]?.name || '',
      find: '',
      replace: '',
    });
    setAnchorDraft({ file: artifactFiles[0]?.path || artifactFiles[0]?.name || '', detail: '' });
    setPatchPreviews({});
    setReplyDrafts({});
    setReplyOpen('');
    setShowExactEdit(false);
  }, [path, artifactFiles]);

  if (!active) return null;

  const comments = state.comments || [];
  const suggestionStatusOf = suggestionStatusOfComment;
  const isResolved = isResolvedComment;
  const isClosedReview = isClosedReviewComment;
  const openCount = comments.filter((comment) => !isClosedReview(comment)).length;
  const suggestionCount = comments.filter((comment) => comment.kind === 'suggestion').length;
  const reviewRequestCount = comments.filter((comment) => comment.kind === 'review' && !isClosedReview(comment)).length;
  const resolvedCount = comments.length - openCount;
  const idOf = (comment) => (comment?.id == null ? '' : String(comment.id));
  const parentIdOf = (comment) => {
    const parentId = comment?.parentCommentId || comment?.parent_comment_id || '';
    return parentId == null ? '' : String(parentId);
  };
  const commentTime = (comment) => {
    const time = Date.parse(comment?.createdAt || comment?.created_at || '');
    return Number.isNaN(time) ? 0 : time;
  };
  const rootNodes = [];
  const commentNodes = comments.map((comment, index) => ({ comment, index, replies: [] }));
  const nodeById = new Map(commentNodes.map((node) => [idOf(node.comment), node]).filter(([id]) => id));
  commentNodes.forEach((node) => {
    const parent = nodeById.get(parentIdOf(node.comment));
    if (parent && parent !== node) {
      parent.replies.push(node);
    } else {
      rootNodes.push(node);
    }
  });
  const sortReplyNodes = (nodes) => [...nodes]
    .sort((a, b) => commentTime(a.comment) - commentTime(b.comment) || a.index - b.index)
    .map((node) => ({ ...node, replies: sortReplyNodes(node.replies) }));
  const commentThreads = [...rootNodes]
    .sort((a, b) => Number(isClosedReview(a.comment)) - Number(isClosedReview(b.comment)) || a.index - b.index)
    .map((node) => ({ ...node, replies: sortReplyNodes(node.replies) }));
  const viewerState = state.viewerState || { available: false };
  const commentMatchesFilter = (comment) => {
    if (filter === 'all') return true;
    if (filter === 'open') return !isClosedReview(comment);
    if (filter === 'suggestions') return comment.kind === 'suggestion';
    if (filter === 'requests') return comment.kind === 'review';
    if (filter === 'unread') return !!comment?.viewerState?.unread || !!comment?.viewer_state?.unread;
    if (filter === 'resolved') return isClosedReview(comment);
    return true;
  };
  const filteredCommentThreads = commentThreads.filter((thread) => {
    if (commentMatchesFilter(thread.comment)) return true;
    return thread.replies.some((reply) => commentMatchesFilter(reply.comment));
  });
  const canPostThreadReplies = true;
  const patchPath = patchDraft.path.trim();
  const exactEditStarted = !!(patchDraft.find || patchDraft.replace);
  const proposedPatch = kind === 'suggestion' && showExactEdit && patchPath && patchDraft.find
    ? {
      operations: [{
        type: 'replace_text',
        path: patchPath,
        find: patchDraft.find,
        replace: patchDraft.replace,
      }],
    }
    : null;
  const patchIncomplete = kind === 'suggestion' && showExactEdit && exactEditStarted && !proposedPatch;
  const artifactTitle = artifact?.title || displayName(path);
  const buildCommentAnchor = () => {
    const file = (kind === 'suggestion' && patchPath ? patchPath : anchorDraft.file).trim();
    const detail = anchorDraft.detail.trim();
    if (!file && !detail) return {};
    return {
      kind: file ? 'file' : 'artifact',
      ...(file ? { file } : {}),
      ...(file ? { label: displayName(file) } : {}),
      ...(detail ? { detail } : {}),
    };
  };

  const addComment = async () => {
    const text = draft.trim();
    if (!text || busy || patchIncomplete) return;
    setBusy(true);
    try {
      const result = await createArtifactComment(path, { body: text, kind, proposedPatch, anchor: buildCommentAnchor() });
      const comments = result?.comments || (result?.comment ? [result.comment, ...state.comments] : state.comments);
      const viewerState = result?.viewerState || state.viewerState || { available: false };
      publishCollaborationState(comments, result?.activity || [], { viewerState });
      setState({ status: 'ready', available: true, comments, viewerState, error: '' });
      setDraft('');
      setPatchDraft((prev) => ({ ...prev, find: '', replace: '' }));
      setAnchorDraft((prev) => ({ ...prev, detail: '' }));
      setShowExactEdit(false);
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Could not add note.' }));
    } finally {
      setBusy(false);
    }
  };

  const openReplyComposer = (comment) => {
    const commentId = idOf(comment);
    if (!commentId) return;
    setReplyOpen((current) => (current === commentId ? '' : commentId));
    setReplyDrafts((prev) => (prev[commentId] == null ? { ...prev, [commentId]: '' } : prev));
  };

  const addReply = async (comment) => {
    const parentCommentId = idOf(comment);
    const text = (replyDrafts[parentCommentId] || '').trim();
    if (!parentCommentId || !text || replyBusy || !canPostThreadReplies) return;
    setReplyBusy(parentCommentId);
    try {
      const result = await createArtifactComment(path, { body: text, kind: 'comment', parentCommentId });
      const comments = result?.comments || (result?.comment ? [result.comment, ...state.comments] : state.comments);
      const viewerState = result?.viewerState || state.viewerState || { available: false };
      publishCollaborationState(comments, result?.activity || [], { viewerState });
      setState({ status: 'ready', available: true, comments, viewerState, error: '' });
      setReplyDrafts((prev) => {
        const next = { ...prev };
        delete next[parentCommentId];
        return next;
      });
      setReplyOpen('');
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Could not add reply.' }));
    } finally {
      setReplyBusy('');
    }
  };

  const markReviewSeen = async () => {
    if (!path || markSeenBusy) return;
    setMarkSeenBusy(true);
    try {
      const result = await markArtifactCommentsRead(path);
      const nextComments = result?.comments || state.comments;
      const nextActivity = result?.activity || [];
      const nextViewerState = result?.viewerState || { available: false };
      publishCollaborationState(nextComments, nextActivity, { viewerState: nextViewerState });
      setState({ status: 'ready', available: true, comments: nextComments, viewerState: nextViewerState, error: '' });
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Could not mark review items as seen.' }));
    } finally {
      setMarkSeenBusy(false);
    }
  };

  const toggleResolved = async (comment) => {
    if (!comment?.id || statusBusy) return;
    const nextResolved = !(comment.resolved || comment.status === 'resolved');
    setStatusBusy(comment.id);
    try {
      const result = await setArtifactCommentResolved(comment.id, nextResolved);
      const updated = result?.comment;
      if (updated) {
        const nextComments = state.comments.map((item) => (item.id === updated.id ? updated : item));
        setState((prev) => ({
          ...prev,
          comments: nextComments,
        }));
        publishCollaborationState(nextComments, [], { viewerState: state.viewerState || { available: false } });
      }
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Could not update note.' }));
    } finally {
      setStatusBusy('');
    }
  };

  const proposedPatchOf = (comment) => comment?.proposedPatch || comment?.proposed_patch || {};
  const patchOperationsOf = (comment) => {
    const operations = proposedPatchOf(comment)?.operations;
    return Array.isArray(operations) ? operations : [];
  };

  const taskPayloadForComment = (comment) => {
    const isSuggestion = comment.kind === 'suggestion';
    const body = comment.body || comment.text || '';
    const operations = patchOperationsOf(comment);
    const anchorLabel = anchorText(anchorOf(comment));
    const operationText = operations.map((operation) => {
      const parts = [
        operation.path ? `File: ${operation.path}` : '',
        operation.find != null ? `Find: ${operation.find}` : '',
        operation.replace != null ? `Replace with: ${operation.replace || '(remove text)'}` : '',
      ].filter(Boolean);
      return parts.join('\n');
    }).filter(Boolean).join('\n\n');
    return {
      commentId: comment.id,
      title: `${isSuggestion ? 'Revise suggested change' : 'Address review item'} for ${artifactTitle}`,
      prompt: [
        `Continue work on "${artifactTitle}" from this ${isSuggestion ? 'suggested change' : 'review item'}.`,
        anchorLabel ? `Anchor: ${anchorLabel}` : '',
        body,
        operationText ? `Proposed change:\n${operationText}` : '',
      ].filter(Boolean).join('\n\n'),
    };
  };

  const startCommentTask = (comment) => {
    if (!onStartTask || !comment?.id) return;
    onStartTask(taskPayloadForComment(comment));
  };

  const startOpenReviewTask = () => {
    if (!onStartTask || openCount === 0) return;
    const openItems = comments.filter((comment) => !isClosedReview(comment)).slice(0, 12);
    const itemText = openItems.map((comment, index) => {
      const label = comment.kind === 'suggestion'
        ? 'Suggested change'
        : comment.kind === 'review'
          ? 'Review request'
          : 'Comment';
      const anchorLabel = anchorText(anchorOf(comment));
      return [
        `${index + 1}. ${label}${anchorLabel ? ` (${anchorLabel})` : ''}`,
        comment.body || comment.text || '',
      ].filter(Boolean).join('\n');
    }).join('\n\n');
    onStartTask({
      title: `Address review items for ${artifactTitle}`,
      prompt: [
        `Continue work on "${artifactTitle}" and address the open review items below.`,
        itemText,
      ].filter(Boolean).join('\n\n'),
    });
  };

  const previewSuggestion = async (comment) => {
    if (!comment?.id || previewBusy) return;
    setPreviewBusy(comment.id);
    setPatchPreviews((prev) => ({ ...prev, [comment.id]: { status: 'loading', error: '', data: null } }));
    try {
      const data = await previewArtifactCommentPatch(comment.id);
      setPatchPreviews((prev) => ({ ...prev, [comment.id]: { status: 'ready', error: '', data } }));
    } catch (err) {
      setPatchPreviews((prev) => ({
        ...prev,
        [comment.id]: { status: 'error', error: err?.message || 'Could not preview this change.', data: null },
      }));
    } finally {
      setPreviewBusy('');
    }
  };

  const decideSuggestion = async (comment, nextStatus) => {
    if (!comment?.id || statusBusy) return;
    const hasPatch = patchOperationsOf(comment).length > 0;
    const previewState = patchPreviews[comment.id];
    if (nextStatus === 'accepted' && hasPatch && previewState?.status !== 'ready') {
      setState((prev) => ({ ...prev, error: 'Preview this exact change before applying it.' }));
      return;
    }
    setStatusBusy(comment.id);
    try {
      const result = nextStatus === 'accepted' && hasPatch
        ? await applyArtifactCommentPatch(comment.id)
        : await setArtifactSuggestionStatus(comment.id, nextStatus);
      const updated = result?.comment || {
        ...comment,
        status: nextStatus,
        suggestionStatus: nextStatus,
        suggestion_status: nextStatus,
        resolved: nextStatus !== 'open',
      };
      const nextComments = state.comments.map((item) => (item.id === comment.id ? updated : item));
      setState((prev) => ({
        ...prev,
        comments: nextComments,
      }));
      publishCollaborationState(nextComments, result?.activity || [], { viewerState: state.viewerState || { available: false } });
      if (nextStatus === 'accepted' && (result?.version || result?.changedPaths)) {
        onArtifactChanged?.(result);
      }
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Could not update suggestion.' }));
    } finally {
      setStatusBusy('');
    }
  };

  const commentKindLabel = (comment, isReply = false) => {
    if (isReply) return 'Reply';
    if (comment.kind === 'suggestion') return 'Suggested change';
    if (comment.kind === 'review') return 'Asked for review';
    return 'Comment';
  };

  const selectionForComment = (comment) => {
    const commentId = idOf(comment);
    const payload = taskPayloadForComment(comment);
    return {
      id: commentId || `${comment.createdAt || comment.created_at || ''}`,
      commentId,
      kind: comment.kind || 'comment',
      anchor: anchorOf(comment),
      body: comment.body || comment.text || '',
      hasPatch: patchOperationsOf(comment).length > 0,
      taskTitle: payload.title,
      taskPrompt: payload.prompt,
    };
  };

  const selectCommentContext = (comment) => {
    if (!onSelectReviewItem) return;
    onSelectReviewItem(selectionForComment(comment));
  };

  const isSelectedComment = (comment) => {
    const selectedId = selectedReviewItem?.commentId || selectedReviewItem?.id || '';
    const commentId = idOf(comment);
    return !!selectedId && !!commentId && String(selectedId) === String(commentId);
  };

  const renderReplyNode = (node) => {
    const comment = node.comment;
    const resolved = isResolved(comment);
    const suggestionStatus = suggestionStatusOf(comment);
    const accepted = suggestionStatus === 'accepted';
    const rejected = suggestionStatus === 'rejected';
    const closed = resolved || accepted || rejected;
    const isSuggestion = comment.kind === 'suggestion';
    const commentId = idOf(comment) || `${comment.createdAt || comment.created_at || node.index}`;
    return (
      <div key={commentId} style={{ display: 'grid', gap: 7 }}>
        <div style={{
          border: '1px solid var(--line)',
          borderRadius: 8,
          background: closed ? 'var(--surface-2)' : 'var(--surface)',
          padding: '8px 9px',
          opacity: closed ? 0.82 : 1,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            flexWrap: 'wrap',
            marginBottom: 4,
            fontFamily: FONT_MONO,
            fontSize: 10.5,
            color: 'var(--ink-4)',
          }}>
            <span>{comment.actorName || comment.actor_name || 'You'}</span>
            <span>{formatDate(comment.createdAt || comment.created_at)}</span>
            <span style={{
              color: isSuggestion ? 'var(--accent)' : 'var(--ink-4)',
              fontWeight: isSuggestion ? 600 : 500,
            }}>
              {commentKindLabel(comment, true)}
            </span>
	            {resolved && <span style={{ color: 'var(--success)' }}>Resolved</span>}
	            {accepted && <span style={{ color: 'var(--success)' }}>Approved</span>}
	            {rejected && <span style={{ color: 'var(--danger)' }}>Declined</span>}
            <AnchorChip
              anchor={anchorOf(comment)}
              active={isSelectedComment(comment)}
              onSelect={onSelectReviewItem ? () => selectCommentContext(comment) : null}
            />
	          </div>
	          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>
	            {comment.body || comment.text}
          </div>
        </div>
        {node.replies.length > 0 && (
          <div style={{
            marginLeft: 14,
            paddingLeft: 10,
            borderLeft: '2px solid var(--line)',
            display: 'grid',
            gap: 7,
          }}>
            {node.replies.map((reply) => renderReplyNode(reply))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {state.available !== false && (
        <ReviewSummaryStrip
          comments={comments}
          openCount={openCount}
          suggestionCount={suggestionCount}
          reviewRequestCount={reviewRequestCount}
          resolvedCount={resolvedCount}
          viewerState={viewerState}
          onMarkSeen={viewerState?.available !== false ? markReviewSeen : null}
          markSeenBusy={markSeenBusy}
          onAddressOpen={onStartTask && openCount > 0 ? startOpenReviewTask : null}
          taskBusy={taskBusy}
        />
      )}
      {state.available !== false && comments.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            ['open', `Open ${openCount || ''}`.trim()],
            ['suggestions', `Suggestions ${suggestionCount || ''}`.trim()],
            ['requests', `Review requests ${reviewRequestCount || ''}`.trim()],
            ['unread', `New ${Number(viewerState?.unreadComments || 0) || ''}`.trim()],
            ['resolved', `Resolved ${resolvedCount || ''}`.trim()],
            ['all', 'All'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              style={{
                height: 28,
                borderRadius: 999,
                border: '1px solid var(--line)',
                background: filter === value ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                color: filter === value ? 'var(--ink)' : 'var(--ink-3)',
                fontFamily: FONT_BODY,
                fontSize: 12,
                fontWeight: filter === value ? 600 : 500,
                padding: '0 9px',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div style={{
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: 'var(--surface)',
        overflow: 'hidden',
      }}>
	        <textarea
	          value={draft}
	          onChange={(e) => setDraft(e.target.value)}
          placeholder={kind === 'suggestion'
            ? 'What should change? Add exact replacement text below only if you know it.'
            : kind === 'review'
              ? 'What needs review?'
              : 'Leave a comment or decision context'}
          disabled={state.available === false}
          rows={3}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'vertical',
            border: 0,
            outline: 0,
            background: 'transparent',
            color: state.available === false ? 'var(--ink-5)' : 'var(--ink)',
            fontFamily: FONT_BODY,
            fontSize: 13,
            lineHeight: 1.45,
	            padding: 10,
	          }}
	        />
	        <div style={{
	          borderTop: '1px solid var(--line)',
	          padding: 10,
	          display: 'grid',
	          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
	          gap: 8,
	          background: 'var(--surface-2)',
	        }}>
	          <label style={{ display: 'grid', gap: 4, fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)', minWidth: 0 }}>
	            Attach to
	            <select
	              value={anchorDraft.file}
	              onChange={(e) => {
	                const nextFile = e.target.value;
	                setAnchorDraft((prev) => ({ ...prev, file: nextFile }));
	                if (kind === 'suggestion' && !patchDraft.path.trim()) {
	                  setPatchDraft((prev) => ({ ...prev, path: nextFile }));
	                }
	              }}
	              disabled={state.available === false}
	              style={{
	                height: 28,
	                borderRadius: 8,
	                border: '1px solid var(--line)',
	                background: state.available === false ? 'var(--surface-3)' : 'var(--surface)',
	                color: state.available === false ? 'var(--ink-5)' : 'var(--ink-2)',
	                fontFamily: FONT_BODY,
	                fontSize: 12,
	                padding: '0 8px',
	                outline: 0,
	                minWidth: 0,
	              }}
	            >
	              <option value="">Whole artifact</option>
	              {anchorOptions.map((option) => (
	                <option key={option.value} value={option.value}>{option.label}</option>
	              ))}
	            </select>
	          </label>
	          <label style={{ display: 'grid', gap: 4, fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)', minWidth: 0 }}>
	            Area
	            <input
	              type="text"
	              value={anchorDraft.detail}
	              onChange={(e) => setAnchorDraft((prev) => ({ ...prev, detail: e.target.value }))}
	              placeholder="Section, slide, row, or line"
	              disabled={state.available === false}
	              style={{
	                height: 28,
	                borderRadius: 8,
	                border: '1px solid var(--line)',
	                background: state.available === false ? 'var(--surface-3)' : 'var(--surface)',
	                color: state.available === false ? 'var(--ink-5)' : 'var(--ink-2)',
	                fontFamily: FONT_BODY,
	                fontSize: 12,
	                padding: '0 8px',
	                outline: 0,
	                minWidth: 0,
	              }}
	            />
	          </label>
	        </div>
	        {kind === 'suggestion' && (
	          <div style={{
	            borderTop: '1px solid var(--line)',
            padding: 10,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: 8,
            background: 'var(--surface-2)',
          }}>
            <button
              type="button"
              onClick={() => setShowExactEdit((value) => !value)}
              disabled={state.available === false}
              style={{
                minHeight: 30,
                borderRadius: 8,
                border: '1px solid var(--line)',
                background: showExactEdit ? 'var(--surface)' : 'transparent',
                color: state.available === false ? 'var(--ink-5)' : 'var(--ink-2)',
                cursor: state.available === false ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '6px 8px',
                textAlign: 'left',
                fontFamily: FONT_BODY,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <span>Add exact replacement</span>
              <span style={{ display: 'inline-flex', color: 'var(--ink-4)' }}>
                {showExactEdit ? Ico.chevronUp?.(12) || Ico.close(12) : Ico.chevronDown?.(12) || Ico.chevronRight?.(12)}
              </span>
            </button>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: patchIncomplete ? 'var(--danger)' : 'var(--ink-4)', lineHeight: 1.35 }}>
              {patchIncomplete
                ? 'Add the text to find, or clear the replacement fields to leave this as a plain suggestion.'
                : 'Use this when you know the exact text to replace. Otherwise, a plain-language suggestion is enough.'}
            </div>
            {showExactEdit && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr)',
                gap: 8,
              }}>
                <label style={{ display: 'grid', gap: 4, fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)' }}>
                  File
                  <input
                    type="text"
                    value={patchDraft.path}
                    onChange={(e) => setPatchDraft((prev) => ({ ...prev, path: e.target.value }))}
                    placeholder={artifactFiles[0]?.path || artifactFiles[0]?.name || 'report.md'}
                    disabled={state.available === false}
                    style={{
                      height: 28,
                      borderRadius: 8,
                      border: '1px solid var(--line)',
                      background: state.available === false ? 'var(--surface-3)' : 'var(--surface)',
                      color: state.available === false ? 'var(--ink-5)' : 'var(--ink-2)',
                      fontFamily: FONT_BODY,
                      fontSize: 12,
                      padding: '0 8px',
                      outline: 0,
                      minWidth: 0,
                    }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 4, fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)' }}>
                  Find text
                  <textarea
                    value={patchDraft.find}
                    onChange={(e) => setPatchDraft((prev) => ({ ...prev, find: e.target.value }))}
                    rows={2}
                    disabled={state.available === false}
                    style={{
                      minHeight: 46,
                      resize: 'vertical',
                      borderRadius: 8,
                      border: '1px solid var(--line)',
                      background: state.available === false ? 'var(--surface-3)' : 'var(--surface)',
                      color: state.available === false ? 'var(--ink-5)' : 'var(--ink-2)',
                      fontFamily: FONT_BODY,
                      fontSize: 12,
                      lineHeight: 1.35,
                      padding: 7,
                      outline: 0,
                      minWidth: 0,
                    }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 4, fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)' }}>
                  Replace with
                  <textarea
                    value={patchDraft.replace}
                    onChange={(e) => setPatchDraft((prev) => ({ ...prev, replace: e.target.value }))}
                    rows={2}
                    disabled={state.available === false}
                    style={{
                      minHeight: 46,
                      resize: 'vertical',
                      borderRadius: 8,
                      border: '1px solid var(--line)',
                      background: state.available === false ? 'var(--surface-3)' : 'var(--surface)',
                      color: state.available === false ? 'var(--ink-5)' : 'var(--ink-2)',
                      fontFamily: FONT_BODY,
                      fontSize: 12,
                      lineHeight: 1.35,
                      padding: 7,
                      outline: 0,
                      minWidth: 0,
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 8px 8px' }}>
          <div style={{
            display: 'inline-flex',
            border: '1px solid var(--line)',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            {[
              ['comment', 'Comment'],
              ['suggestion', 'Suggest change'],
              ['review', 'Ask for review'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setKind(value);
                  if (value !== 'suggestion') setShowExactEdit(false);
                }}
                aria-pressed={kind === value}
                disabled={state.available === false}
                style={{
                  height: 28,
                  border: 0,
                  borderLeft: value !== 'comment' ? '1px solid var(--line)' : 0,
                  background: kind === value ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))' : 'transparent',
                  color: state.available === false ? 'var(--ink-5)' : kind === value ? 'var(--ink)' : 'var(--ink-3)',
                  fontFamily: FONT_BODY,
                  fontSize: 12,
                  fontWeight: kind === value ? 600 : 500,
                  padding: '0 9px',
                  cursor: state.available === false ? 'not-allowed' : 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={addComment}
            disabled={!draft.trim() || patchIncomplete || busy || state.available === false}
            style={{ height: 28, padding: '0 10px' }}
          >
            {busy ? 'Adding...' : kind === 'suggestion' ? 'Suggest change' : kind === 'review' ? 'Ask for review' : 'Comment'}
          </button>
        </div>
      </div>

      {state.status === 'loading' ? (
        <EmptyLine>Loading review activity...</EmptyLine>
      ) : state.error ? (
        <EmptyState
          icon={Ico.refresh(14)}
          title="Review activity could not be loaded."
          detail={state.error}
        />
      ) : state.available === false ? (
        <EmptyState
          icon={Ico.chats(14)}
          title="Review activity is not available yet."
          detail="Comments, review requests, and suggested changes are not set up for this workspace yet."
        />
      ) : comments.length === 0 ? (
        <EmptyState
          icon={Ico.chats(14)}
          title="No review activity yet."
          detail="Comments, review requests, and suggested changes will appear here."
        />
      ) : filteredCommentThreads.length === 0 ? (
        <EmptyState
          icon={Ico.filter?.(14) || Ico.chats(14)}
          title="No matching comments."
          detail="Change the filter to see other review items."
        />
      ) : filteredCommentThreads.map((thread) => {
        const comment = thread.comment;
        const index = thread.index;
        const resolved = isResolved(comment);
        const suggestionStatus = suggestionStatusOf(comment);
        const accepted = suggestionStatus === 'accepted';
        const rejected = suggestionStatus === 'rejected';
        const closed = resolved || accepted || rejected;
        const isSuggestion = comment.kind === 'suggestion';
        const patchOperations = patchOperationsOf(comment);
        const hasPatch = patchOperations.length > 0;
        const firstPatchPath = patchOperations.find((operation) => operation.path)?.path || '';
        const previewState = comment.id ? patchPreviews[comment.id] : null;
        const patchPreviewReady = !hasPatch || previewState?.status === 'ready';
        const previewDiff = previewState?.data?.diff?.textDiff || previewState?.data?.diff?.diff || '';
        const commentId = idOf(comment);
        const fallbackKey = `${comment.createdAt || comment.created_at || index}`;
        const replyDraft = replyDrafts[commentId] || '';
        const replyOpenForComment = replyOpen === commentId;
        const rowViewerState = comment.viewerState || comment.viewer_state || {};
        const rowUnread = !!rowViewerState.unread;
        const rowNeedsAction = !!rowViewerState.needsAction;
        return (
        <div key={commentId || fallbackKey} style={{ display: 'grid', gap: 8 }}>
        <div style={{
          border: `1px solid ${rowNeedsAction || rowUnread ? 'color-mix(in srgb, var(--accent) 44%, var(--line))' : isSuggestion ? 'color-mix(in srgb, var(--accent) 34%, var(--line))' : 'var(--line)'}`,
          borderRadius: 8,
          background: rowNeedsAction || rowUnread
            ? 'color-mix(in srgb, var(--accent) 7%, var(--surface))'
            : closed ? 'var(--surface-2)' : 'var(--surface)',
          padding: 10,
          opacity: closed ? 0.82 : 1,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 5,
            fontFamily: FONT_MONO,
            fontSize: 10.5,
            color: 'var(--ink-4)',
          }}>
            <span>{comment.actorName || comment.actor_name || 'You'}</span>
            <span>{formatDate(comment.createdAt || comment.created_at)}</span>
            <span style={{
              color: isSuggestion ? 'var(--accent)' : 'var(--ink-4)',
              fontWeight: isSuggestion ? 600 : 500,
            }}>
              {commentKindLabel(comment)}
            </span>
	            {rowNeedsAction && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>For you</span>}
	            {!rowNeedsAction && rowUnread && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>New</span>}
	            {resolved && <span style={{ color: 'var(--success)' }}>Resolved</span>}
	            {accepted && <span style={{ color: 'var(--success)' }}>Approved</span>}
	            {rejected && <span style={{ color: 'var(--danger)' }}>Declined</span>}
	            <AnchorChip
	              anchor={anchorOf(comment)}
	              active={isSelectedComment(comment)}
	              onSelect={onSelectReviewItem ? () => selectCommentContext(comment) : null}
	            />
	          </div>
	          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
	            {comment.body || comment.text}
          </div>
          {hasPatch && (
            <div style={{
              marginTop: 9,
              border: '1px solid var(--line)',
              borderRadius: 8,
              background: 'var(--surface-2)',
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '7px 8px',
                borderBottom: '1px solid var(--line)',
              }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                  Suggested change{firstPatchPath ? ` to ${displayName(firstPatchPath)}` : ''}
                </div>
                {!accepted && !rejected && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => previewSuggestion(comment)}
                    disabled={previewBusy === comment.id || statusBusy === comment.id || !comment.id}
                    style={{ height: 24, padding: '0 8px', fontSize: 11.5 }}
                  >
                    {previewBusy === comment.id ? 'Previewing...' : 'Preview change'}
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gap: 7, padding: 8 }}>
                {patchOperations.map((operation, opIndex) => (
                  <div key={`${operation.path || opIndex}-${operation.type || 'change'}`} style={{
                    display: 'grid',
                    gap: 5,
                    minWidth: 0,
                  }}>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-3)' }}>
                      Replace text in <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{operation.path || 'artifact file'}</span>
                    </div>
                    {operation.find != null && (
                      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)', display: 'grid', gap: 3 }}>
                        <span>Find</span>
                        <span style={{
                          borderRadius: 6,
                          background: 'color-mix(in srgb, var(--danger) 8%, var(--surface))',
                          color: 'var(--ink-2)',
                          padding: '5px 6px',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}>
                          {operation.find}
                        </span>
                      </div>
                    )}
                    {operation.replace != null && (
                      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)', display: 'grid', gap: 3 }}>
                        <span>Replace with</span>
                        <span style={{
                          borderRadius: 6,
                          background: 'color-mix(in srgb, var(--success) 9%, var(--surface))',
                          color: 'var(--ink-2)',
                          padding: '5px 6px',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}>
                          {operation.replace || '(remove text)'}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
                {previewState?.status === 'error' && (
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--danger)', lineHeight: 1.35 }}>
                    {previewState.error}
                  </div>
                )}
                {hasPatch && !accepted && !rejected && previewState?.status !== 'ready' && previewState?.status !== 'loading' && (
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.35 }}>
                    Preview required before applying.
                  </div>
                )}
                {previewState?.status === 'ready' && (
                  <div style={{
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    background: 'var(--surface)',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--line)',
                      fontFamily: FONT_BODY,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: 'var(--ink-3)',
                    }}>
                      Preview of exact change
                    </div>
                    <div style={{
                      padding: '6px 8px',
                      borderBottom: previewDiff ? '1px solid var(--line)' : 0,
                      fontFamily: FONT_BODY,
                      fontSize: 11.5,
                      color: 'var(--ink-4)',
                      lineHeight: 1.35,
                    }}>
                      Applying saves a checkpoint and updates the current draft. The public link stays pinned until republished.
                    </div>
                    {previewDiff ? (
                      <div style={{ maxHeight: 180, overflow: 'auto' }}>
                        {String(previewDiff).split('\n').slice(0, 160).map((line, diffIndex) => (
                          <DiffLine key={`${diffIndex}-${line}`} line={line} index={diffIndex} />
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: 8, fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)' }}>
                        Preview is ready.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => openReplyComposer(comment)}
              disabled={!commentId}
              style={{ height: 26, padding: '0 8px' }}
            >
              {replyOpenForComment ? 'Close reply' : 'Reply'}
            </button>
            {onStartTask && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => startCommentTask(comment)}
                disabled={taskBusy || !comment.id}
                style={{ height: 26, padding: '0 8px' }}
                title={isSuggestion ? 'Start a follow-up task for this suggested change' : 'Start a follow-up task for this review item'}
              >
                {taskBusy ? 'Starting...' : isSuggestion ? 'Follow up on suggestion' : 'Follow-up task'}
              </button>
            )}
            {isSuggestion && !accepted && !rejected && (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => decideSuggestion(comment, 'rejected')}
                  disabled={statusBusy === comment.id || !comment.id}
                  style={{ height: 26, padding: '0 8px' }}
                >
                  {statusBusy === comment.id ? 'Updating...' : 'Decline'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => decideSuggestion(comment, 'accepted')}
                  disabled={statusBusy === comment.id || !comment.id || !patchPreviewReady}
                  title={!patchPreviewReady ? 'Preview this exact change before applying it' : undefined}
                  style={{ height: 26, padding: '0 8px' }}
                >
                  {statusBusy === comment.id ? 'Updating...' : hasPatch ? 'Apply to draft' : 'Mark approved'}
                </button>
              </>
            )}
            {isSuggestion && (accepted || rejected) && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => decideSuggestion(comment, 'open')}
                disabled={statusBusy === comment.id || !comment.id}
                style={{ height: 26, padding: '0 8px' }}
              >
                Reopen
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => toggleResolved(comment)}
              disabled={statusBusy === comment.id || !comment.id || accepted || rejected}
              style={{ height: 26, padding: '0 8px' }}
            >
              {statusBusy === comment.id ? 'Updating...' : resolved ? 'Reopen' : 'Resolve'}
            </button>
          </div>
          {replyOpenForComment && (
            <div style={{
              marginTop: 9,
              borderTop: '1px solid var(--line)',
              paddingTop: 9,
              display: 'grid',
              gap: 7,
            }}>
              <textarea
                value={replyDraft}
                onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [commentId]: e.target.value }))}
                placeholder="Reply in this thread"
                rows={2}
                disabled={!canPostThreadReplies}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  minHeight: 54,
                  resize: 'vertical',
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                  background: canPostThreadReplies ? 'var(--surface)' : 'var(--surface-2)',
                  color: canPostThreadReplies ? 'var(--ink-2)' : 'var(--ink-5)',
                  fontFamily: FONT_BODY,
                  fontSize: 12.5,
                  lineHeight: 1.4,
                  padding: 8,
                  outline: 0,
                }}
              />
              {!canPostThreadReplies && (
                <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.35 }}>
                  Threaded replies can be viewed here. Posting replies is not enabled for this workspace yet.
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setReplyOpen('')}
                  style={{ height: 26, padding: '0 8px' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => addReply(comment)}
                  disabled={!canPostThreadReplies || !replyDraft.trim() || replyBusy === commentId}
                  style={{ height: 26, padding: '0 8px' }}
                >
                  {replyBusy === commentId ? 'Adding...' : 'Add reply'}
                </button>
              </div>
            </div>
          )}
        </div>
        {thread.replies.length > 0 && (
          <div style={{
            marginLeft: 18,
            paddingLeft: 10,
            borderLeft: '2px solid var(--line)',
            display: 'grid',
            gap: 8,
          }}>
            {thread.replies.map((reply) => renderReplyNode(reply))}
          </div>
        )}
        </div>
      );})}
    </div>
  );
}

function humanizeActivityType(event) {
  const raw = event?.eventType || event?.event_type || event?.type || event?.kind || '';
  const key = String(raw)
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const commentKind = event?.commentKind || event?.comment_kind || event?.kind || '';
  const target = event?.details?.target || '';
  if (key === 'accepted_patch') return 'Suggested change applied';
  if (key === 'accepted') return 'Suggested change approved';
  if (key === 'rejected') return 'Suggested change declined';
  if (key === 'resolved') return 'Review item resolved';
  if (key === 'reopened') return 'Review item reopened';
  if (key === 'review_requested') return 'Review requested';
  if (key === 'suggested' || commentKind === 'suggestion') return 'Suggested change added';
  if (key === 'commented') return 'Comment added';
  if (key === 'review_accept') return 'Draft updated from review';
  if (key === 'review_safety') return 'Checkpoint before review change';
  if (key === 'generated_update') return 'Generated update saved';
  if (key === 'pre_generated_update') return 'Checkpoint before generated update';
  if (key === 'pre_edit') return 'Checkpoint before edit';
  if (key === 'edit' || key === 'delete_file') return 'File edited';
  if (key === 'pre_delete' || key === 'pre_delete_file') return 'Checkpoint before delete';
  if (key === 'deleted') return 'Artifact deleted';
  if (key === 'fork') return 'Remix created';
  if (key.includes('restore')) return 'Version restored';
  if (key === 'published') return 'Published';
  if (key === 'unpublished') return 'Unpublished';
  if (key === 'failed') return target === 'preview' ? 'Preview failed' : 'Publish failed';
  if (key === 'ready') return 'Preview ready';
  if (key === 'publish') return 'Publish checkpoint saved';
  if (key.includes('checkpoint') || (key.includes('version') && (key.includes('create') || key.includes('save')))) return 'Saved version created';
  if (key.includes('review') && key.includes('request')) return 'Review requested';
  if (key.includes('update') || key.includes('change')) return 'Artifact updated';
  if (!raw) return 'Activity';
  return String(raw)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function notificationDeliverySummary(deliveries) {
  const list = Array.isArray(deliveries) ? deliveries : [];
  if (!list.length) return '';
  const counts = list.reduce((acc, delivery) => {
    const status = String(delivery?.status || 'queued');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([status, count]) => `${count} ${count === 1 ? 'notification' : 'notifications'} ${status}`)
    .join(', ');
}

function activityDetail(event) {
  const details = event?.details || {};
  const actor = event?.actorName || event?.actor_name || event?.actor || 'Someone';
  const date = formatDate(event?.createdAt || event?.created_at || event?.timestamp || event?.time);
  const note = details.label || details.prompt || event?.label || event?.title || event?.summary || event?.body || event?.text || '';
  const version = details.versionNumber ? `v${details.versionNumber}` : event?.versionId ? `Version ${String(event.versionId).slice(0, 8)}` : '';
  const target = details.target && details.status ? `${details.target} ${details.status}` : details.target || '';
  const changed = Array.isArray(details.changedPaths) && details.changedPaths.length
    ? `${details.changedPaths.length} ${details.changedPaths.length === 1 ? 'file' : 'files'} changed`
    : '';
  const deliveries = notificationDeliverySummary(details.notificationDeliveries);
  return [actor, date, note, version, target, changed, deliveries].filter(Boolean).join(' · ');
}

function activityTone(label) {
  const clean = String(label || '').toLowerCase();
  if (clean.includes('failed') || clean.includes('declined') || clean.includes('deleted')) return 'var(--danger)';
  if (label.includes('Suggestion') || label.includes('Suggested') || label.includes('Review')) return 'var(--accent)';
  if (clean.includes('resolved') || label.includes('Published') || clean.includes('applied') || clean.includes('ready')) return 'var(--success)';
  if (clean.includes('restored') || label.includes('Checkpoint')) return 'var(--ink-3)';
  return 'var(--accent)';
}

function activityTimeValue(event) {
  const time = Date.parse(event?.createdAt || event?.created_at || event?.timestamp || event?.time || '');
  return Number.isNaN(time) ? 0 : time;
}

function activityRowKey(row, index) {
  return row.id || `${row.label}-${row.detail}-${index}`;
}

function ActivityTab({ active, artifact, versionsState, collaborationState }) {
  if (!active) return null;
  const rows = [];
  const versionsLoading = versionsState?.status === 'loading';
  const collaborationLoading = collaborationState?.status === 'loading';
  const versionsUnavailable = versionsState?.status === 'unavailable';
  const collaborationUnavailable = collaborationState?.status === 'unavailable';
  const versionsError = versionsState?.status === 'error' ? versionsState?.error : '';
  const collaborationError = collaborationState?.status === 'error' ? collaborationState?.error : '';
  const notices = [
    versionsLoading ? 'Saved version history is still loading.' : '',
    collaborationLoading ? 'Review activity is still loading.' : '',
    versionsUnavailable ? 'Saved version history is not available from this server.' : '',
    collaborationUnavailable ? 'Review activity is not available from this server.' : '',
    versionsError ? `Saved version history could not be loaded: ${versionsError}` : '',
    collaborationError ? `Review activity could not be loaded: ${collaborationError}` : '',
  ].filter(Boolean);
  if (Array.isArray(collaborationState?.activity)) {
    const seen = new Set();
    const events = [...collaborationState.activity]
      .sort((a, b) => activityTimeValue(b) - activityTimeValue(a));
    for (const event of events) {
      const id = event?.id || `${event?.eventType || event?.event_type}-${event?.createdAt || event?.created_at}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const label = humanizeActivityType(event);
      rows.push({
        id,
        label,
        detail: activityDetail(event),
        tone: activityTone(label),
        time: activityTimeValue(event),
      });
    }
  }
  const comments = Array.isArray(collaborationState?.comments) ? collaborationState.comments : [];
  if (comments.length) {
    const open = comments.filter((comment) => {
      const suggestionStatus = comment.suggestionStatus || comment.suggestion_status || comment.status;
      return !(comment.resolved || comment.status === 'resolved' || suggestionStatus === 'accepted' || suggestionStatus === 'rejected');
    }).length;
    const suggestions = comments.filter((comment) => comment.kind === 'suggestion').length;
    rows.push({
      id: 'review-summary',
      label: open ? `${open} open review ${open === 1 ? 'item' : 'items'}` : 'Review items resolved',
      detail: `${comments.length} total · ${suggestions} ${suggestions === 1 ? 'suggestion' : 'suggestions'}`,
      tone: open ? 'var(--accent)' : 'var(--success)',
      time: 0,
    });
  }
  if (artifact?.publishedUrl) rows.push({ id: 'published-current', label: 'Published link', detail: artifact.publishedUrl, tone: 'var(--success)', time: 0 });
  if (artifact?.updated || artifact?.updatedAt || artifact?.updated_at) {
    const updatedAt = artifact.updatedAt || artifact.updated_at || artifact.updated;
    rows.push({ id: 'artifact-updated', label: 'Artifact updated', detail: artifact.updated || formatDate(updatedAt), tone: 'var(--accent)', time: Date.parse(updatedAt || '') || 0 });
  }
  if (artifact?.createdAt || artifact?.created_at) {
    const createdAt = artifact.createdAt || artifact.created_at;
    rows.push({ id: 'artifact-created', label: 'Artifact created', detail: formatDate(createdAt), tone: 'var(--ink-3)', time: Date.parse(createdAt || '') || 0 });
  }
  if (Array.isArray(versionsState?.versions) && versionsState.versions.length) {
    rows.push({
      id: 'version-summary',
      label: `${versionsState.versions.length} ${versionsState.versions.length === 1 ? 'saved version' : 'saved versions'}`,
      detail: 'Available in History',
      tone: 'var(--accent)',
      time: 0,
    });
  }
  rows.sort((a, b) => (b.time || 0) - (a.time || 0));

  if (!rows.length) {
    if (versionsLoading || collaborationLoading) {
      return (
        <EmptyState
          icon={Ico.list(14)}
          title="Loading activity..."
          detail="Saved versions, review updates, and publishing events are loading."
        />
      );
    }
    if (versionsError || collaborationError) {
      return (
        <EmptyState
          icon={Ico.list(14)}
          title="Activity could not be loaded."
          detail={versionsError || collaborationError || 'Try opening the artifact again.'}
        />
      );
    }
    return (
      <EmptyState
        icon={Ico.list(14)}
        title="No recent activity."
        detail="Review activity, saved versions, and publishing updates will appear here."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {notices.map((notice) => (
        <div key={notice} style={{
          border: '1px solid var(--line)',
          borderRadius: 8,
          background: 'var(--surface-2)',
          padding: '8px 10px',
          fontFamily: FONT_BODY,
          fontSize: 12.5,
          color: notice.includes('could not') ? 'var(--danger)' : 'var(--ink-3)',
          lineHeight: 1.35,
        }}>
          {notice}
        </div>
      ))}
      {rows.map((row, index) => (
        <div key={activityRowKey(row, index)} style={{
          display: 'grid',
          gridTemplateColumns: '20px minmax(0, 1fr)',
          gap: 10,
        }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: 99,
            marginTop: 6,
            justifySelf: 'center',
            background: row.tone || 'var(--accent)',
            boxShadow: row.tone === 'var(--success)' ? '0 0 8px var(--success-glow)' : '0 0 8px var(--accent-glow)',
          }} />
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>
              {row.label}
            </div>
            <div title={row.detail} style={{
              marginTop: 2,
              fontFamily: FONT_MONO,
              fontSize: 10.5,
              color: 'var(--ink-4)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {row.detail}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function findProjectForArtifact(projects, artifactPath) {
  if (!artifactPath) return null;
  const cleanPath = String(artifactPath).replace(/\\/g, '/');
  return [...(projects || [])]
    .filter((project) => {
      const projectPath = String(project?.path || '').replace(/\\/g, '/');
      return project?.id && projectPath && (cleanPath === projectPath || cleanPath.startsWith(`${projectPath}/`));
    })
    .sort((a, b) => String(b.path || '').length - String(a.path || '').length)[0] || null;
}

function hookEventLabel(events) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return 'All review updates';
  if (list.includes('*')) return 'All review updates';
  return list.map((event) => String(event).replace(/^artifact\./, '').replace(/_/g, ' ')).join(', ');
}

function deliveryStatusTone(status) {
  if (status === 'sent') return 'var(--success)';
  if (status === 'failed') return 'var(--danger)';
  if (status === 'skipped') return 'var(--ink-4)';
  return 'var(--accent)';
}

function deliveryStatusLabel(delivery) {
  const status = String(delivery?.status || 'queued');
  const event = String(delivery?.eventKey || delivery?.event_key || 'notification')
    .replace(/^artifact\./, '')
    .replace(/_/g, ' ');
  return `${status} · ${event}`;
}

function defaultHookDraft(kind = 'email', event = 'artifact.suggested') {
  return {
    kind,
    target: '',
    event,
    secret: '',
    smtpHost: '',
    smtpPort: '587',
    smtpFrom: '',
    smtpUsername: '',
    smtpStartTls: true,
  };
}

function hookTargetPlaceholder(kind) {
  if (kind === 'email') return 'team@company.com';
  return 'team@company.com';
}

function hookSecretPlaceholder(kind) {
  if (kind === 'email') return 'SMTP password';
  return 'SMTP password';
}

function ProjectCollaborationPanel({ active, artifact, projects }) {
  const artifactPath = versionPathOf(artifact);
  const explicitProjectId = artifact?.projectId || artifact?.project_id || artifact?.project?.id || '';
  const knownProjects = Array.isArray(projects) ? projects : [];
  const [state, setState] = useState({
    status: 'idle',
    projectId: explicitProjectId || '',
    collaborators: [],
    invitations: [],
    hooks: [],
    deliveries: [],
    collaboratorsAvailable: true,
    invitationsAvailable: true,
    hooksAvailable: true,
    deliveriesAvailable: true,
    error: '',
    message: '',
  });
  const [personDraft, setPersonDraft] = useState({ email: '', role: 'reviewer' });
  const [hookDraft, setHookDraft] = useState(defaultHookDraft());
  const [busy, setBusy] = useState('');
  const [showAdvancedDelivery, setShowAdvancedDelivery] = useState(false);

  const load = async () => {
    if (!active) return;
    setState((prev) => ({ ...prev, status: 'loading', error: '', message: '' }));
    try {
      let projectId = explicitProjectId;
      if (!projectId) {
        const projectHints = knownProjects.length ? knownProjects : await fetchProjects();
        projectId = findProjectForArtifact(projectHints, artifactPath)?.id || '';
      }
      if (!projectId) {
        setState({
          status: 'ready',
          projectId: '',
          collaborators: [],
          invitations: [],
          hooks: [],
          deliveries: [],
          collaboratorsAvailable: true,
          invitationsAvailable: true,
          hooksAvailable: true,
          deliveriesAvailable: true,
          error: '',
          message: '',
        });
        return;
      }
      const [people, invitations, hooks, deliveries] = await Promise.all([
        fetchProjectCollaborators(projectId),
        fetchProjectInvitations(projectId),
        fetchProjectNotificationHooks(projectId),
        fetchProjectNotificationDeliveries(projectId),
      ]);
      const collaboratorsAvailable = people?.available !== false;
      const invitationsAvailable = invitations?.available !== false;
      const hooksAvailable = hooks?.available !== false;
      const deliveriesAvailable = deliveries?.available !== false;
      setState({
        status: 'ready',
        projectId,
        collaborators: collaboratorsAvailable ? (people?.collaborators || []) : [],
        invitations: invitationsAvailable ? (invitations?.invitations || []) : [],
        hooks: hooksAvailable ? (hooks?.hooks || []) : [],
        deliveries: deliveriesAvailable ? (deliveries?.deliveries || []) : [],
        collaboratorsAvailable,
        invitationsAvailable,
        hooksAvailable,
        deliveriesAvailable,
        error: '',
        message: '',
      });
    } catch (err) {
      setState((prev) => ({ ...prev, status: 'error', error: err?.message || 'Collaboration settings could not be loaded.' }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!active) return undefined;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => { cancelled = true; };
  }, [active, explicitProjectId, artifactPath, projects]);

  if (!active) return null;

  const addPerson = async () => {
    const email = personDraft.email.trim();
    if (!state.projectId || !email || busy) return;
    setBusy('person');
    try {
      const result = await inviteProjectCollaborator(state.projectId, { email, role: personDraft.role });
      setPersonDraft({ email: '', role: 'reviewer' });
      await load();
      setState((prev) => ({
        ...prev,
        message: result?.fallbackCollaborator ? 'Access added.' : 'Invitation created.',
        error: '',
      }));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Invitation could not be created.' }));
    } finally {
      setBusy('');
    }
  };

  const updatePersonRole = async (person, role) => {
    if (!state.projectId || !person?.id || busy) return;
    setBusy(`person:${person.id}`);
    try {
      await updateProjectCollaborator(state.projectId, person.id, { role });
      await load();
      setState((prev) => ({ ...prev, message: 'Role updated.', error: '' }));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Role could not be updated.' }));
    } finally {
      setBusy('');
    }
  };

  const removePerson = async (person) => {
    if (!state.projectId || !person?.id || busy) return;
    setBusy(`remove-person:${person.id}`);
    try {
      await deleteProjectCollaborator(state.projectId, person.id);
      await load();
      setState((prev) => ({ ...prev, message: 'Collaborator removed.', error: '' }));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Collaborator could not be removed.' }));
    } finally {
      setBusy('');
    }
  };

  const resendInvitation = async (invitation) => {
    if (!state.projectId || !invitation?.id || busy) return;
    setBusy(`invite:${invitation.id}`);
    try {
      await resendProjectInvitation(state.projectId, invitation.id);
      await load();
      setState((prev) => ({ ...prev, message: 'Invitation resent.', error: '' }));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Invitation could not be resent.' }));
    } finally {
      setBusy('');
    }
  };

  const revokeInvitation = async (invitation) => {
    if (!state.projectId || !invitation?.id || busy) return;
    setBusy(`revoke-invite:${invitation.id}`);
    try {
      await revokeProjectInvitation(state.projectId, invitation.id);
      await load();
      setState((prev) => ({ ...prev, message: 'Invitation revoked.', error: '' }));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Invitation could not be revoked.' }));
    } finally {
      setBusy('');
    }
  };

  const addHook = async () => {
    const target = hookDraft.target.trim();
    const secret = hookDraft.secret.trim();
    const smtpHost = hookDraft.smtpHost.trim();
    const smtpPort = hookDraft.smtpPort.trim();
    const smtpFrom = hookDraft.smtpFrom.trim();
    const smtpUsername = hookDraft.smtpUsername.trim();
    const missingConnection = !smtpHost || !smtpFrom;
    if (!state.projectId || !target || missingConnection || busy) return;
    setBusy('hook');
    try {
      const body = {
        kind: 'email',
        target,
        events: [hookDraft.event],
      };
      if (secret) body.secret = secret;
      body.config = {
        smtpHost,
        smtpPort: smtpPort ? Number(smtpPort) : 587,
        from: smtpFrom,
        smtpUsername,
        smtpStartTls: !!hookDraft.smtpStartTls,
      };
      await createProjectNotificationHook(state.projectId, body);
      setHookDraft(defaultHookDraft());
      await load();
      setState((prev) => ({ ...prev, message: 'Notification added.' }));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Notification could not be added.' }));
    } finally {
      setBusy('');
    }
  };

  const setHookEnabled = async (hook, enabled) => {
    if (!state.projectId || !hook?.id || busy) return;
    setBusy(`hook:${hook.id}`);
    try {
      await updateProjectNotificationHook(state.projectId, hook.id, { enabled });
      await load();
      setState((prev) => ({ ...prev, message: enabled ? 'Notification enabled.' : 'Notification disabled.', error: '' }));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Notification could not be updated.' }));
    } finally {
      setBusy('');
    }
  };

  const removeHook = async (hook) => {
    if (!state.projectId || !hook?.id || busy) return;
    setBusy(`remove-hook:${hook.id}`);
    try {
      await deleteProjectNotificationHook(state.projectId, hook.id);
      await load();
      setState((prev) => ({ ...prev, message: 'Notification removed.', error: '' }));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Notification could not be removed.' }));
    } finally {
      setBusy('');
    }
  };

  const testHook = async (hook) => {
    if (!state.projectId || !hook?.id || busy) return;
    setBusy(`test:${hook.id}`);
    try {
      const result = await testProjectNotificationHook(state.projectId, hook.id);
      const delivery = result?.delivery || {};
      const status = String(delivery.status || '').toLowerCase();
      await load();
      const message = status === 'sent'
        ? 'Test sent.'
        : status === 'failed' || status === 'exhausted'
          ? `Test failed${delivery.error ? `: ${delivery.error}` : '.'}`
          : status === 'queued'
            ? 'Test queued for delivery.'
            : 'Test completed.';
      setState((prev) => ({ ...prev, message, error: status === 'failed' || status === 'exhausted' ? message : '' }));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Test could not be sent.' }));
    } finally {
      setBusy('');
    }
  };

  const retryDelivery = async (delivery) => {
    if (!state.projectId || !delivery?.id || busy) return;
    setBusy(`retry:${delivery.id}`);
    try {
      await retryProjectNotificationDelivery(state.projectId, delivery.id);
      await load();
      setState((prev) => ({ ...prev, message: 'Retry queued.', error: '' }));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || 'Retry could not be queued.' }));
    } finally {
      setBusy('');
    }
  };

  const fieldStyle = {
    height: 30,
    minWidth: 0,
    borderRadius: 8,
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--ink-2)',
    fontFamily: FONT_BODY,
    fontSize: 12.5,
    padding: '0 8px',
    outline: 0,
  };
  const smallFieldStyle = { ...fieldStyle, height: 28, fontSize: 12 };
  const hookMissingConnection = !hookDraft.smtpHost.trim() || !hookDraft.smtpFrom.trim();
  const canAddHook = !!(hookDraft.target.trim() && !hookMissingConnection && busy !== 'hook');
  const collaborationUnavailable = state.status !== 'loading' && !state.projectId;
  const pendingInvitations = (state.invitations || []).filter((invite) => String(invite?.status || 'pending') === 'pending');

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {state.status === 'loading' ? (
        <EmptyLine>Loading collaboration...</EmptyLine>
      ) : collaborationUnavailable ? (
        <EmptyState
          title="Project collaboration unavailable"
          detail="This artifact is not linked to a project, so reviewers, roles, and email hooks cannot be managed here."
        >
          <button
            type="button"
            className="btn-secondary"
            onClick={load}
            style={{ height: 30, padding: '0 10px', width: 'fit-content' }}
          >
            Check again
          </button>
          {state.error && (
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--danger)', lineHeight: 1.4 }}>
              {state.error}
            </div>
          )}
        </EmptyState>
      ) : (
        <>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: 'var(--ink-4)' }}>Invite people</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px auto', gap: 6 }}>
              <input
                value={personDraft.email}
                onChange={(e) => setPersonDraft((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="teammate@company.com"
                style={fieldStyle}
              />
              <select
                value={personDraft.role}
                onChange={(e) => setPersonDraft((prev) => ({ ...prev, role: e.target.value }))}
                style={fieldStyle}
              >
                <option value="reviewer">Reviewer</option>
                <option value="editor">Editor</option>
                <option value="commenter">Commenter</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="button"
                className="btn-secondary"
                onClick={addPerson}
                disabled={!personDraft.email.trim() || busy === 'person'}
                style={{ height: 30, padding: '0 9px' }}
              >
                {busy === 'person' ? 'Inviting...' : 'Invite'}
              </button>
            </div>
            {state.collaboratorsAvailable === false ? (
              <EmptyState
                title="People are not available here."
                detail="This server does not expose project collaborator management for this artifact."
              />
            ) : state.collaborators.length ? (
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                {state.collaborators.map((person) => (
                  <div key={person.id || person.email} style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) 112px auto',
                    gap: 8,
                    alignItems: 'center',
                    padding: '8px 9px',
                    borderTop: '1px solid var(--line)',
                    marginTop: -1,
                    background: 'var(--surface)',
                  }}>
                    <div title={person.email} style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontFamily: FONT_BODY,
                      fontSize: 12.5,
                      color: 'var(--ink)',
                      fontWeight: 600,
                    }}>
                      {person.displayName || person.email}
                    </div>
                    <select
                      value={person.role || 'viewer'}
                      onChange={(e) => updatePersonRole(person, e.target.value)}
                      disabled={busy === `person:${person.id}` || busy === `remove-person:${person.id}`}
                      style={smallFieldStyle}
                    >
                      <option value="owner">Owner</option>
                      <option value="editor">Editor</option>
                      <option value="reviewer">Reviewer</option>
                      <option value="commenter">Commenter</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => removePerson(person)}
                      disabled={busy === `remove-person:${person.id}`}
                      style={{ height: 28, padding: '0 8px' }}
                    >
                      {busy === `remove-person:${person.id}` ? 'Removing...' : 'Remove'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine>No active collaborators yet.</EmptyLine>
            )}
            {state.invitationsAvailable === false ? (
              <EmptyLine>Pending invitation tracking is not available on this server.</EmptyLine>
            ) : pendingInvitations.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)' }}>Pending invitations</div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                  {pendingInvitations.map((invitation) => (
                    <div key={invitation.id || invitation.email} style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      gap: 8,
                      alignItems: 'center',
                      padding: '8px 9px',
                      borderTop: '1px solid var(--line)',
                      marginTop: -1,
                      background: 'var(--surface)',
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div title={invitation.email} style={{
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontFamily: FONT_BODY,
                          fontSize: 12.5,
                          color: 'var(--ink)',
                          fontWeight: 600,
                        }}>
                          {invitation.displayName || invitation.email}
                        </div>
                        <div style={{
                          marginTop: 2,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontFamily: FONT_MONO,
                          fontSize: 10.5,
                          color: 'var(--ink-4)',
                        }}>
                          {(invitation.role || 'viewer').replace(/^./, (ch) => ch.toUpperCase())}
                          {invitation.expiresAt ? ` - expires ${formatDate(invitation.expiresAt)}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => resendInvitation(invitation)}
                          disabled={busy === `invite:${invitation.id}` || busy === `revoke-invite:${invitation.id}`}
                          style={{ height: 28, padding: '0 8px' }}
                        >
                          {busy === `invite:${invitation.id}` ? 'Sending...' : 'Resend'}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => revokeInvitation(invitation)}
                          disabled={busy === `revoke-invite:${invitation.id}`}
                          style={{ height: 28, padding: '0 8px' }}
                        >
                          {busy === `revoke-invite:${invitation.id}` ? 'Revoking...' : 'Revoke'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              onClick={() => setShowAdvancedDelivery((value) => !value)}
              style={{
                minHeight: 32,
                borderRadius: 8,
                border: '1px solid var(--line)',
                background: showAdvancedDelivery ? 'var(--surface)' : 'var(--surface-2)',
                color: 'var(--ink-3)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '6px 9px',
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              <span>Advanced email delivery</span>
              <span style={{ display: 'inline-flex', color: 'var(--ink-4)' }}>
                {showAdvancedDelivery ? Ico.chevronUp?.(12) || Ico.close(12) : Ico.chevronDown?.(12) || Ico.chevronRight?.(12)}
              </span>
            </button>
            {showAdvancedDelivery && (state.hooksAvailable === false ? (
              <EmptyState
                icon={Ico.mail?.(14) || Ico.chats(14)}
                title="Email notifications are not available on this server."
                detail="Comments and review requests still work here, but this server does not expose notification hook management."
              />
            ) : (
              <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 130px auto', gap: 6 }}>
              <input
                value={hookDraft.target}
                onChange={(e) => setHookDraft((prev) => ({ ...prev, target: e.target.value }))}
                placeholder={hookTargetPlaceholder(hookDraft.kind)}
                style={fieldStyle}
              />
              <select
                value={hookDraft.event}
                onChange={(e) => setHookDraft((prev) => ({ ...prev, event: e.target.value }))}
                style={fieldStyle}
              >
                <option value="artifact.suggested">Suggestions</option>
                <option value="artifact.commented">Comments</option>
                <option value="artifact.review_requested">Review requests</option>
                <option value="*">All updates</option>
              </select>
              <button
                type="button"
                className="btn-secondary"
                onClick={addHook}
                disabled={!canAddHook}
                style={{ height: 30, padding: '0 9px' }}
              >
                {busy === 'hook' ? 'Adding...' : 'Add'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) 74px minmax(0, 1fr)', gap: 6 }}>
                <input
                  value={hookDraft.smtpHost}
                  onChange={(e) => setHookDraft((prev) => ({ ...prev, smtpHost: e.target.value }))}
                  placeholder="SMTP host"
                  title="SMTP host"
                  style={smallFieldStyle}
                />
                <input
                  value={hookDraft.smtpPort}
                  onChange={(e) => setHookDraft((prev) => ({ ...prev, smtpPort: e.target.value.replace(/[^0-9]/g, '') }))}
                  placeholder="587"
                  title="SMTP port"
                  inputMode="numeric"
                  style={smallFieldStyle}
                />
                <input
                  value={hookDraft.smtpFrom}
                  onChange={(e) => setHookDraft((prev) => ({ ...prev, smtpFrom: e.target.value }))}
                  placeholder="from@company.com"
                  title="From address"
                  style={smallFieldStyle}
                />
                <input
                  value={hookDraft.smtpUsername}
                  onChange={(e) => setHookDraft((prev) => ({ ...prev, smtpUsername: e.target.value }))}
                  placeholder="SMTP username"
                  title="SMTP username"
                  style={smallFieldStyle}
                />
                <input
                  type="password"
                  value={hookDraft.secret}
                  onChange={(e) => setHookDraft((prev) => ({ ...prev, secret: e.target.value }))}
                  placeholder={hookSecretPlaceholder(hookDraft.kind)}
                  title="SMTP password"
                  style={smallFieldStyle}
                />
                <label style={{
                  minWidth: 0,
                  minHeight: 28,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 8px',
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                  color: 'var(--ink-3)',
                  fontFamily: FONT_BODY,
                  fontSize: 12,
                }}>
                  <input
                    type="checkbox"
                    checked={hookDraft.smtpStartTls}
                    onChange={(e) => setHookDraft((prev) => ({ ...prev, smtpStartTls: e.target.checked }))}
                    style={{ margin: 0 }}
                  />
                  StartTLS
                </label>
              </div>
            {state.hooks.length ? (
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                {state.hooks.map((hook) => (
                    <div key={hook.id} style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: 8,
                    padding: '8px 9px',
                    borderTop: '1px solid var(--line)',
                    marginTop: -1,
                    background: hook.enabled === false ? 'var(--surface-2)' : 'var(--surface)',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div title={hook.target} style={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: FONT_BODY,
                        fontSize: 12.5,
                        color: 'var(--ink)',
                        fontWeight: 600,
                      }}>
                        {(hook.kind || 'hook').toUpperCase()} · {hook.target}
                      </div>
                      <div title={hookEventLabel(hook.events)} style={{
                        marginTop: 2,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: FONT_MONO,
                        fontSize: 10.5,
                        color: 'var(--ink-4)',
                      }}>
                        {hookEventLabel(hook.events)}
                      </div>
                    </div>
                    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => testHook(hook)}
                        disabled={busy === `test:${hook.id}`}
                        style={{ height: 28, padding: '0 8px' }}
                      >
                        {busy === `test:${hook.id}` ? 'Testing...' : 'Test'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setHookEnabled(hook, hook.enabled === false)}
                        disabled={busy === `hook:${hook.id}`}
                        style={{ height: 28, padding: '0 8px' }}
                      >
                        {hook.enabled === false ? 'Enable' : 'Disable'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => removeHook(hook)}
                        disabled={busy === `remove-hook:${hook.id}`}
                        style={{ height: 28, padding: '0 8px' }}
                      >
                        {busy === `remove-hook:${hook.id}` ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine>No notifications yet.</EmptyLine>
            )}
              </>
            ))}
          </section>

          {showAdvancedDelivery && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: 'var(--ink-4)' }}>Delivery status</div>
            {state.deliveriesAvailable === false ? (
              <EmptyLine>Notification delivery status is not available on this server.</EmptyLine>
            ) : state.deliveries.length ? (
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                {state.deliveries.slice(0, 8).map((delivery) => {
                  const status = String(delivery.status || 'queued');
                  const detail = delivery.error
                    || delivery.details?.hookTarget
                    || delivery.details?.target
                    || formatDate(delivery.modifiedAt || delivery.modified_at || delivery.createdAt || delivery.created_at);
                  return (
                    <div key={delivery.id} style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      gap: 8,
                      padding: '8px 9px',
                      borderTop: '1px solid var(--line)',
                      marginTop: -1,
                      background: 'var(--surface)',
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div title={deliveryStatusLabel(delivery)} style={{
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontFamily: FONT_BODY,
                          fontSize: 12.5,
                          color: 'var(--ink)',
                          fontWeight: 600,
                        }}>
                          {deliveryStatusLabel(delivery)}
                        </div>
                        <div title={detail} style={{
                          marginTop: 2,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontFamily: FONT_MONO,
                          fontSize: 10.5,
                          color: delivery.error ? 'var(--danger)' : 'var(--ink-4)',
                        }}>
                          {detail}
                        </div>
                      </div>
                      {status === 'failed' ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => retryDelivery(delivery)}
                          disabled={busy === `retry:${delivery.id}`}
                          style={{ height: 28, padding: '0 8px' }}
                        >
                          {busy === `retry:${delivery.id}` ? 'Retrying...' : 'Retry'}
                        </button>
                      ) : (
                        <span style={{
                          ...statusStyles(true, status === 'failed'),
                          color: deliveryStatusTone(status),
                          borderColor: 'var(--line)',
                          background: 'var(--surface-2)',
                        }}>
                          {status}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyLine>No deliveries yet.</EmptyLine>
            )}
          </section>
          )}
          {(state.error || state.message) && (
            <div style={{
              fontFamily: FONT_BODY,
              fontSize: 12.5,
              color: state.error ? 'var(--danger)' : 'var(--success)',
              lineHeight: 1.4,
            }}>
              {state.error || state.message}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ShareTab({
  active,
  artifact,
  onPublish,
  onUnpublish,
  projects,
  historyState,
  collaborationState,
  onComparePublished,
}) {
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState('');
  const [shareHistoryState, setShareHistoryState] = useState({ versions: [] });
  const artifactPath = versionPathOf(artifact);

  useEffect(() => {
    if (!active || !artifactPath) return undefined;
    let cancelled = false;
    fetchArtifactVersions(artifactPath)
      .then((data) => {
        if (cancelled) return;
        setShareHistoryState(data?.available === false ? { versions: [] } : (data || { versions: [] }));
      })
      .catch(() => {
        if (!cancelled) setShareHistoryState({ versions: [] });
      });
    return () => { cancelled = true; };
  }, [active, artifactPath]);

  if (!active) return null;

  const published = artifact?.publishedUrl || '';
  const publishedVersionId = artifact?.publishedVersionId || artifact?.published_version_id || '';
  const privateUrl = artifactServeUrl(artifact);
  const publishedVersion = artifact?.publishedVersionNumber
    ? `Version ${artifact.publishedVersionNumber}`
    : publishedVersionId
      ? `Version ${String(publishedVersionId).slice(0, 8)}`
      : '';
  const effectiveHistoryState = Array.isArray(historyState?.versions) && historyState.versions.length
    ? historyState
    : shareHistoryState;
  const versions = Array.isArray(effectiveHistoryState?.versions)
    ? effectiveHistoryState.versions.map((item, index) => normalizeVersion(item, index, effectiveHistoryState || {}))
    : [];
  const publishedVersionItem = publishedVersionId
    ? versions.find((version) => version.id === String(publishedVersionId))
    : null;
  const latestVersion = versions.find((version) => version.latest)
    || versions.find((version) => version.current)
    || versions[0]
    || null;
  const draftDiffersFromPublic = !!(
    published
    && publishedVersionId
    && latestVersion?.id
    && latestVersion.id !== String(publishedVersionId)
  );
  const reviewSummary = (collaborationState?.comments || []).length
    ? reviewSummaryFromComments(collaborationState.comments)
    : {
      open: Number(artifact?.reviewSummary?.open || artifact?.review_summary?.open || 0),
      suggestions: Number(artifact?.reviewSummary?.suggestions || artifact?.review_summary?.suggestions || 0),
      reviewRequests: Number(
        artifact?.reviewSummary?.reviewRequests
        || artifact?.reviewSummary?.review_requests
        || artifact?.review_summary?.reviewRequests
        || artifact?.review_summary?.review_requests
        || 0
      ),
    };
  const openReviewCount = Number(reviewSummary.open || 0);
  const suggestionCount = Number(reviewSummary.suggestions || 0);
  const reviewRequestCount = Number(reviewSummary.reviewRequests || 0);

  const copy = async (kind, value) => {
    if (!value) return;
    const ok = await copyText(value);
    if (ok) {
      setCopied(kind);
      setTimeout(() => setCopied(''), 1400);
    }
  };

  const publish = async () => {
    if (!onPublish || busy) return;
    setBusy('publish');
    try {
      await onPublish(artifact);
    } finally {
      setBusy('');
    }
  };

  const unpublish = async () => {
    if (!onUnpublish || busy) return;
    setBusy('unpublish');
    try {
      await onUnpublish(artifact);
    } finally {
      setBusy('');
    }
  };

  const ShareRow = ({ label, value, kind }) => (
    <div style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)', marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div title={value} style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: value ? 'var(--ink-2)' : 'var(--ink-4)',
        }}>
          {value || 'Not available'}
        </div>
        <IconButton title={copied === kind ? 'Copied' : `Copy ${label}`} onClick={() => copy(kind, value)} disabled={!value}>
          {copied === kind ? Ico.check(12) : Ico.copy(12)}
        </IconButton>
      </div>
    </div>
  );

  const SafetyCard = () => {
    const rows = [
      published
        ? {
          label: draftDiffersFromPublic ? 'Public link is behind this draft' : 'Public link is pinned',
          detail: draftDiffersFromPublic
            ? `${publishedVersion || 'Pinned version'} is live; ${latestVersion?.label || 'the current draft'} has newer changes.`
            : `${publishedVersion || 'A saved version'} is live. Republish only when you want to replace the public copy.`,
          tone: draftDiffersFromPublic ? 'warning' : 'ok',
        }
        : {
          label: 'Ready to publish a versioned copy',
          detail: 'Cowork will publish a saved snapshot, not a moving local folder.',
          tone: 'ok',
        },
      openReviewCount > 0
        ? {
          label: 'Open review items',
          detail: [
            openReviewCount ? countLabel(openReviewCount, 'open note') : '',
            suggestionCount ? countLabel(suggestionCount, 'suggested change') : '',
            reviewRequestCount ? countLabel(reviewRequestCount, 'review request') : '',
          ].filter(Boolean).join(' · '),
          tone: 'warning',
        }
        : {
          label: 'No open review items',
          detail: 'Review notes and suggestions are resolved.',
          tone: 'ok',
        },
    ];
    return (
      <div style={{
        marginBottom: 12,
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: 'var(--surface-2)',
        overflow: 'hidden',
      }}>
        {rows.map((row) => (
          <div key={row.label} style={{
            display: 'grid',
            gridTemplateColumns: '14px minmax(0, 1fr)',
            gap: 8,
            padding: '9px 10px',
            borderTop: '1px solid var(--line)',
            marginTop: -1,
          }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              marginTop: 5,
              background: row.tone === 'warning' ? 'var(--warning, #f59e0b)' : 'var(--success)',
            }} />
            <span style={{ minWidth: 0 }}>
              <span style={{
                display: 'block',
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--ink)',
              }}>
                {row.label}
              </span>
              <span style={{
                display: 'block',
                marginTop: 2,
                fontFamily: FONT_BODY,
                fontSize: 12,
                color: 'var(--ink-3)',
                lineHeight: 1.35,
              }}>
                {row.detail}
              </span>
            </span>
          </div>
        ))}
        {draftDiffersFromPublic && publishedVersionItem && onComparePublished && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onComparePublished(publishedVersionItem)}
            style={{ width: 'calc(100% - 20px)', margin: '0 10px 10px', height: 30 }}
          >
            Compare public version to draft
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <SafetyCard />
      <ShareRow label="Public link" value={published} kind="public" />
      {published && (
        <ShareRow label="Published version" value={publishedVersion || 'Pinned version'} kind="published-version" />
      )}
      <ShareRow label="Private preview link" value={privateUrl} kind="private" />
      <ShareRow label="Workspace file" value={artifact?.path || ''} kind="path" />
      {published && (onPublish || onUnpublish) && (
        <div style={{ display: 'grid', gridTemplateColumns: onPublish && onUnpublish ? '1fr 1fr' : '1fr', gap: 8, marginTop: 14 }}>
          {onPublish && (
            <button
              type="button"
              className="btn primary"
              onClick={publish}
              disabled={!!busy}
              style={{ width: '100%' }}
            >
              {Ico.upload(13)}
              <span>{busy === 'publish' ? 'Updating...' : 'Update public copy'}</span>
            </button>
          )}
          {onUnpublish && (
            <button
              type="button"
              className="btn-secondary"
              onClick={unpublish}
              disabled={!!busy}
              style={{ width: '100%' }}
            >
              {Ico.close(13)}
              <span>{busy === 'unpublish' ? 'Unpublishing...' : 'Unpublish'}</span>
            </button>
          )}
        </div>
      )}
      {!published && onPublish && (
        <button
          type="button"
          className="btn primary"
          onClick={publish}
          disabled={!!busy}
          style={{ marginTop: 14, width: '100%' }}
        >
          {Ico.upload(13)}
          <span>{busy === 'publish' ? 'Publishing...' : 'Publish'}</span>
        </button>
      )}
      <ProjectCollaborationPanel active={active} artifact={artifact} projects={projects} />
    </div>
  );
}

function PreviewPane({
  artifact,
  actionPath,
  isBrokenPreview,
  previewVersion,
  onClearPreview,
  onPreviewFailed,
  onRestoreLastGood,
  restoreLastGoodBusy,
}) {
  const [state, setState] = useState({ loading: false, error: '', url: '', text: null, backendPort: null });
  const openNonceRef = useRef(0);
  const isText = isTextArtifact(artifact);
  const textExt = isText ? ((artifact?.ext || '').toLowerCase() || extOfPath(actionPath)) : '';
  const isBackendArtifact = BACKEND_ARTIFACT_TYPES.has(artifact?.type);
  const previewVersionId = previewVersion?.id || '';
  const showingSavedVersion = !!previewVersionId;

  const lastGoodPath = artifact?.lastGoodPath
    || artifact?.last_good_path
    || artifact?.lastGood?.path
    || artifact?.last_good?.path
    || '';
  const lastGoodVersionId = artifact?.lastKnownGoodVersionId
    || artifact?.last_known_good_version_id
    || artifact?.lastGoodVersionId
    || artifact?.last_good_version_id
    || artifact?.lastGoodVersion
    || artifact?.last_good_version
    || artifact?.lastGood?.versionId
    || artifact?.last_good?.version_id
    || '';
  const canUseLastGoodPath = isPreviewablePathForArtifact(lastGoodPath, { isText, isBackendArtifact });
  const showingLastGood = !showingSavedVersion && isBrokenPreview && (!!lastGoodVersionId || canUseLastGoodPath);
  const previewPath = showingSavedVersion || lastGoodVersionId ? actionPath : (showingLastGood ? lastGoodPath : actionPath);
  const previewRequestVersionId = previewVersionId || (showingLastGood && lastGoodVersionId ? lastGoodVersionId : '');

  useEffect(() => {
    if (!previewPath) {
      setState({ loading: false, error: 'This artifact does not have a previewable file yet.', url: '', text: null, backendPort: null });
      return undefined;
    }

    let cancelled = false;
    setState({ loading: true, error: '', url: '', text: null, backendPort: null });
    if (isText) {
      previewArtifact(previewPath, { versionId: previewRequestVersionId })
        .then((data) => {
          if (cancelled) return;
          if (!data || typeof data.content !== 'string') throw new Error('Preview returned no content');
          setState({
            loading: false,
            error: '',
            url: '',
            backendPort: null,
            text: {
              content: data.content,
              truncated: !!data.truncated,
              mime: data.mime || '',
            },
          });
        })
        .catch((err) => {
          if (cancelled) return;
          onPreviewFailed?.(true);
          setState({ loading: false, error: err?.message || 'Could not load preview.', url: '', text: null, backendPort: null });
        });
      return () => { cancelled = true; };
    }

    const cacheVersion = previewRequestVersionId || artifact?.mtime || (openNonceRef.current += 1);
    mountArtifactPreview(previewPath, { versionId: previewRequestVersionId })
      .then(({ kind, url, artifactDir, port, proxyUrl, backendRunning, launchError }) => {
        if (cancelled) return;
        if (kind === 'proxy') {
          if (!artifactDir) throw new Error('Preview workspace could not be opened.');
          if (backendRunning === false) throw new Error(launchError || 'Backend failed to start');
          if (!proxyUrl) throw new Error('Preview workspace could not be opened.');
          let iframeUrl = proxyUrl;
          try {
            const u = new URL(proxyUrl);
            if (window.location?.protocol) u.protocol = window.location.protocol;
            if (window.location?.hostname) u.hostname = window.location.hostname;
            iframeUrl = u.toString();
          } catch {}
          setState({
            loading: false,
            error: '',
            url: withVersion(iframeUrl, cacheVersion),
            text: null,
            backendPort: typeof port === 'number' ? port : null,
          });
          return;
        }
        if (!url) throw new Error('Preview link was not created.');
        setState({
          loading: false,
          error: '',
          url: withVersion(url, cacheVersion),
          text: null,
          backendPort: isBackendArtifact && typeof port === 'number' ? port : null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        onPreviewFailed?.(true);
        setState({ loading: false, error: err?.message || 'Could not load artifact.', url: '', text: null, backendPort: null });
      });
    return () => { cancelled = true; };
  }, [previewPath, previewRequestVersionId, isText, artifact?.mtime, artifact?.path, onPreviewFailed, isBackendArtifact]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-2)' }}>
      {showingSavedVersion && (
        <div style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 14px',
          borderBottom: '1px solid color-mix(in srgb, var(--accent) 25%, var(--line))',
          background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
          color: 'var(--ink-2)',
          fontFamily: FONT_BODY,
          fontSize: 12.5,
          fontWeight: 600,
        }}>
          <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--accent)' }}>{Ico.clock(13)}</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Previewing {previewVersion?.label || 'saved version'}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClearPreview}
            style={{ height: 26, padding: '0 8px', marginLeft: 'auto', flexShrink: 0 }}
          >
            Current draft
          </button>
        </div>
      )}
      {isBrokenPreview && (
        <div style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 14px',
          borderBottom: '1px solid color-mix(in srgb, var(--danger) 25%, var(--line))',
          background: 'color-mix(in srgb, var(--danger) 10%, var(--surface))',
          color: 'var(--danger)',
          fontFamily: FONT_BODY,
          fontSize: 12.5,
          fontWeight: 600,
        }}>
          <span style={{ display: 'inline-flex', flexShrink: 0 }}>{Ico.refresh(13)}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {showingLastGood
              ? 'Showing last good version. New draft failed to preview.'
              : 'Draft preview was marked as broken; showing the current preview.'}
          </span>
          {showingLastGood && lastGoodVersionId && onRestoreLastGood && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onRestoreLastGood}
              disabled={restoreLastGoodBusy}
              style={{ height: 26, padding: '0 8px', flexShrink: 0 }}
              title="Restore this last good version and save the broken draft first"
            >
              {restoreLastGoodBusy ? 'Restoring...' : 'Restore last good'}
            </button>
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: isText ? 'auto' : 'hidden' }}>
        {state.error ? (
          <div style={{ padding: 24, color: 'var(--danger)', fontFamily: FONT_BODY, fontSize: 13 }}>
            {state.error}
          </div>
        ) : state.loading ? (
          <div style={{ padding: 24, color: 'var(--ink-3)', fontFamily: FONT_BODY, fontSize: 13 }}>
            Loading preview...
          </div>
        ) : isText && state.text ? (
          <div style={{
            maxWidth: 920,
            margin: '0 auto',
            minHeight: '100%',
            padding: '24px 28px',
            background: 'var(--surface)',
          }}>
            {textExt === '.md' ? (
              <MarkdownContent text={state.text.content} id={artifact?.path || previewPath} />
            ) : (
              <pre style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: FONT_MONO,
                fontSize: 12.5,
                color: 'var(--ink-2)',
                lineHeight: 1.55,
              }}>
                {state.text.content}
              </pre>
            )}
            {state.text.truncated && (
              <div style={{
                marginTop: 18,
                padding: '9px 12px',
                borderRadius: 8,
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
                color: 'var(--ink-3)',
                fontFamily: FONT_BODY,
                fontSize: 12.5,
              }}>
                Preview is truncated.
              </div>
            )}
          </div>
        ) : state.url ? (
          <iframe
            title={artifact?.title || 'Artifact preview'}
            src={state.url}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
            style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
          />
        ) : null}
      </div>
    </div>
  );
}

function LegacyArtifactWorkspace({ open, artifact, projects, onClose, onChange, onPublish, onUnpublish, onForked, onHandoff }) {
  const [activeTab, setActiveTab] = useState('comments');
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(null);
  const [compareRequest, setCompareRequest] = useState(null);
  const [historyMeta, setHistoryMeta] = useState({ versions: [], status: 'idle', error: '' });
  const [collaborationMeta, setCollaborationMeta] = useState({ comments: [], activity: [], status: 'idle', error: '' });
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  const [lastGoodBusy, setLastGoodBusy] = useState(false);
  const [selectedReviewItem, setSelectedReviewItem] = useState(null);

  const actionPath = versionPathOf(artifact);
  const files = useMemo(() => normalizeFiles(artifact), [artifact]);
  const selectedReviewFile = anchorFileValue(selectedReviewItem?.anchor || '');
  const isBrokenPreview = inferBrokenPreview(artifact, previewFailed);
  const chips = statusChips(artifact, isBrokenPreview);
  const primaryTitle = artifact?.title || displayName(actionPath);
  const subtitle = artifact?.description || artifact?.kind || artifact?.type || displayName(actionPath);

  useEffect(() => {
    if (!open) return;
    setActiveTab('comments');
    setPreviewFailed(false);
    setPreviewVersion(null);
    setCompareRequest(null);
    setCollaborationMeta({ comments: [], activity: [], status: 'idle', error: '' });
    setHistoryMeta({ versions: [], status: 'idle', error: '' });
    setHandoffBusy(false);
    setHandoffError('');
    setLastGoodBusy(false);
    setSelectedReviewItem(null);
  }, [open, artifact?.path]);

  useEffect(() => {
    if (!open || !actionPath) return undefined;
    let cancelled = false;
    setHistoryMeta((prev) => ({ ...prev, status: 'loading', error: '' }));
    setCollaborationMeta((prev) => ({ ...prev, status: 'loading', error: '' }));
    fetchArtifactVersions(actionPath)
      .then((data) => {
        if (cancelled) return;
        setHistoryMeta(data?.available === false
          ? { versions: [], status: 'unavailable', error: '' }
          : { ...(data || { versions: [] }), status: 'ready', error: '' });
      })
      .catch((err) => {
        if (!cancelled) setHistoryMeta({ versions: [], status: 'error', error: err?.message || 'Version history could not be loaded.' });
      });
    fetchArtifactComments(actionPath)
      .then((data) => {
        if (cancelled) return;
        const available = data?.available !== false;
        setCollaborationMeta({
          ...(available ? data : {}),
          comments: available ? (data?.comments || []) : [],
          activity: available ? (data?.activity || []) : [],
          status: available ? 'ready' : 'unavailable',
          error: '',
        });
      })
      .catch((err) => {
        if (!cancelled) setCollaborationMeta({ comments: [], activity: [], status: 'error', error: err?.message || 'Review activity could not be loaded.' });
      });
    return () => { cancelled = true; };
  }, [open, actionPath]);

  if (!open || !artifact) return null;

  const onRestored = (result, version) => {
    setPreviewVersion(null);
    setCompareRequest(null);
    onChange?.({
      ...artifact,
      restoredVersionId: version?.id,
      mtime: Date.now(),
      ...(result?.artifact || {}),
    });
  };

  const onReviewChanged = (result) => {
    setPreviewFailed(false);
    onChange?.({
      ...artifact,
      reviewVersionId: result?.version?.id || artifact?.reviewVersionId,
      mtime: Date.now(),
      ...(result?.artifact || {}),
    });
  };

  const onReviewSummaryChanged = (reviewSummary) => {
    onChange?.({
      ...artifact,
      reviewSummary,
    });
  };

  const restoreLastGood = async () => {
    const lastGoodVersionId = artifact?.lastKnownGoodVersionId
      || artifact?.last_known_good_version_id
      || historyMeta?.lastKnownGoodVersionId
      || historyMeta?.last_known_good_version_id
      || '';
    if (!actionPath || !lastGoodVersionId || lastGoodBusy) return;
    const version = (historyMeta?.versions || []).find((item) => String(item?.id || item?.versionId) === String(lastGoodVersionId))
      || { id: lastGoodVersionId, label: 'last good version' };
    setLastGoodBusy(true);
    setHandoffError('');
    try {
      const result = await restoreArtifactVersion(actionPath, lastGoodVersionId, { createCheckpoint: true });
      setPreviewFailed(false);
      onRestored(result, version);
    } catch (err) {
      setHandoffError(err?.message || 'Could not restore the last good version.');
    } finally {
      setLastGoodBusy(false);
    }
  };

  const startTask = async (options = {}) => {
    if (!onHandoff || handoffBusy || !actionPath) return;
    setHandoffBusy(true);
    setHandoffError('');
    try {
      const result = await onHandoff(artifact, { path: actionPath, ...options });
      const conversationId = result?.conversationId || result?.conversation_id || result?.conversation?.id;
      if (!conversationId) {
        setHandoffError('Could not start a task for this artifact.');
      }
    } catch (err) {
      setHandoffError(err?.message || 'Could not start a task for this artifact.');
    } finally {
      setHandoffBusy(false);
    }
  };

  const previewSavedVersion = (version) => {
    if (!version?.id) return;
    setPreviewFailed(false);
    setPreviewVersion(version);
  };

  const publishSavedVersion = async (version) => {
    if (!onPublish || !version?.id) return;
    await onPublish(artifact, {
      versionId: version.id,
      versionLabel: version.label,
    });
  };

  const compareSavedVersion = (version) => {
    if (!version?.id) return;
    setCompareRequest({
      key: `${version.id}:${Date.now()}`,
      from: version.id,
      to: CURRENT_DRAFT_VALUE,
    });
    setActiveTab('changes');
  };

  const workspaceVersions = Array.isArray(historyMeta?.versions)
    ? historyMeta.versions.map((item, index) => normalizeVersion(item, index, historyMeta || {}))
    : [];
  const workspacePublishedVersionId = artifact?.publishedVersionId || artifact?.published_version_id || '';
  const workspacePublishedVersion = workspacePublishedVersionId
    ? workspaceVersions.find((version) => version.id === String(workspacePublishedVersionId))
    : null;
  const workspaceLatestVersion = workspaceVersions.find((version) => version.latest)
    || workspaceVersions.find((version) => version.current)
    || workspaceVersions[0]
    || null;
  const publicBehindDraft = !!(
    artifact?.publishedUrl
    && workspacePublishedVersionId
    && workspaceLatestVersion?.id
    && workspaceLatestVersion.id !== String(workspacePublishedVersionId)
  );
  const headerChips = publicBehindDraft
    ? [...chips, { id: 'public-behind-draft', label: 'Public behind draft', active: true, tone: 'warning' }]
    : chips;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      width="min(1480px, 98vw)"
      height="min(940px, 94vh)"
      labelledBy="artifact-workspace-title"
    >
      <div style={{
        flex: '0 0 auto',
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 1fr) auto auto auto',
        alignItems: 'center',
        gap: 14,
        padding: '12px 14px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
      }}>
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', color: 'var(--accent)', flexShrink: 0 }}>{Ico.doc(18)}</span>
          <div style={{ minWidth: 0 }}>
            <div
              id="artifact-workspace-title"
              title={primaryTitle}
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--ink)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                letterSpacing: 0,
              }}
            >
              {primaryTitle}
            </div>
            {subtitle && (
              <div title={subtitle} style={{
                marginTop: 1,
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                color: 'var(--ink-3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {subtitle}
              </div>
            )}
          </div>
        </div>
	        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
          flexWrap: 'wrap',
          maxWidth: 620,
	        }}>
		          {headerChips.map((chip) => {
                const dotColor = chip.active
                  ? chip.danger
                    ? 'var(--danger)'
                    : chip.tone === 'warning'
                      ? 'var(--warning, var(--accent))'
                      : 'var(--accent)'
                  : 'var(--ink-5)';
                return (
	            <span key={chip.id} style={statusStyles(chip.active, chip.danger, chip.tone)}>
	              <span style={{
	                width: 5,
	                height: 5,
	                borderRadius: 99,
	                background: dotColor,
	                flexShrink: 0,
	              }} />
	              {chip.label}
	            </span>
                );
              })}
		        </div>
	        <button
	          type="button"
	          className="btn-secondary"
	          onClick={() => startTask()}
	          disabled={!onHandoff || handoffBusy || !actionPath}
	          title="Start a follow-up task from this artifact"
	          style={{ height: 30, padding: '0 9px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
	        >
	          {Ico.chats(13)}
	          <span>{handoffBusy ? 'Starting...' : 'Follow-up task'}</span>
	        </button>
	        <IconButton title="Close" onClick={onClose}>
	          {Ico.close(13)}
	        </IconButton>
	      </div>

      {publicBehindDraft && (
        <div style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '8px 14px',
          borderBottom: '1px solid var(--line)',
          background: 'color-mix(in srgb, var(--warning, var(--accent)) 9%, var(--surface))',
          color: 'var(--ink)',
          fontFamily: FONT_BODY,
          fontSize: 12.5,
        }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Public link is showing an older saved version.
          </span>
          {workspacePublishedVersion && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => compareSavedVersion(workspacePublishedVersion)}
              style={{ height: 28, padding: '0 9px', flexShrink: 0 }}
            >
              Compare public to draft
            </button>
          )}
        </div>
      )}

      {handoffError && (
        <div style={{
          flex: '0 0 auto',
          padding: '8px 14px',
          borderBottom: '1px solid var(--line)',
          background: 'color-mix(in srgb, var(--danger) 9%, var(--surface))',
          color: 'var(--danger)',
          fontFamily: FONT_BODY,
          fontSize: 12.5,
        }}>
          {handoffError}
        </div>
      )}

      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 260px) minmax(360px, 1fr) minmax(300px, 348px)',
        background: 'var(--surface)',
      }}>
        <aside style={{
          minWidth: 0,
          borderRight: '1px solid var(--line)',
          background: 'var(--surface)',
          overflowY: 'auto',
        }}>
          <RailSection title="About">
            <div style={{
              border: '1px solid var(--line)',
              borderRadius: 8,
              background: 'var(--surface-2)',
              padding: 10,
            }}>
              <KeyValue label="Format" value={artifact?.kind || artifact?.type || artifact?.ext || 'Artifact'} />
              <KeyValue label="Files" value={typeof artifact?.fileCount === 'number' ? artifact.fileCount : files.length} />
              <KeyValue label="Updated" value={artifact?.updated || formatDate(artifact?.updatedAt || artifact?.updated_at)} />
            </div>
          </RailSection>

          <RailSection title="Preview">
            <div style={{
              aspectRatio: '16 / 10',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'linear-gradient(135deg, var(--surface-2), var(--surface-3))',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--ink-3)',
            }}>
              {Ico.doc(34)}
            </div>
          </RailSection>

          <RailSection title="Files">
            {files.length === 0 ? (
              <EmptyLine>No files listed.</EmptyLine>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 14 }}>
                {files.map((file, index) => {
                  const fileValue = fileOptionValue(file);
                  const fileSelected = selectedReviewFile && fileValue === selectedReviewFile;
                  const fileActive = fileSelected || (!selectedReviewFile && index === 0);
                  return (
                    <button
                      type="button"
                      key={`${file.path || file.name}-${index}`}
                      title={file.path || file.name}
                      onClick={() => setSelectedReviewItem({
                        id: `file:${fileValue || index}`,
                        kind: 'file',
                        anchor: fileValue ? { file: fileValue, label: fileOptionLabel(file) } : {},
                        body: `${fileOptionLabel(file) || 'This file'} selected for review context.`,
                      })}
                      style={{
                        width: '100%',
                        minWidth: 0,
                        display: 'grid',
                        gridTemplateColumns: '18px minmax(0, 1fr)',
                        gap: 8,
                        alignItems: 'center',
                        padding: '8px 9px',
                        border: `1px solid ${fileSelected ? 'color-mix(in srgb, var(--accent) 42%, var(--line))' : 'var(--line)'}`,
                        borderRadius: 8,
                        background: fileActive ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))' : 'var(--surface)',
                        color: 'var(--ink-2)',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ display: 'inline-flex', color: fileActive ? 'var(--accent)' : 'var(--ink-4)' }}>
                        {Ico.doc(13)}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontFamily: FONT_BODY,
                          fontSize: 12.5,
                          fontWeight: fileActive ? 600 : 500,
                        }}>
                          {file.name}
                        </span>
                        {file.role && (
                          <span style={{
                            display: 'block',
                            marginTop: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontFamily: FONT_MONO,
                            fontSize: 10.5,
                            color: 'var(--ink-4)',
                          }}>
                            {file.role}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </RailSection>
        </aside>

        <main style={{
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--line)',
          background: 'var(--surface-2)',
        }}>
          <div style={{
            flex: '0 0 auto',
            minHeight: 42,
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderBottom: '1px solid var(--line)',
            background: 'var(--surface)',
          }}>
            <span style={{ display: 'inline-flex', color: 'var(--ink-3)' }}>{Ico.eye(14)}</span>
            <span style={{
              fontFamily: FONT_BODY,
              fontSize: 12.5,
              color: 'var(--ink-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {displayName(actionPath)}
            </span>
          </div>
          <SelectedReviewBar
            selection={selectedReviewItem}
            onClear={() => setSelectedReviewItem(null)}
            onStartTask={onHandoff ? startTask : null}
            taskBusy={handoffBusy}
          />
          <PreviewPane
            artifact={artifact}
            actionPath={actionPath}
            isBrokenPreview={isBrokenPreview}
            previewVersion={previewVersion}
            onClearPreview={() => setPreviewVersion(null)}
            onPreviewFailed={setPreviewFailed}
            onRestoreLastGood={restoreLastGood}
            restoreLastGoodBusy={lastGoodBusy}
          />
        </main>

        <aside style={{
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
        }}>
          <div style={{
            flexShrink: 0,
            display: 'flex',
            borderBottom: '1px solid var(--line)',
            overflowX: 'auto',
          }}>
            {TABS.map((tab) => (
              <TabButton
                key={tab.id}
                tab={tab}
                active={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </div>
          <div className="scroll-clean" style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 14,
          }}>
            <CommentsTab
              active={activeTab === 'comments'}
              path={actionPath}
              artifact={artifact}
              onLoaded={setCollaborationMeta}
              onStartTask={onHandoff ? startTask : null}
              onArtifactChanged={onReviewChanged}
              onReviewSummaryChange={onReviewSummaryChanged}
              taskBusy={handoffBusy}
              selectedReviewItem={selectedReviewItem}
              onSelectReviewItem={setSelectedReviewItem}
            />
            <ChangesTab
              active={activeTab === 'changes'}
              path={actionPath}
              artifact={artifact}
              onVersionsLoaded={setHistoryMeta}
              compareRequest={compareRequest}
            />
            <HistoryTab
              active={activeTab === 'history'}
              path={actionPath}
              artifact={artifact}
              onRestored={onRestored}
              onLoaded={setHistoryMeta}
              onStartTask={onHandoff ? startTask : null}
              taskBusy={handoffBusy}
              onPreviewVersion={previewSavedVersion}
              onCompareVersion={compareSavedVersion}
              onForked={onForked}
              onPublishVersion={onPublish ? publishSavedVersion : null}
              previewVersionId={previewVersion?.id || ''}
              projects={projects}
            />
            <ActivityTab
              active={activeTab === 'activity'}
              artifact={artifact}
              versionsState={historyMeta}
              collaborationState={collaborationMeta}
            />
            <ShareTab
              active={activeTab === 'share'}
              artifact={artifact}
              onPublish={onPublish}
              onUnpublish={onUnpublish}
              projects={projects}
              historyState={historyMeta}
              collaborationState={collaborationMeta}
              onComparePublished={compareSavedVersion}
            />
          </div>
        </aside>
      </div>
    </Modal>
  );
}

export function ArtifactWorkspace(props) {
  if (shouldUseArtifactWorkspaceA(props)) {
    return <ArtifactWorkspaceA {...props} />;
  }
  return <LegacyArtifactWorkspace {...props} />;
}

export default ArtifactWorkspace;
