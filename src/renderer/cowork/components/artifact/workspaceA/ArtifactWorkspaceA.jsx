import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../../Icons';
import { Modal } from '../../ui/Modal';
import { copyText } from '../../../lib/clipboard';
import {
  applyArtifactCommentPatch,
  createArtifactComment,
  fetchArtifactComments,
  fetchArtifactVersions,
  mountArtifactPreview,
  openArtifactFile,
  previewArtifactCommentPatch,
  publishTargetPath,
  setArtifactSuggestionStatus,
} from '../../../api';
import { IconRail } from '../redesign/IconRail';
import { WorkspaceShell } from '../redesign/WorkspaceShell';
import { StoryRail } from '../redesign/StoryRail';
import { Puck } from '../redesign/Puck';
import '../redesign/redesign.css';
import './workspaceA.css';

const FLAG_STORAGE_KEY = 'anton:artifact-workspace-direction-a';

function extOfPath(p) {
  if (!p || typeof p !== 'string') return '';
  const m = p.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
}

function pathOf(artifact) {
  return artifact?.canonicalPath
    || artifact?.file_path
    || artifact?.path
    || publishTargetPath(artifact)
    || '';
}

function displayName(path) {
  if (!path) return 'Artifact';
  return String(path).split(/[\\/]/).filter(Boolean).pop() || path;
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

function formatRelative(value) {
  if (!value) return 'just now';
  const time = Date.parse(value);
  if (Number.isNaN(time)) return String(value);
  const diff = Date.now() - time;
  const abs = Math.abs(diff);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return 'just now';
  if (abs < hour) return `${Math.max(1, Math.round(abs / minute))}m ago`;
  if (abs < day) return `${Math.round(abs / hour)}h ago`;
  if (abs < 7 * day) return `${Math.round(abs / day)}d ago`;
  return formatDate(value);
}

function withVersion(url, version) {
  if (!url || version == null || version === '') return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(version)}`;
}

function isTruthyFlag(value) {
  return value === true || value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function isDirectionAWorkspaceEnabled() {
  const envValue = import.meta.env?.VITE_ARTIFACT_WORKSPACE_DIRECTION_A;
  if (isTruthyFlag(envValue)) return true;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(FLAG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function artifactFileCandidates(artifact) {
  const raw =
    (Array.isArray(artifact?.files) && artifact.files)
    || (Array.isArray(artifact?.manifest?.files) && artifact.manifest.files)
    || (Array.isArray(artifact?.structure?.files) && artifact.structure.files)
    || [];
  const files = raw
    .map((item) => {
      if (typeof item === 'string') return { path: item, name: displayName(item) };
      const filePath = item?.path || item?.file || item?.name || '';
      return {
        path: filePath,
        name: item?.name || displayName(filePath),
        role: item?.role || item?.kind || item?.type || '',
      };
    })
    .filter((item) => item.path || item.name);
  const primary = pathOf(artifact);
  if (primary && !files.some((file) => file.path === primary)) {
    files.unshift({ path: primary, name: displayName(primary), role: 'Primary' });
  }
  return files.slice(0, 24);
}

export function isDirectionAArtifact(artifact) {
  if (!artifact) return false;
  const primaryPath = pathOf(artifact).toLowerCase();
  const declaredExt = String(artifact?.ext || '').toLowerCase();
  const primaryExt = declaredExt || extOfPath(primaryPath);
  const htmlPrimary = primaryExt === '.html' || primaryExt === '.htm' || primaryPath.endsWith('.html') || primaryPath.endsWith('.htm');
  if (htmlPrimary) return true;
  const typeText = [
    artifact?.kind,
    artifact?.type,
    artifact?.artifactType,
    artifact?.artifact_type,
    artifact?.manifest?.kind,
    artifact?.manifest?.type,
  ].filter(Boolean).join(' ').toLowerCase();
  const slideLike = /\b(slide|slides|deck|presentation|reveal|slideshow)\b/.test(typeText);
  const backendLike = /\b(fullstack|stateful|stateless|backend)\b/.test(typeText);
  if (!slideLike) return false;
  if (backendLike) return false;
  return artifactFileCandidates(artifact).some((file) => {
    const filePath = String(file.path || file.name || '').toLowerCase();
    return filePath.endsWith('.html') || filePath.endsWith('.htm');
  });
}

export function shouldUseArtifactWorkspaceA({ open, artifact } = {}) {
  return !!open && isDirectionAWorkspaceEnabled() && isDirectionAArtifact(artifact);
}

function normalizeVersion(v, index, meta = {}) {
  const id = v?.id || v?.versionId || v?.version_id || v?.checkpointId || v?.checkpoint_id || v?.version || `${index}`;
  const rawDate = v?.createdAt || v?.created_at || v?.timestamp || v?.mtime || v?.updatedAt || v?.updated_at;
  const dateLabel = formatDate(rawDate);
  const fallbackLabel = dateLabel ? `Saved version ${dateLabel}` : `Saved version ${index + 1}`;
  const label = v?.label || v?.title || v?.name || v?.message || fallbackLabel;
  return {
    id: String(id),
    label,
    dateLabel,
    createdAt: rawDate || '',
    summary: v?.prompt || v?.summary || v?.description || v?.note || '',
    author: v?.author || v?.createdBy || v?.created_by || v?.actor || '',
    versionNumber: v?.versionNumber ?? v?.version_number ?? null,
    current: !!(v?.current || v?.isCurrent || v?.is_current || String(id) === String(meta.currentVersionId || '')),
    latest: !!(v?.latest || v?.isLatest || v?.is_latest || String(id) === String(meta.latestVersionId || '')),
    operationType: v?.operationType || v?.operation_type || '',
    raw: v,
  };
}

function suggestionStatusOf(comment) {
  return (
    comment?.suggestionStatus
    || comment?.suggestion_status
    || (['accepted', 'rejected', 'open'].includes(comment?.status) ? comment.status : '')
    || ''
  );
}

function isResolved(comment) {
  return !!(comment?.resolved || comment?.status === 'resolved');
}

function isClosed(comment) {
  const status = suggestionStatusOf(comment);
  return isResolved(comment) || status === 'accepted' || status === 'rejected';
}

function anchorOf(comment) {
  const anchor = comment?.anchor || {};
  return anchor && typeof anchor === 'object' && !Array.isArray(anchor) ? anchor : {};
}

function rectAnchorOf(comment) {
  const anchor = anchorOf(comment);
  const rect = anchor?.rect || anchor?.bounds || anchor?.box || null;
  if (!rect || typeof rect !== 'object') return null;
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  const unitRaw = String(anchor?.unit || anchor?.rectUnit || anchor?.rect_unit || '').trim().toLowerCase();
  const percentUnit = unitRaw === 'percent' || unitRaw === '%';
  const legacyUnitlessPercent = !unitRaw && [x, y, width, height].every((value) => value >= 0 && value <= 1);
  if (percentUnit || legacyUnitlessPercent) {
    const divisor = Math.max(x, y, width, height) > 1 ? 100 : 1;
    return {
      unit: 'percent',
      x: Math.max(0, Math.min(1, x / divisor)),
      y: Math.max(0, Math.min(1, y / divisor)),
      width: Math.max(0.015, Math.min(1, width / divisor)),
      height: Math.max(0.015, Math.min(1, height / divisor)),
    };
  }
  return {
    unit: 'px',
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.max(8, width),
    height: Math.max(8, height),
  };
}

function rectAnchorStyle(rect) {
  if (!rect) return {};
  if (rect.unit === 'px') {
    return {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    };
  }
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
}

function anchorLabel(anchor) {
  const file = anchor?.file || anchor?.path || anchor?.target || '';
  const detail = anchor?.detail || anchor?.section || anchor?.line || anchor?.row || '';
  const fileLabel = file ? displayName(file) : '';
  return [fileLabel, detail].filter(Boolean).join(' - ');
}

function proposedPatchOf(comment) {
  return comment?.proposedPatch || comment?.proposed_patch || {};
}

function patchOperationsOf(comment) {
  const operations = proposedPatchOf(comment)?.operations;
  return Array.isArray(operations) ? operations : [];
}

function statusClass(active, danger = false) {
  return ['awa-chip', active ? 'is-on' : '', danger ? 'is-danger' : ''].filter(Boolean).join(' ');
}

function commentKindLabel(comment) {
  if (comment?.kind === 'suggestion') return 'Suggested change';
  if (comment?.kind === 'review') return 'Review request';
  return 'Comment';
}

function countOpen(comments) {
  return (comments || []).filter((comment) => !isClosed(comment)).length;
}

function openSuggestions(comments) {
  return (comments || []).filter((comment) => comment?.kind === 'suggestion' && !isClosed(comment));
}

function diffLineClass(line) {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'awa-diff-line is-add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'awa-diff-line is-remove';
  if (line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ')) return 'awa-diff-line is-meta';
  return 'awa-diff-line';
}

function buildRectAnchor(rect, actionPath) {
  if (!rect) return {};
  return {
    kind: 'rect',
    file: actionPath,
    unit: 'percent',
    coordinateSpace: 'preview',
    label: displayName(actionPath),
    detail: `${Math.round(rect.x * 100)}%, ${Math.round(rect.y * 100)}%`,
    rect: {
      x: Number(rect.x.toFixed(4)),
      y: Number(rect.y.toFixed(4)),
      width: Number(rect.width.toFixed(4)),
      height: Number(rect.height.toFixed(4)),
    },
  };
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Y';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

function eventTime(row) {
  const value = row?.createdAt || row?.created_at || row?.timestamp || row?.time || row?.updatedAt || row?.updated_at;
  const time = Date.parse(value || '');
  return Number.isNaN(time) ? 0 : time;
}

function storyEventsFrom({ comments, versions, activity }) {
  const commentEvents = (comments || []).map((comment, index) => {
    const actor = comment.actorName || comment.actor_name || comment.actor || 'You';
    const isSuggestion = comment.kind === 'suggestion';
    const isReview = comment.kind === 'review';
    return {
      id: `comment:${comment.id || index}`,
      sortTime: eventTime(comment),
      kind: isSuggestion || isReview ? 'review' : 'comment',
      author: { name: actor, initials: initials(actor), color: '#3a4d6e' },
      title: isSuggestion ? 'suggested a change' : isReview ? 'asked for review' : 'commented',
      body: comment.body || comment.text || '',
      when: formatRelative(comment.createdAt || comment.created_at),
    };
  });
  const versionEvents = (versions || []).map((version, index) => ({
    id: `version:${version.id || index}`,
    sortTime: eventTime({ createdAt: version.createdAt }),
    kind: 'version',
    author: { name: version.author || 'Anton', initials: version.author ? initials(version.author) : '', isAI: !version.author },
    title: `saved ${version.label || 'a version'}`,
    body: version.summary || '',
    when: formatRelative(version.createdAt || version.dateLabel),
    meta: { version: version.versionNumber },
  }));
  const activityEvents = (activity || []).slice(0, 16).map((event, index) => {
    const actor = event.actorName || event.actor_name || event.actor || 'Anton';
    const raw = event.eventType || event.event_type || event.type || event.kind || 'activity';
    const label = String(raw).replace(/[_-]+/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
    return {
      id: `activity:${event.id || index}`,
      sortTime: eventTime(event),
      kind: 'system',
      author: { name: actor, initials: actor === 'Anton' ? '' : initials(actor), isAI: actor === 'Anton' },
      title: label,
      body: event?.details?.label || event?.summary || '',
      when: formatRelative(event.createdAt || event.created_at || event.timestamp || event.time),
    };
  });
  return [...commentEvents, ...versionEvents, ...activityEvents]
    .filter((event) => event.id)
    .sort((a, b) => b.sortTime - a.sortTime)
    .slice(0, 80);
}

function DirectionATopBar({
  artifact,
  actionPath,
  versionLabel,
  selectedVersion,
  comments,
  previewError,
  reviewerMode,
  onToggleReviewer,
  onPublish,
  onOpen,
  onClose,
}) {
  const title = artifact?.title || displayName(actionPath);
  const subtitle = artifact?.description || artifact?.kind || artifact?.type || displayName(actionPath);
  const openCount = countOpen(comments);
  const suggestionCount = openSuggestions(comments).length;
  const copyPublished = async () => {
    if (artifact?.publishedUrl) await copyText(artifact.publishedUrl);
  };
  return (
    <div className="awa-topbar">
      <div className="awa-title-cluster">
        <span className="awa-title-icon">{Ico.doc(14)}</span>
        <span className="awa-title-text">
          <span id="artifact-workspace-a-title" className="awa-title" title={title}>{title}</span>
          <span className="awa-subtitle" title={subtitle}>{subtitle}</span>
        </span>
      </div>
      <span className={statusClass(true)} title={selectedVersion?.label || 'Current draft'}>
        {versionLabel}
      </span>
      <span className={statusClass(!!artifact?.publishedUrl)}>Published</span>
      {openCount > 0 ? <span className={statusClass(true)}>{openCount} open</span> : null}
      {suggestionCount > 0 ? <span className={statusClass(true)}>{suggestionCount} suggestions</span> : null}
      {previewError ? <span className={statusClass(true, true)}>Preview issue</span> : null}
      <div style={{ flex: 1, minWidth: 10 }} />
      <button type="button" className={`awa-button ${reviewerMode ? 'is-primary' : ''}`} onClick={onToggleReviewer}>
        {Ico.pin(13)}
        <span>{reviewerMode ? 'Reviewing' : 'Review'}</span>
      </button>
      {artifact?.publishedUrl ? (
        <button type="button" className="awa-button" onClick={copyPublished}>
          {Ico.link(13)}
          <span>Copy link</span>
        </button>
      ) : null}
      <button type="button" className="awa-button" onClick={onOpen}>
        {Ico.externalLink(13)}
        <span>Open</span>
      </button>
      {onPublish ? (
        <button type="button" className="awa-button is-primary" onClick={onPublish}>
          {Ico.upload(13)}
          <span>{artifact?.publishedUrl ? 'Update' : 'Publish'}</span>
        </button>
      ) : null}
      <button type="button" className="awa-icon-button" onClick={onClose} aria-label="Close" title="Close">
        {Ico.close(13)}
      </button>
    </div>
  );
}

function SlideRail({
  files,
  activePath,
  comments,
  selectedCommentId,
  previewStates,
  busy,
  onSelectComment,
  onPreviewSuggestion,
  onDecideSuggestion,
}) {
  const suggestions = openSuggestions(comments);
  const openComments = comments.filter((comment) => !isClosed(comment) && comment.kind !== 'suggestion');
  return (
    <aside className="awa-slide-rail">
      <div className="awa-slide-rail__header">
        {Ico.sidebar(14)}
        <span>Workspace</span>
      </div>
      <div className="awa-slide-rail__body rd-scroll">
        <div>
          <div className="awa-rail-section-title">Files</div>
          {files.length ? files.map((file, index) => {
            const filePath = file.path || file.name || '';
            const active = filePath === activePath || (!activePath && index === 0);
            return (
              <button
                type="button"
                key={`${filePath}-${index}`}
                className={`awa-rail-row ${active ? 'is-active' : ''}`}
                title={filePath}
              >
                <span className="awa-rail-row__icon">{Ico.doc(12)}</span>
                <span className="awa-rail-row__main">
                  <span className="awa-rail-row__title">{file.name || displayName(filePath)}</span>
                  <span className="awa-rail-row__meta">{file.role || extOfPath(filePath) || 'HTML'}</span>
                </span>
              </button>
            );
          }) : <div className="awa-empty">No files listed.</div>}
        </div>

        <div>
          <div className="awa-rail-section-title">Proposals</div>
          {suggestions.length ? suggestions.map((comment) => (
            <ProposalCard
              key={comment.id || comment.createdAt || comment.created_at}
              comment={comment}
              selected={String(selectedCommentId || '') === String(comment.id || '')}
              previewState={previewStates[comment.id]}
              busy={busy}
              onSelect={() => onSelectComment(comment)}
              onPreview={() => onPreviewSuggestion(comment)}
              onDecide={(status) => onDecideSuggestion(comment, status)}
            />
          )) : <div className="awa-empty">No open suggested changes.</div>}
        </div>

        <div>
          <div className="awa-rail-section-title">Open Notes</div>
          {openComments.length ? openComments.slice(0, 8).map((comment) => (
            <button
              type="button"
              key={comment.id || comment.createdAt || comment.created_at}
              className={`awa-review-card ${String(selectedCommentId || '') === String(comment.id || '') ? 'is-selected' : ''}`}
              onClick={() => onSelectComment(comment)}
            >
              <span className="awa-review-card__kicker">
                <span>{commentKindLabel(comment)}</span>
                <span>{formatRelative(comment.createdAt || comment.created_at)}</span>
              </span>
              <span className="awa-review-card__body">{comment.body || comment.text}</span>
            </button>
          )) : <div className="awa-empty">No open notes.</div>}
        </div>
      </div>
    </aside>
  );
}

function ProposalCard({
  comment,
  selected,
  previewState,
  busy,
  onSelect,
  onPreview,
  onDecide,
}) {
  const operations = patchOperationsOf(comment);
  const hasPatch = operations.length > 0;
  const accepted = suggestionStatusOf(comment) === 'accepted';
  const rejected = suggestionStatusOf(comment) === 'rejected';
  const previewReady = !hasPatch || previewState?.status === 'ready';
  const firstPath = operations.find((operation) => operation.path)?.path || anchorOf(comment).file || '';
  const previewDiff = previewState?.data?.diff?.textDiff
    || previewState?.data?.diff?.diff
    || previewState?.data?.textDiff
    || '';
  return (
    <div
      role="button"
      tabIndex={0}
      className={`awa-review-card ${selected ? 'is-selected' : ''} ${accepted || rejected ? 'is-closed' : ''}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="awa-review-card__kicker">
        <span>{accepted ? 'Approved' : rejected ? 'Declined' : 'Suggested change'}</span>
        <span>{formatRelative(comment.createdAt || comment.created_at)}</span>
      </span>
      <span className="awa-review-card__title" title={firstPath || undefined}>
        {firstPath ? displayName(firstPath) : 'Artifact change'}
      </span>
      <span className="awa-review-card__body">{comment.body || comment.text}</span>
      {hasPatch ? (
        <span className="awa-proposal-path" title={firstPath}>
          {operations.length} exact edit{operations.length === 1 ? '' : 's'}
        </span>
      ) : null}
      {previewState?.status === 'ready' ? (
        <span className="awa-proposal-preview">
          <span className="awa-proposal-preview__head">Preview ready</span>
          <span className="awa-proposal-preview__body">
            {previewDiff ? String(previewDiff).split('\n').slice(0, 80).map((line, index) => (
              <span key={`${index}-${line}`} className={diffLineClass(line)}>{line || ' '}</span>
            )) : <span className="awa-diff-line">Exact change is ready to apply.</span>}
          </span>
        </span>
      ) : null}
      {previewState?.status === 'error' ? (
        <span className="awa-empty" style={{ color: 'var(--danger)' }}>{previewState.error}</span>
      ) : null}
      {!accepted && !rejected ? (
        <span className="awa-review-card__actions" onClick={(e) => e.stopPropagation()}>
          {hasPatch ? (
            <button type="button" className="awa-scrub-button" disabled={busy === `preview:${comment.id}`} onClick={onPreview}>
              {busy === `preview:${comment.id}` ? 'Previewing' : 'Preview'}
            </button>
          ) : null}
          <button type="button" className="awa-scrub-button" disabled={busy === `status:${comment.id}`} onClick={() => onDecide('rejected')}>
            Decline
          </button>
          <button
            type="button"
            className="awa-scrub-button"
            disabled={busy === `status:${comment.id}` || !previewReady}
            title={!previewReady ? 'Preview this exact change first' : undefined}
            onClick={() => onDecide('accepted')}
          >
            {hasPatch ? 'Apply' : 'Approve'}
          </button>
        </span>
      ) : (
        <span className="awa-review-card__actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="awa-scrub-button" disabled={busy === `status:${comment.id}`} onClick={() => onDecide('open')}>
            Reopen
          </button>
        </span>
      )}
    </div>
  );
}

function VersionScrubber({ versions, selectedVersionId, onSelectVersion, onClearVersion }) {
  const selectedIndex = selectedVersionId
    ? versions.findIndex((version) => version.id === selectedVersionId)
    : -1;
  const sliderMax = Math.max(versions.length - 1, 0);
  const sliderValue = selectedIndex >= 0 ? selectedIndex : 0;
  const selected = selectedIndex >= 0 ? versions[selectedIndex] : null;
  return (
    <div className="awa-version-scrubber">
      <button type="button" className="awa-scrub-button" disabled={!selectedVersionId} onClick={onClearVersion}>
        {Ico.refresh(12)}
        Current draft
      </button>
      <input
        type="range"
        min="0"
        max={sliderMax}
        step="1"
        value={sliderValue}
        disabled={!versions.length}
        onChange={(e) => {
          const next = versions[Number(e.target.value)];
          if (next?.id) onSelectVersion(next.id);
        }}
        aria-label="Version scrubber"
      />
      <div className="awa-version-scrubber__label" title={selected?.label || 'Current draft'}>
        <strong>{selected ? selected.label : 'Current draft'}</strong>
        {selected?.dateLabel ? ` - ${selected.dateLabel}` : versions.length ? ` - ${versions.length} saved` : ' - no saved versions yet'}
      </div>
    </div>
  );
}

function Stage({
  artifact,
  actionPath,
  preview,
  reviewerMode,
  comments,
  selectedCommentId,
  selectedRect,
  draftRect,
  puckFace,
  puckPosition,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onCancelPuck,
  onAskAI,
  onStartComment,
  onSubmitPrompt,
  onSubmitComment,
  onSelectComment,
}) {
  const rectComments = comments
    .map((comment) => ({ comment, rect: rectAnchorOf(comment) }))
    .filter((item) => item.rect && !isClosed(item.comment));
  return (
    <main className="awa-stage">
      <div className="awa-stage-toolbar">
        <div className="awa-stage-toolbar__title">
          {reviewerMode ? Ico.pin(13) : Ico.eye(13)}
          <span title={actionPath}>{displayName(actionPath)}</span>
        </div>
        <span className={statusClass(reviewerMode)}>Reviewer mode</span>
      </div>
      <div className="awa-stage-wrap">
        <div className="awa-stage-frame">
          {preview.status === 'error' ? (
            <div className="awa-stage-status is-error">{preview.error}</div>
          ) : preview.status === 'loading' ? (
            <div className="awa-stage-status">Loading preview...</div>
          ) : preview.url ? (
            <iframe
              title={artifact?.title || 'Artifact preview'}
              src={preview.url}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
            />
          ) : (
            <div className="awa-stage-status">Preview unavailable.</div>
          )}
          <div
            className={`awa-stage-overlay ${reviewerMode ? 'is-active' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {rectComments.map(({ comment, rect }) => (
              <button
                type="button"
                key={comment.id || `${rect.x}-${rect.y}`}
                className={`awa-anchor-rect ${String(selectedCommentId || '') === String(comment.id || '') ? 'is-selected' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectComment(comment);
                }}
                style={rectAnchorStyle(rect)}
                title={comment.body || comment.text || commentKindLabel(comment)}
              >
                <span className="awa-anchor-pin">{Ico.chats(10)}</span>
              </button>
            ))}
            {draftRect ? (
              <div
                className="awa-draft-rect"
                style={{
                  left: `${draftRect.x * 100}%`,
                  top: `${draftRect.y * 100}%`,
                  width: `${draftRect.width * 100}%`,
                  height: `${draftRect.height * 100}%`,
                }}
              />
            ) : null}
            {selectedRect && puckPosition ? (
              <Puck
                face={puckFace}
                onAskAI={onAskAI}
                onStartComment={onStartComment}
                onSubmitPrompt={onSubmitPrompt}
                onSubmitComment={onSubmitComment}
                onCancel={onCancelPuck}
                style={{ left: puckPosition.left, top: puckPosition.top }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

export function ArtifactWorkspaceA({
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
  const actionPath = pathOf(artifact);
  const files = useMemo(() => artifactFileCandidates(artifact), [artifact]);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [reviewerMode, setReviewerMode] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [previewNonce, setPreviewNonce] = useState(0);
  const [preview, setPreview] = useState({ status: 'idle', url: '', error: '' });
  const [versionsState, setVersionsState] = useState({ status: 'idle', versions: [], meta: {}, error: '', available: null });
  const [commentsState, setCommentsState] = useState({ status: 'idle', comments: [], activity: [], viewerState: {}, error: '', available: null });
  const [message, setMessage] = useState({ kind: '', text: '' });
  const [busy, setBusy] = useState('');
  const [patchPreviews, setPatchPreviews] = useState({});
  const [selectedCommentId, setSelectedCommentId] = useState('');
  const [selectedRect, setSelectedRect] = useState(null);
  const [draftRect, setDraftRect] = useState(null);
  const [puckFace, setPuckFace] = useState('menu');
  const dragRef = useRef(null);
  const versionsRequestRef = useRef(0);
  const commentsRequestRef = useRef(0);

  const versions = useMemo(
    () => (versionsState.versions || []).map((item, index) => normalizeVersion(item, index, versionsState.meta || {})),
    [versionsState.versions, versionsState.meta],
  );
  const selectedVersion = selectedVersionId ? versions.find((version) => version.id === selectedVersionId) || null : null;
  const versionLabel = selectedVersion
    ? (selectedVersion.versionNumber != null ? `v${selectedVersion.versionNumber}` : selectedVersion.label)
    : 'Draft';
  const comments = commentsState.comments || [];
  const storyEvents = useMemo(
    () => storyEventsFrom({ comments, versions, activity: commentsState.activity || [] }),
    [comments, versions, commentsState.activity],
  );

  const loadVersions = useCallback(() => {
    if (!actionPath) return;
    const requestId = versionsRequestRef.current + 1;
    versionsRequestRef.current = requestId;
    setVersionsState((prev) => ({ ...prev, status: 'loading', versions: [], error: '' }));
    fetchArtifactVersions(actionPath)
      .then((data) => {
        if (versionsRequestRef.current !== requestId) return;
        const available = data?.available !== false;
        setVersionsState({
          status: available ? 'ready' : 'unavailable',
          available,
          versions: available ? (data?.versions || []) : [],
          meta: data || {},
          error: '',
        });
      })
      .catch((err) => {
        if (versionsRequestRef.current !== requestId) return;
        setVersionsState({ status: 'error', available: true, versions: [], meta: {}, error: err?.message || 'Could not load versions.' });
      });
  }, [actionPath]);

  const loadComments = useCallback(() => {
    if (!actionPath) return;
    const requestId = commentsRequestRef.current + 1;
    commentsRequestRef.current = requestId;
    setCommentsState((prev) => ({ ...prev, status: 'loading', comments: [], activity: [], error: '' }));
    fetchArtifactComments(actionPath)
      .then((data) => {
        if (commentsRequestRef.current !== requestId) return;
        const available = data?.available !== false;
        setCommentsState({
          status: available ? 'ready' : 'unavailable',
          available,
          comments: available ? (data?.comments || []) : [],
          activity: available ? (data?.activity || []) : [],
          viewerState: data?.viewerState || data?.viewer_state || {},
          error: '',
        });
      })
      .catch((err) => {
        if (commentsRequestRef.current !== requestId) return;
        setCommentsState({ status: 'error', available: true, comments: [], activity: [], viewerState: {}, error: err?.message || 'Could not load comments.' });
      });
  }, [actionPath]);

  useEffect(() => {
    if (!open) {
      versionsRequestRef.current += 1;
      commentsRequestRef.current += 1;
      return;
    }
    setRailCollapsed(false);
    setReviewerMode(false);
    setSelectedVersionId('');
    setPreviewNonce((value) => value + 1);
    setPatchPreviews({});
    setSelectedCommentId('');
    setSelectedRect(null);
    setDraftRect(null);
    setPuckFace('menu');
    setMessage({ kind: '', text: '' });
  }, [open, actionPath]);

  useEffect(() => {
    if (!open || !actionPath) return;
    loadVersions();
    loadComments();
  }, [open, actionPath, loadVersions, loadComments]);

  useEffect(() => {
    if (!open || !actionPath) return undefined;
    let cancelled = false;
    setPreview({ status: 'loading', url: '', error: '' });
    const cacheVersion = selectedVersionId || artifact?.mtime || previewNonce;
    mountArtifactPreview(actionPath, { versionId: selectedVersionId || undefined })
      .then(({ kind, url, proxyUrl, backendRunning, launchError }) => {
        if (cancelled) return;
        if (kind === 'proxy') {
          if (backendRunning === false) throw new Error(launchError || 'Backend preview failed to start.');
          if (!proxyUrl) throw new Error('Preview workspace could not be opened.');
          setPreview({ status: 'ready', url: withVersion(proxyUrl, cacheVersion), error: '' });
          return;
        }
        if (!url) throw new Error('Preview link was not created.');
        setPreview({ status: 'ready', url: withVersion(url, cacheVersion), error: '' });
      })
      .catch((err) => {
        if (!cancelled) setPreview({ status: 'error', url: '', error: err?.message || 'Could not load artifact preview.' });
      });
    return () => { cancelled = true; };
  }, [open, actionPath, selectedVersionId, artifact?.mtime, previewNonce]);

  const publishCollaborationResult = useCallback((result, fallbackComments = comments) => {
    const nextComments = result?.comments || (result?.comment ? [result.comment, ...fallbackComments] : fallbackComments);
    setCommentsState((prev) => ({
      ...prev,
      status: 'ready',
      available: true,
      comments: nextComments,
      activity: result?.activity || prev.activity || [],
      viewerState: result?.viewerState || result?.viewer_state || prev.viewerState || {},
      error: '',
    }));
  }, [comments]);

  const refreshAfterArtifactChange = useCallback((result) => {
    setPreviewNonce((value) => value + 1);
    loadVersions();
    loadComments();
    onChange?.({
      ...artifact,
      reviewVersionId: result?.version?.id || artifact?.reviewVersionId,
      mtime: Date.now(),
      ...(result?.artifact || {}),
    });
  }, [artifact, loadVersions, loadComments, onChange]);

  const selectedRectPixels = useMemo(() => {
    if (!selectedRect) return null;
    if (selectedRect.unit === 'px') {
      return {
        left: `${selectedRect.x + Math.min(selectedRect.width, 360)}px`,
        top: `${Math.max(16, selectedRect.y)}px`,
      };
    }
    return {
      left: `${(selectedRect.x + Math.min(selectedRect.width, 0.82)) * 100}%`,
      top: `${Math.max(0.04, selectedRect.y) * 100}%`,
    };
  }, [selectedRect]);

  const normalizeEventRect = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    return { x, y, bounds };
  };

  const onPointerDown = (event) => {
    if (!reviewerMode || event.button !== 0) return;
    if (event.target !== event.currentTarget) return;
    const { x, y } = normalizeEventRect(event);
    dragRef.current = { x, y, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = { x, y, width: 0.001, height: 0.001 };
    setDraftRect(rect);
    setSelectedRect(null);
    setSelectedCommentId('');
    setPuckFace('menu');
  };

  const onPointerMove = (event) => {
    if (!dragRef.current) return;
    const { x, y } = normalizeEventRect(event);
    const start = dragRef.current;
    setDraftRect({
      x: Math.min(start.x, x),
      y: Math.min(start.y, y),
      width: Math.max(0.001, Math.abs(x - start.x)),
      height: Math.max(0.001, Math.abs(y - start.y)),
    });
  };

  const onPointerUp = (event) => {
    if (!dragRef.current) return;
    const { x, y } = normalizeEventRect(event);
    const start = dragRef.current;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(start.pointerId);
    const width = Math.abs(x - start.x);
    const height = Math.abs(y - start.y);
    const clickRect = width < 0.015 && height < 0.015;
    const rect = clickRect
      ? {
        x: Math.max(0, Math.min(0.92, x - 0.04)),
        y: Math.max(0, Math.min(0.92, y - 0.035)),
        width: 0.08,
        height: 0.07,
      }
      : {
        x: Math.min(start.x, x),
        y: Math.min(start.y, y),
        width: Math.max(0.025, width),
        height: Math.max(0.025, height),
      };
    setDraftRect(null);
    setSelectedRect(rect);
    setPuckFace('menu');
  };

  const clearPuck = () => {
    setSelectedRect(null);
    setDraftRect(null);
    setPuckFace('menu');
  };

  const addAnchoredComment = async ({ text, kind }) => {
    const body = String(text || '').trim();
    if (!body || !selectedRect || busy) return;
    setBusy(`comment:${kind}`);
    setMessage({ kind: '', text: '' });
    try {
      const result = await createArtifactComment(actionPath, {
        body,
        kind,
        anchor: buildRectAnchor(selectedRect, actionPath),
      });
      publishCollaborationResult(result);
      setMessage({ kind: 'ok', text: kind === 'review' ? 'Review request added.' : 'Comment added.' });
      clearPuck();
    } catch (err) {
      setMessage({ kind: 'error', text: err?.message || 'Could not add comment.' });
    } finally {
      setBusy('');
    }
  };

  const previewSuggestion = async (comment) => {
    if (!comment?.id || busy) return;
    setBusy(`preview:${comment.id}`);
    setPatchPreviews((prev) => ({ ...prev, [comment.id]: { status: 'loading', error: '', data: null } }));
    setMessage({ kind: '', text: '' });
    try {
      const data = await previewArtifactCommentPatch(comment.id);
      setPatchPreviews((prev) => ({ ...prev, [comment.id]: { status: 'ready', error: '', data } }));
    } catch (err) {
      setPatchPreviews((prev) => ({
        ...prev,
        [comment.id]: { status: 'error', error: err?.message || 'Could not preview this change.', data: null },
      }));
    } finally {
      setBusy('');
    }
  };

  const decideSuggestion = async (comment, nextStatus) => {
    if (!comment?.id || busy) return;
    const hasPatch = patchOperationsOf(comment).length > 0;
    const previewState = patchPreviews[comment.id];
    if (nextStatus === 'accepted' && hasPatch && previewState?.status !== 'ready') {
      setMessage({ kind: 'error', text: 'Preview this exact change before applying it.' });
      return;
    }
    setBusy(`status:${comment.id}`);
    setMessage({ kind: '', text: '' });
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
      const nextComments = comments.map((item) => (item.id === comment.id ? updated : item));
      publishCollaborationResult({ ...result, comments: nextComments }, nextComments);
      if (nextStatus === 'accepted' && (result?.version || result?.changedPaths || result?.changed_paths || result?.artifact)) {
        refreshAfterArtifactChange(result);
      }
      setMessage({ kind: 'ok', text: nextStatus === 'accepted' ? 'Suggestion applied.' : nextStatus === 'rejected' ? 'Suggestion declined.' : 'Suggestion reopened.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err?.message || 'Could not update suggestion.' });
    } finally {
      setBusy('');
    }
  };

  const selectComment = (comment) => {
    setSelectedCommentId(comment?.id || '');
    const rect = rectAnchorOf(comment);
    if (rect) {
      setSelectedRect(rect);
      setPuckFace('menu');
      setReviewerMode(true);
    }
  };

  const storySend = async (text) => {
    const body = String(text || '').trim();
    if (!body || busy) return;
    setBusy('story-comment');
    setMessage({ kind: '', text: '' });
    try {
      const result = await createArtifactComment(actionPath, { body, kind: 'comment', anchor: { kind: 'artifact', file: actionPath } });
      publishCollaborationResult(result);
      setMessage({ kind: 'ok', text: 'Comment added.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err?.message || 'Could not add comment.' });
    } finally {
      setBusy('');
    }
  };

  if (!open || !artifact) return null;

  const topBar = (
    <DirectionATopBar
      artifact={artifact}
      actionPath={actionPath}
      versionLabel={versionLabel}
      selectedVersion={selectedVersion}
      comments={comments}
      previewError={preview.status === 'error'}
      reviewerMode={reviewerMode}
      onToggleReviewer={() => setReviewerMode((value) => !value)}
      onPublish={onPublish ? () => onPublish(artifact, selectedVersionId ? { versionId: selectedVersionId, versionLabel: selectedVersion?.label } : undefined) : null}
      onOpen={() => openArtifactFile(artifact)}
      onClose={onClose}
    />
  );

  const rail = (
    <StoryRail
      events={storyEvents}
      collapsed={railCollapsed}
      onToggle={() => setRailCollapsed((value) => !value)}
      onSend={storySend}
      composerPlaceholder="Comment or @mention..."
    />
  );

  const bottomStrip = (
    <VersionScrubber
      versions={versions}
      selectedVersionId={selectedVersionId}
      onSelectVersion={setSelectedVersionId}
      onClearVersion={() => setSelectedVersionId('')}
    />
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      width="min(1540px, 98vw)"
      height="min(960px, 94vh)"
      labelledBy="artifact-workspace-a-title"
    >
      <div className="artifact-workspace-a">
        <WorkspaceShell
          iconRail={<IconRail activeNav="artifact" user={{ initials: 'A' }} />}
          topBar={topBar}
          rail={rail}
          railCollapsed={railCollapsed}
          onToggleRail={() => setRailCollapsed((value) => !value)}
          bottomStrip={bottomStrip}
        >
          {message.text ? (
            <div className={`awa-toast ${message.kind === 'error' ? 'is-error' : ''}`}>{message.text}</div>
          ) : null}
          <div className="awa-canvas">
            <SlideRail
              files={files}
              activePath={actionPath}
              comments={comments}
              selectedCommentId={selectedCommentId}
              previewStates={patchPreviews}
              busy={busy}
              onSelectComment={selectComment}
              onPreviewSuggestion={previewSuggestion}
              onDecideSuggestion={decideSuggestion}
            />
            <Stage
              artifact={artifact}
              actionPath={actionPath}
              preview={preview}
              reviewerMode={reviewerMode}
              comments={comments}
              selectedCommentId={selectedCommentId}
              selectedRect={selectedRect}
              draftRect={draftRect}
              puckFace={puckFace}
              puckPosition={selectedRectPixels}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onCancelPuck={clearPuck}
              onAskAI={() => setPuckFace('prompt')}
              onStartComment={() => setPuckFace('comment')}
              onSubmitPrompt={(text) => addAnchoredComment({ text, kind: 'review' })}
              onSubmitComment={(text) => addAnchoredComment({ text, kind: 'comment' })}
              onSelectComment={selectComment}
            />
          </div>
        </WorkspaceShell>
      </div>
    </Modal>
  );
}

export default ArtifactWorkspaceA;
