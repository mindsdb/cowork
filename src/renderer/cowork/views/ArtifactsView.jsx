// Live artifacts page — mirrors the Projects header / filter pattern.
//
// Header:    "Live artifacts" Josefin title + Inter subtitle (no CTA —
//            artifacts are produced by Anton, not authored here).
// Filter:    search (⌘K) · sort pill · count · grid/list toggle.
// Sort:      default "Published first", then Recent · Oldest · Title · Type.
// Grid:      ArtifactBubble cards as today (HTML preview, URL pill,
//            Publish/Unpublish action).
// List:      compact rows — status dot · title · kind · project · updated · ⋯.
//
// Status dot: cyan = published, green-pulse = live preview, none = local.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Ico from '../components/Icons';
import {
  revealArtifact, publishArtifact, unpublishArtifact,
  deleteArtifact, fetchDeletedArtifacts, restoreDeletedArtifact,
  publishTargetPath, artifactServeUrl, openArtifactFile,
} from '../api';
import { copyText } from '../lib/clipboard';
import { downloadArtifactFile } from '../lib/artifactDownload';
import {
  EXPORT_FORMATS,
  canExportArtifact,
  canExportFormat,
  exportAndDeliver,
} from '../lib/artifactExport';
import { isHtmlArtifact, isPublishableArtifact, isBackendArtifact } from '../lib/artifactKinds';
import { trackArtifactPublished } from '../lib/analytics';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ConfirmModal';
import { ArtifactWorkspace } from '../components/artifact';
import {
  PageHeader,
  FilterRow,
  SearchInput,
  SortPill,
  ViewToggle,
  HoverMenu,
  useCollectionShortcut,
} from '../components/collection';
import { host } from '../../platform/host';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useRevealOnHover } from '../hooks/useRevealOnHover';

const FONT_BODY = "var(--font-body)";
const FONT_DISPLAY = "var(--font-display)";
const FONT_MONO = "var(--font-mono)";

const EMPTY_ARTIFACTS = [];

// Sort options for the artifacts collection. Per-page (publishing
// state isn't relevant to other collections).
const SORT_OPTIONS = [
  { id: 'published',   label: 'Published first' },
  { id: 'forYou',      label: 'For you first' },
  { id: 'new',         label: 'New review activity' },
  { id: 'needsReview', label: 'Needs review first' },
  { id: 'openNotes',   label: 'Open notes first' },
  { id: 'recent',      label: 'Recent' },
  { id: 'oldest',      label: 'Oldest' },
  { id: 'title',       label: 'Title (A–Z)' },
  { id: 'type',        label: 'Type' },
];

const REVIEW_FILTER_OPTIONS = [
  { id: 'all', label: 'All', title: 'Show all artifacts' },
  { id: 'forYou', label: 'For you', title: 'Show artifacts waiting for your review' },
  { id: 'new', label: 'New', title: 'Show artifacts with new review activity' },
  { id: 'needsReview', label: 'Needs review', title: 'Show artifacts waiting for review' },
  { id: 'openNotes', label: 'Open notes', title: 'Show artifacts with open notes' },
];

function ArtifactsCounts({ search, reviewFilter = 'all', total, filtered, publishedCount, needsReviewCount }) {
  const filterActive = (search || '').trim().length > 0 || reviewFilter !== 'all';
  const countText = filterActive
    ? `Showing ${filtered} of ${total}`
    : `${total} ${total === 1 ? 'artifact' : 'artifacts'}`;
  return (
    <>
      {countText}
      {publishedCount > 0 && (
        <>
          {' · '}
          <span style={{ color: 'var(--accent)' }}>{publishedCount} published</span>
        </>
      )}
      {needsReviewCount > 0 && (
        <>
          {' · '}
          <span style={{ color: 'var(--warning, var(--accent))' }}>
            {needsReviewCount} {needsReviewCount === 1 ? 'needs' : 'need'} review
          </span>
        </>
      )}
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function projectNameOf(artifact, projects = []) {
  const p = (artifact.path || '');
  const match = projects.find((proj) => {
    if (!proj.path) return false;
    const pre = proj.path.replace(/\/+$/, '') + '/';
    return p.startsWith(pre);
  });
  if (match) return match.name;
  // Fallback — best-effort guess from path. Look for a /projects/X/
  // segment, otherwise just show the parent dir name.
  const m = p.match(/\/projects\/([^/]+)\//);
  if (m) return m[1];
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 2] || '—';
}

function displayName(path) {
  if (!path) return 'Artifact';
  return String(path).split(/[\\/]/).filter(Boolean).pop() || path;
}

// Resolve to the actual project object so the label can navigate
// the user to that project's detail view. Returns null when the
// artifact's path doesn't fall under any known project root — in
// that case the label stays informational (no click affordance).
function projectOf(artifact, projects = []) {
  const p = artifact?.path || '';
  if (!p) return null;
  return projects.find((proj) => {
    if (!proj?.path) return false;
    const pre = proj.path.replace(/\/+$/, '') + '/';
    return p.startsWith(pre);
  }) || null;
}

// Extensions we can preview inline in the in-app ArtifactViewer (text
// branch). Keep in sync with the viewer's own TEXT_PREVIEW_EXTS so the
// click handlers and the body renderer agree on what's previewable.
const _INLINE_TEXT_EXTS = new Set(['.md', '.txt', '.csv']);
function isInlinePreviewable(a) {
  if (!a) return false;
  if (isHtmlArtifact(a)) return true;
  const declared = (a.ext || '').toLowerCase();
  if (_INLINE_TEXT_EXTS.has(declared)) return true;
  const p = (a.path || '').toLowerCase();
  for (const ext of _INLINE_TEXT_EXTS) if (p.endsWith(ext)) return true;
  return false;
}

// "Updated" is already pre-formatted by the server (e.g. "3h ago",
// "Yesterday"). For sorting we need a numeric stamp — fall back to the
// raw `updatedAt` / `mtime` if present, otherwise 0 so unknown items
// sink to the bottom.
function timestampOf(a) {
  const raw = a.updatedAt || a.updated_at || a.mtime || a.modified;
  if (raw == null) return 0;
  if (typeof raw === 'number') return raw;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function shortDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Kind pill — short uppercase tag for the file type. Pulls from
// `artifact.kind` or falls back to the file extension.
function kindOf(a) {
  if (a.kind) return String(a.kind).toLowerCase();
  const ext = (a.ext || '').replace(/^\./, '').toLowerCase();
  return ext || 'file';
}

// Bare extension (no leading dot) — used for the type subtitle on the
// card, where we want `type: html` rather than the broader "kind".
function extensionOf(a) {
  const fromExt = (a.ext || '').replace(/^\./, '').toLowerCase();
  if (fromExt) return fromExt;
  const m = (a.path || '').match(/\.([a-z0-9]+)$/i);
  return (m?.[1] || 'file').toLowerCase();
}

// Pick a representative icon for the artifact based on its extension.
// Mirrors the rough kind buckets server-side: dashboards (HTML), docs
// (md/txt/pdf), code (py/js/css/etc), data (csv/json), images.
function iconForArtifact(a) {
  const ext = extensionOf(a);
  if (ext === 'html' || ext === 'htm') return Ico.globe;
  if (['md', 'txt', 'pdf', 'rtf', 'doc', 'docx'].includes(ext)) return Ico.doc;
  if (['py', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'sh', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h'].includes(ext)) return Ico.code;
  if (['csv', 'json', 'jsonl', 'tsv', 'parquet', 'sqlite', 'db'].includes(ext)) return Ico.database;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico'].includes(ext)) return Ico.image;
  return Ico.doc;
}

function reviewCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function reviewSummaryOf(a) {
  const raw = a?.reviewSummary || a?.review_summary;
  if (!raw || typeof raw !== 'object') {
    return {
      open: 0,
      comments: 0,
      suggestions: 0,
      reviewRequests: 0,
      unresolved: 0,
      needsReview: false,
      openNotes: 0,
      hasReview: false,
      viewerState: { available: false },
      unreadTotal: 0,
      needsAction: 0,
    };
  }
  const open = reviewCount(raw.open);
  const comments = reviewCount(raw.comments);
  const suggestions = reviewCount(raw.suggestions);
  const reviewRequests = reviewCount(raw.reviewRequests ?? raw.review_requests);
  const unresolved = reviewCount(raw.unresolved);
  const viewerState = raw.viewerState || raw.viewer_state || {};
  const unreadComments = reviewCount(viewerState.unreadComments ?? viewerState.unread_comments);
  const unreadActivity = reviewCount(viewerState.unreadActivity ?? viewerState.unread_activity);
  const needsAction = reviewCount(viewerState.needsAction ?? viewerState.needs_action);
  const viewerReviewRequests = viewerState.reviewRequests || viewerState.review_requests || {};
  const unreadReviewRequests = reviewCount(viewerReviewRequests.unread);
  const viewerOpenRequests = reviewCount(viewerReviewRequests.open);
  const needsReview = !!raw.needsReview || !!raw.needs_review || reviewRequests > 0;
  const openNotes = Math.max(open, unresolved);
  const unreadTotal = unreadComments + unreadActivity;
  return {
    open,
    comments,
    suggestions,
    reviewRequests,
    unresolved,
    needsReview,
    openNotes,
    viewerState: {
      ...viewerState,
      unreadComments,
      unreadActivity,
      unreadReviewRequests,
      openReviewRequests: viewerOpenRequests,
      needsAction,
    },
    unreadTotal,
    needsAction,
    hasReview: needsReview || openNotes > 0 || comments > 0 || suggestions > 0 || reviewRequests > 0 || unreadTotal > 0 || needsAction > 0,
  };
}

function reviewSortScore(a, mode = 'needsReview') {
  const s = reviewSummaryOf(a);
  if (mode === 'forYou') {
    return (s.needsAction * 100000) + (s.unreadTotal * 1000) + (s.reviewRequests * 100) + (s.openNotes * 10) + s.suggestions;
  }
  if (mode === 'new') {
    return (s.unreadTotal * 100000) + (s.needsAction * 1000) + (s.reviewRequests * 100) + (s.openNotes * 10) + s.suggestions;
  }
  if (mode === 'openNotes') {
    return (s.openNotes * 1000) + (s.needsAction * 100) + (s.needsReview ? 50 : 0) + (s.suggestions * 10) + s.comments;
  }
  return (s.needsAction * 1000000) + (s.unreadTotal * 10000) + (s.needsReview ? 100000 : 0) + (s.reviewRequests * 1000) + (s.openNotes * 100) + (s.suggestions * 10) + s.comments;
}

function plural(count, singular, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function ReviewBadges({ artifact, compact = false }) {
  const s = reviewSummaryOf(artifact);
  if (!s.hasReview) return null;
  const chips = [];
  if (s.needsAction > 0) {
    chips.push({
      id: 'forYou',
      label: compact ? 'For you' : `${s.needsAction} for you`,
      title: `${s.needsAction} ${s.needsAction === 1 ? 'review request needs' : 'review requests need'} your attention`,
      tone: 'personal',
    });
  }
  if (s.unreadTotal > 0) {
    chips.push({
      id: 'new',
      label: compact ? 'New' : `${s.unreadTotal} new`,
      title: `${s.unreadTotal} new review ${s.unreadTotal === 1 ? 'update' : 'updates'}`,
      tone: 'unread',
    });
  }
  if (s.needsReview) {
    const detail = s.reviewRequests > 0 ? plural(s.reviewRequests, 'review request') : 'Waiting for review';
    chips.push({ id: 'needsReview', label: 'Needs review', title: detail, tone: 'attention' });
  }
  if (s.openNotes > 0) {
    chips.push({
      id: 'openNotes',
      label: compact ? plural(s.openNotes, 'open note') : `${s.openNotes} open ${s.openNotes === 1 ? 'note' : 'notes'}`,
      title: `${s.openNotes} unresolved ${s.openNotes === 1 ? 'note' : 'notes'}`,
      tone: 'note',
    });
  } else if (s.comments > 0) {
    chips.push({
      id: 'notes',
      label: compact ? plural(s.comments, 'note') : `${s.comments} ${s.comments === 1 ? 'note' : 'notes'}`,
      title: `${s.comments} ${s.comments === 1 ? 'note' : 'notes'}`,
      tone: 'muted',
    });
  }
  if (s.suggestions > 0) {
    chips.push({
      id: 'suggestions',
      label: compact ? plural(s.suggestions, 'suggestion') : `${s.suggestions} ${s.suggestions === 1 ? 'suggestion' : 'suggestions'}`,
      title: `${s.suggestions} ${s.suggestions === 1 ? 'suggestion' : 'suggestions'}`,
      tone: 'suggestion',
    });
  }
  if (chips.length === 0) return null;

  const toneStyle = (tone) => {
    if (tone === 'personal') return {
      background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
      borderColor: 'color-mix(in srgb, var(--danger) 32%, transparent)',
      color: 'var(--danger)',
    };
    if (tone === 'unread') return {
      background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
      borderColor: 'color-mix(in srgb, var(--accent) 34%, transparent)',
      color: 'var(--accent)',
    };
    if (tone === 'attention') return {
      background: 'color-mix(in srgb, var(--warning, var(--accent)) 14%, transparent)',
      borderColor: 'color-mix(in srgb, var(--warning, var(--accent)) 36%, transparent)',
      color: 'var(--warning, var(--accent))',
    };
    if (tone === 'suggestion') return {
      background: 'color-mix(in srgb, var(--success) 10%, transparent)',
      borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)',
      color: 'var(--success)',
    };
    if (tone === 'note') return {
      background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
      borderColor: 'color-mix(in srgb, var(--accent) 28%, transparent)',
      color: 'var(--ink-2)',
    };
    return {
      background: 'var(--surface-2)',
      borderColor: 'var(--line)',
      color: 'var(--ink-3)',
    };
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flexWrap: compact ? 'nowrap' : 'wrap',
      minWidth: 0,
      overflow: compact ? 'hidden' : 'visible',
    }}>
      {chips.slice(0, compact ? 2 : 3).map((chip) => (
        <span
          key={chip.id}
          title={chip.title}
          style={{
            ...toneStyle(chip.tone),
            display: 'inline-flex', alignItems: 'center', gap: 4,
            maxWidth: '100%',
            minWidth: 0,
            padding: compact ? '2px 6px' : '3px 7px',
            borderRadius: 999,
            border: '1px solid',
            fontFamily: FONT_BODY,
            fontSize: compact ? 10.5 : 11,
            fontWeight: chip.tone === 'attention' ? 700 : 600,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {(chip.tone === 'attention' || chip.tone === 'personal' || chip.tone === 'unread') && (
            <span style={{
              width: 5, height: 5, borderRadius: 99,
              background: 'currentColor', flexShrink: 0,
            }} />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{chip.label}</span>
        </span>
      ))}
    </div>
  );
}

function ReviewFilter({ value, onChange }) {
  return (
    <div
      aria-label="Review filter"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 0,
        padding: 2, borderRadius: 7,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
      }}
    >
      {REVIEW_FILTER_OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            title={opt.title}
            onClick={() => onChange?.(opt.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 9px', borderRadius: 5,
              background: active ? 'var(--surface-3)' : 'transparent',
              color: active ? 'var(--ink)' : 'var(--ink-3)',
              border: 0,
              boxShadow: active ? 'inset 0 0 0 1px var(--line-2)' : 'none',
              fontFamily: FONT_BODY, fontSize: 12,
              cursor: 'pointer',
              transition: 'background .15s ease, color .15s ease',
            }}
          >
            {opt.id === 'needsReview' ? Ico.eye(12) : opt.id === 'openNotes' ? Ico.chats(12) : null}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ReviewQueueBand({ items, totals, onOpen, onFilter }) {
  if (!items?.length) return null;
  const visibleItems = items.slice(0, 4);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  const totalNeedsAction = totals?.needsAction || 0;
  const totalNew = totals?.unreadTotal || 0;
  const totalOpen = totals?.openNotes || 0;
  const totalSuggestions = totals?.suggestions || 0;
  const totalRequests = totals?.reviewRequests || 0;
  const countParts = [
    totalNeedsAction > 0 ? `${totalNeedsAction} for you` : '',
    totalNew > 0 ? plural(totalNew, 'new update') : '',
    totalRequests > 0 ? plural(totalRequests, 'review request') : '',
    totalOpen > 0 ? plural(totalOpen, 'open note') : '',
    totalSuggestions > 0 ? plural(totalSuggestions, 'suggested change') : '',
  ].filter(Boolean);

  return (
    <section style={{
      marginTop: 14,
      borderTop: '1px solid var(--line)',
      borderBottom: '1px solid var(--line)',
      background: 'color-mix(in srgb, var(--accent) 5%, var(--surface))',
      padding: '14px 32px',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 0.85fr) minmax(0, 1.6fr)',
        gap: 14,
        alignItems: 'stretch',
      }}>
        <div style={{ display: 'grid', gap: 8, alignContent: 'center', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              display: 'inline-grid',
              placeItems: 'center',
              color: 'var(--accent)',
              background: 'color-mix(in srgb, var(--accent) 12%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--accent) 28%, var(--line))',
            }}>
              {Ico.chats(14)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
                Review queue
              </div>
              <div style={{ marginTop: 2, fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.35 }}>
                {countParts.length ? countParts.join(' · ') : 'Items waiting for review'}
              </div>
              {hiddenCount > 0 && (
                <div style={{ marginTop: 3, fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.35 }}>
                  Showing {visibleItems.length} of {items.length}; {plural(hiddenCount, 'artifact')} not shown.
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {totalNeedsAction > 0 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onFilter?.('forYou')}
                style={{ height: 28, padding: '0 9px' }}
              >
                For you
              </button>
            )}
            {totalNew > 0 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onFilter?.('new')}
                style={{ height: 28, padding: '0 9px' }}
              >
                New
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onFilter?.('needsReview')}
              style={{ height: 28, padding: '0 9px' }}
            >
              Needs review
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onFilter?.('openNotes')}
              style={{ height: 28, padding: '0 9px' }}
            >
              Open notes
            </button>
            {hiddenCount > 0 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onFilter?.('needsReview')}
                style={{ height: 28, padding: '0 9px' }}
              >
                View {hiddenCount} more
              </button>
            )}
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 8,
          minWidth: 0,
        }}>
	          {visibleItems.map((artifact) => {
	            const s = reviewSummaryOf(artifact);
	            const title = artifact?.title || displayName(artifact?.path || artifact?.folder || '');
	            const details = [
	              s.needsAction > 0 ? `${s.needsAction} for you` : '',
	              s.unreadTotal > 0 ? plural(s.unreadTotal, 'new update') : '',
	              s.needsReview ? 'Needs review' : '',
	              s.openNotes > 0 ? plural(s.openNotes, 'open note') : '',
	              s.suggestions > 0 ? plural(s.suggestions, 'suggested change') : '',
            ].filter(Boolean).join(' · ');
            return (
              <button
                key={artifact.id || artifact.path}
                type="button"
                onClick={() => onOpen?.(artifact)}
                style={{
                  minWidth: 0,
                  textAlign: 'left',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  background: 'var(--surface)',
                  padding: '9px 10px',
                  cursor: 'pointer',
                  display: 'grid',
                  gap: 5,
                }}
              >
                <span style={{
                  display: 'block',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}>
                  {title}
                </span>
                <span style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 0,
                  fontFamily: FONT_BODY,
                  fontSize: 11.5,
                  color: 'var(--ink-3)',
                }}>
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: s.needsReview ? 'var(--warning, var(--accent))' : 'var(--accent)',
                    flexShrink: 0,
                  }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {details || 'Review activity'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ArtifactModeToggle({ value, onChange, deletedCount = 0 }) {
  const options = [
    { id: 'live', label: 'Live', icon: Ico.eye(12) },
    { id: 'deleted', label: deletedCount > 0 ? `Deleted ${deletedCount}` : 'Deleted', icon: Ico.trash(12) },
  ];
  return (
    <div
      aria-label="Artifact mode"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 0,
        padding: 2, borderRadius: 7,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
      }}
    >
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange?.(opt.id)}
            aria-pressed={active}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 9px', borderRadius: 5,
              background: active ? 'var(--surface-3)' : 'transparent',
              color: active ? 'var(--ink)' : 'var(--ink-3)',
              border: 0,
              boxShadow: active ? 'inset 0 0 0 1px var(--line-2)' : 'none',
              fontFamily: FONT_BODY, fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Action button (used by the bubble's bottom row) ─────────────────────

function ActionButton({ children, onClick, danger, primary, title }) {
  const styleBase = {
    cursor: 'pointer',
    fontFamily: FONT_BODY, fontSize: 12, fontWeight: 500,
    padding: '6px 10px', borderRadius: 7,
    display: 'inline-flex', alignItems: 'center', gap: 5,
    transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
  };
  if (primary) Object.assign(styleBase, {
    background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)',
  });
  else if (danger) Object.assign(styleBase, {
    background: 'transparent', color: 'var(--danger)',
    border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
  });
  else Object.assign(styleBase, {
    background: 'transparent', color: 'var(--ink-2)', border: '1px solid var(--line)',
  });
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick?.(); }} title={title} style={styleBase}>
      {children}
    </button>
  );
}

// ─── Published pill + URL row (shared between grid + list) ───────────────

// `mode` adds a glyph + tooltip so a password-protected or restricted publish
// is distinguishable from a public one everywhere the pill shows. Falls back to
// the legacy `protected` boolean for artifacts without an explicit accessMode.
function PublishedPill({ mode, protected: isProtected = false }) {
  const effectiveMode = mode && mode !== 'public' ? mode : (isProtected ? 'password' : 'public');
  const isRestricted = effectiveMode === 'restricted';
  const isPwd = effectiveMode === 'password';
  return (
    <span
      title={isRestricted ? 'Published — restricted to selected people'
        : isPwd ? 'Published — password protected' : 'Published'}
      style={{
        background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
        color: 'var(--accent)',
        padding: '1px 6px', borderRadius: 999,
        fontSize: 9, fontWeight: 700,
        lineHeight: 1.2,
        display: 'inline-flex', alignItems: 'center', gap: 4,
        flexShrink: 0,
        letterSpacing: '0.05em', textTransform: 'uppercase',
        fontFamily: FONT_BODY,
      }}
    >
      {isRestricted
        ? <span style={{ display: 'inline-flex' }}>{Ico.people(9)}</span>
        : isPwd
          ? <span style={{ display: 'inline-flex' }}>{Ico.lock(9)}</span>
          : <span style={{ width: 4, height: 4, borderRadius: 99, background: 'var(--accent)' }} />}
      Published
    </span>
  );
}

// Loose-but-practical email shape check. Splits on whitespace, commas and
// semicolons; trims, lowercases and de-dupes; partitions into valid/invalid.
const _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function parseEmailList(raw) {
  const parts = (raw || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    (_EMAIL_RE.test(p) ? valid : invalid).push(p);
  }
  return { valid, invalid };
}

// Publish visibility chooser — Public / Password-protected / For selected
// users (emails + org). On confirm it hands back an access object
// ({ mode, ... }). Re-publishing pre-fills the existing selection (password is
// revealable via the eye; emails/org come from the server's owner-side state).
function PublishDialog({ artifact, onCancel, onConfirm }) {
  const [mode, setMode] = useState(artifact?.accessMode || (artifact?.accessProtected ? 'password' : 'public'));
  const [password, setPassword] = useState(artifact?.accessPassword || '');
  const [reveal, setReveal] = useState(false);
  const [emailsText, setEmailsText] = useState((artifact?.accessEmails || []).join(', '));
  const [orgAllowed, setOrgAllowed] = useState(!!artifact?.orgAllowed);
  if (!artifact) return null;

  const { valid: parsedEmails, invalid: invalidEmails } = parseEmailList(emailsText);
  const reviewSummary = reviewSummaryOf(artifact);
  const publishedVersion = artifact?.publishedVersionNumber
    ? `Version ${artifact.publishedVersionNumber}`
    : artifact?.publishedVersionId
      ? `Version ${String(artifact.publishedVersionId).slice(0, 8)}`
      : '';
  const selectedPublishVersion = artifact?.publishVersionLabel
    || (artifact?.publishVersionId ? `Version ${String(artifact.publishVersionId).slice(0, 8)}` : '');
  const preflightRows = [
    artifact?.publishedUrl
      ? {
        label: 'Replacing the public copy',
        detail: `${selectedPublishVersion || publishedVersion || 'The selected saved version'} will replace the public copy only after this publish succeeds.`,
        tone: 'ok',
      }
      : {
        label: selectedPublishVersion ? 'Publishing selected version' : 'Publishing a saved snapshot',
        detail: selectedPublishVersion
          ? `${selectedPublishVersion} will be pinned to the public link.`
          : 'Cowork will publish a versioned copy, not a moving local folder.',
        tone: 'ok',
      },
    reviewSummary.openNotes > 0
      ? {
        label: 'Open review items',
        detail: [
          reviewSummary.openNotes ? plural(reviewSummary.openNotes, 'open note') : '',
          reviewSummary.suggestions ? plural(reviewSummary.suggestions, 'suggested change') : '',
          reviewSummary.reviewRequests ? plural(reviewSummary.reviewRequests, 'review request') : '',
        ].filter(Boolean).join(' · '),
        tone: 'warning',
      }
      : {
        label: 'Review is clear',
        detail: 'No open review notes are attached to this artifact.',
        tone: 'ok',
      },
  ];
  const canConfirm =
    mode === 'public'
    || (mode === 'password' && password.trim().length > 0)
    || (mode === 'restricted' && (parsedEmails.length > 0 || orgAllowed));
  const submit = () => {
    if (!canConfirm) return;
    if (mode === 'restricted') onConfirm({ mode: 'restricted', emails: parsedEmails, org_allowed: orgAllowed });
    else if (mode === 'password') onConfirm({ mode: 'password', password: password.trim() });
    else onConfirm({ mode: 'public' });
  };

  const Option = ({ value, icon, title, desc }) => {
    const active = mode === value;
    return (
      <button type="button" onClick={() => setMode(value)} style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', width: '100%',
        padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
        background: active ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface-2)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
        transition: 'background 120ms ease, border-color 120ms ease',
      }}>
        <span style={{ display: 'inline-flex', color: active ? 'var(--accent)' : 'var(--ink-3)', marginTop: 1 }}>{icon}</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{title}</span>
          <span style={{ display: 'block', fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{desc}</span>
        </span>
      </button>
    );
  };

  return (
    <Modal open onClose={onCancel} size="sm" width="min(440px, 94vw)" maxHeight="min(600px, 90vh)" labelledBy="publish-dialog-title">
      <ModalHeader
        id="publish-dialog-title"
        title={artifact?.publishedUrl ? 'Update public copy' : 'Publish artifact'}
        subtitle={[artifact.title || artifact.path?.split('/').pop(), selectedPublishVersion].filter(Boolean).join(' · ')}
        onClose={onCancel}
      />
      <ModalBody>
        <div style={{
          marginBottom: 12,
          border: '1px solid var(--line)',
          borderRadius: 8,
          background: 'var(--surface-2)',
          overflow: 'hidden',
        }}>
          {preflightRows.map((row) => (
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
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Option value="public" icon={Ico.globe(16)} title="Public" desc="Anyone with the link can view it." />
          <Option value="password" icon={Ico.lock(16)} title="Password protected" desc="Visitors must enter a password to view it." />
          <Option value="restricted" icon={Ico.people(16)} title="For selected users" desc="Only people you list — or your whole org — can view it." />
        </div>
        {mode === 'password' && (
          <div style={{ marginTop: 12 }}>
            <label style={{
              display: 'block', fontFamily: FONT_BODY, fontSize: 11, color: 'var(--ink-3)',
              marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>Password</label>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--surface-2)', border: '1px solid var(--line)',
              borderRadius: 8, padding: '0 8px 0 10px',
            }}>
              <input
                type={reveal ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                autoFocus
                placeholder="Enter a password"
                style={{
                  flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none',
                  color: 'var(--ink)', fontFamily: FONT_MONO, fontSize: 13, padding: '9px 0',
                }}
              />
              <button type="button" onClick={() => setReveal((v) => !v)} title={reveal ? 'Hide' : 'Show'}
                style={{ background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--ink-4)', display: 'inline-flex', padding: 4 }}>
                {reveal ? Ico.eyeOff(15) : Ico.eye(15)}
              </button>
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>
              You can view this password anytime from the artifact’s preview.
            </div>
          </div>
        )}
        {mode === 'restricted' && (
          <div style={{ marginTop: 12 }}>
            <label style={{
              display: 'block', fontFamily: FONT_BODY, fontSize: 11, color: 'var(--ink-3)',
              marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>Allowed emails</label>
            <textarea
              value={emailsText}
              onChange={(e) => setEmailsText(e.target.value)}
              autoFocus
              rows={3}
              placeholder="alice@acme.com, bob@acme.com"
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical',
                background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8,
                color: 'var(--ink)', fontFamily: FONT_MONO, fontSize: 13, padding: '9px 10px', outline: 'none',
              }}
            />
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>
              {parsedEmails.length} recipient{parsedEmails.length === 1 ? '' : 's'}
              {invalidEmails.length ? ` · ${invalidEmails.length} invalid ignored` : ''}
              {' '}· comma- or newline-separated.
            </div>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer',
              fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink)',
            }}>
              <input
                type="checkbox"
                checked={orgAllowed}
                onChange={(e) => setOrgAllowed(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Everyone in my organization
            </label>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onCancel} style={{
          cursor: 'pointer', background: 'transparent', border: '1px solid var(--line)',
          color: 'var(--ink-2)', padding: '8px 14px', borderRadius: 8, fontFamily: FONT_BODY, fontSize: 13,
        }}>Cancel</button>
        <button type="button" onClick={submit} disabled={!canConfirm} style={{
          cursor: canConfirm ? 'pointer' : 'not-allowed',
          background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff',
          padding: '8px 16px', borderRadius: 8, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13,
          opacity: canConfirm ? 1 : 0.5,
        }}>
          {mode === 'password' ? 'Publish protected' : mode === 'restricted' ? 'Publish restricted' : 'Publish'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

function PublishedUrlRow({ url, onOpen, onCopy }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e) => {
    e.stopPropagation();
    // The parent's onCopy returns a boolean indicating whether the
    // copy actually landed in the clipboard. Only flip the icon on
    // success — otherwise we were lying to the user about it working.
    const ok = await onCopy?.();
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };
  const display = url.replace(/^https?:\/\//, '');
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 0,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
        title={`Open in browser: ${url}`}
        style={{
          flex: 1, minWidth: 0,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '7px 10px',
          background: 'transparent', border: 0, cursor: 'pointer',
          fontFamily: FONT_BODY, fontSize: 12,
          color: 'var(--ink-2)', textAlign: 'left',
          transition: 'color 120ms ease, background 120ms ease',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.color = 'var(--accent)';
          e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 8%, transparent)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.color = 'var(--ink-2)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--accent)' }}>
          {Ico.externalLink(13)}
        </span>
        <span style={{
          minWidth: 0, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {display}
        </span>
      </button>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? 'Copied' : 'Copy URL'}
        style={{
          flexShrink: 0,
          padding: '7px 10px',
          background: 'transparent',
          border: 0, borderLeft: '1px solid var(--line)',
          cursor: 'pointer',
          color: copied ? 'var(--accent)' : 'var(--ink-3)',
          display: 'inline-flex', alignItems: 'center',
          transition: 'color 120ms ease, background 120ms ease',
        }}
        onMouseOver={(e) => {
          if (!copied) e.currentTarget.style.color = 'var(--ink)';
          e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 8%, transparent)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.color = copied ? 'var(--accent)' : 'var(--ink-3)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {copied ? Ico.check(13) : Ico.copy(13)}
      </button>
    </div>
  );
}

// ─── Card / Bubble (grid view) ───────────────────────────────────────────

// Static path row used in place of the published URL pill when the
// artifact is local-only. Mirrors the URL pill's surface so the card
// keeps a consistent slot height as state flips between published
// and not. Ellipsis-truncates a long path; full path lives in the
// `title` attribute for hover. RTL trick on the path span keeps the
// filename visible (truncates the front, not the back).
//
// Left-to-right mark (U+200E). The `direction: rtl` trick below would
// otherwise let the bidi algorithm relocate an absolute path's leading
// "/" to the visual end, rendering a bogus trailing slash. Prefixing the
// path with a strong-LTR mark pins the leading slash in place.
const LTR_MARK = String.fromCharCode(0x200e);

function LocalPathRow({ path }) {
  if (!path) return null;
  return (
    <div
      title={path}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 8,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        minWidth: 0,
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--ink-4)' }}>
        {Ico.folder(12)}
      </span>
      <span style={{
        flex: 1, minWidth: 0,
        fontFamily: FONT_MONO, fontSize: 11.5,
        color: 'var(--ink-3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        direction: 'rtl', textAlign: 'left',
      }}>{LTR_MARK + path}</span>
    </div>
  );
}

function ArtifactBubble({ artifact, projects = [], onOpenViewer, onMenuOpen, isMenuOpen, busy, onOpenProject }) {
  const isHtml = isHtmlArtifact(artifact);
  const canPreview = isInlinePreviewable(artifact);
  const published = !!artifact.publishedUrl;
  // In the browser the artifact's address is its HTTP serve URL, not a
  // local OS path the user can't reach. Surface that "private" URL in
  // place of the path. Desktop keeps showing the local path.
  const privateUrl = host.isWeb ? artifactServeUrl(artifact) : '';
  // For fullstack apps the artifact "is" its slug folder, not the entry
  // html — show the folder path on the card. Falls back to the primary
  // path for everything else (and if `folder` is somehow absent).
  const localPath = isBackendArtifact(artifact) ? (artifact.folder || artifact.path) : artifact.path;

  const { revealed: showControls, hoverProps } = useRevealOnHover(isMenuOpen);
  const kebabRef = useRef(null);

  const onCopyUrl = async () => {
    if (!published) return false;
    return copyText(artifact.publishedUrl);
  };
  const onOpenPublished = async () => {
    if (!published) return;
    try { await host.openExternal(artifact.publishedUrl); } catch {
      window.open(artifact.publishedUrl, '_blank', 'noreferrer');
    }
  };
  const onCopyPrivate = async () => {
    if (!privateUrl) return false;
    return copyText(privateUrl);
  };
  const onOpenPrivate = async () => {
    if (!privateUrl) return;
    try { await host.openExternal(privateUrl); } catch {
      window.open(privateUrl, '_blank', 'noreferrer');
    }
  };

  const Icon = iconForArtifact(artifact);
  const ext = extensionOf(artifact);
  const projectLabel = projectNameOf(artifact, projects);
  // The project the artifact belongs to. When resolved, the project
  // label becomes a clickable affordance (renders as a button) that
  // navigates the user to that project's detail page.
  const projectMatch = projectOf(artifact, projects);
  const canOpenProject = !!(projectMatch && typeof onOpenProject === 'function');

  // Hand the click off to the parent — it owns the single shared
  // menu so the dropdown isn't rendered inside the card (cards
  // apply `transform` on hover, which would re-anchor a
  // position:fixed descendant to the card instead of the viewport).
  const openMenu = (e) => {
    e.stopPropagation();
    if (!kebabRef.current) return;
    onMenuOpen?.(artifact, kebabRef.current.getBoundingClientRect());
  };

  return (
    <div
      role="button"
      tabIndex={0}
      {...hoverProps}
      onClick={() => canPreview ? onOpenViewer(artifact) : openArtifactFile(artifact)}
      onKeyDown={(e) => { if (e.key === 'Enter') (canPreview ? onOpenViewer(artifact) : openArtifactFile(artifact)); }}
      style={{
        position: 'relative',
        cursor: 'pointer',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        // Card geometry matches ProjectCard so the two grids feel
        // like the same family: 10px radius, 14/16 padding, 120 min
        // height, 10px column gap.
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 10,
        transition: 'border-color 160ms ease, box-shadow 200ms ease, transform 160ms ease',
        boxShadow: '0 1px 0 rgba(15,16,17,0.02)',
        minHeight: 120,
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.boxShadow = '0 1px 0 rgba(15,16,17,0.02), 0 12px 28px rgba(15,16,17,0.08)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = 'var(--line)';
        e.currentTarget.style.boxShadow = '0 1px 0 rgba(15,16,17,0.02)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Top-right cluster: status pill (left) + hover-revealed
          kebab (right). The kebab is always rightmost so the user's
          eye finds it in the same place regardless of pill state.
          We toggle `visibility` (not display/opacity-without-space)
          so the pill keeps its X position whether the kebab is
          showing or not. */}
      <div style={{
        position: 'absolute', top: 12, right: 12,
        display: 'flex', alignItems: 'center', gap: 6,
        zIndex: 2,
      }}>
        {(published || artifact.live) && (
          <span style={{ pointerEvents: 'none' }}>
            {published ? <PublishedPill mode={artifact.accessMode} protected={!!artifact.accessProtected} /> : (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontFamily: FONT_BODY, fontSize: 11,
                color: 'var(--accent)', fontWeight: 500,
                border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
                padding: '3px 8px', borderRadius: 999,
              }}>
                <span className="pulse-dot" style={{
                  width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
                }} />
                Live
              </span>
            )}
          </span>
        )}
        <button
          ref={kebabRef}
          type="button"
          aria-label="Artifact menu"
          title="More actions"
          // Stop propagation on BOTH mousedown and click — the card
          // itself is a click-able role="button" that opens the
          // artifact, and a single `e.stopPropagation()` inside
          // onClick wasn't reliably preventing the parent handler in
          // every state (e.g. when the kebab was rendered while
          // visibility was just transitioning).
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); openMenu(e); }}
          style={{
            width: 26, height: 26, borderRadius: 6,
            display: 'inline-grid', placeItems: 'center',
            color: 'var(--ink-3)',
            background: 'transparent', border: 0, padding: 0,
            cursor: 'pointer',
            visibility: showControls ? 'visible' : 'hidden',
            transition: 'background 120ms ease, color 120ms ease',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'var(--surface-2)';
            e.currentTarget.style.color = 'var(--ink)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--ink-3)';
          }}
        >
          {Ico.moreVert(14)}
        </button>
      </div>

      {/* Header: small inline icon + title, with `type: <ext>` mono
          subtitle directly under it. The kebab + status badge cluster
          floats absolute at the top-right; we reserve right padding
          so a long title can't overlap them. The kebab is always
          there in layout (even when hidden) so the padding doesn't
          jump on hover. */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
        paddingRight: (published || artifact.live) ? 110 : 40,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7, minWidth: 0,
        }}>
          <span style={{
            display: 'inline-flex', flexShrink: 0,
            color: 'var(--ink-3)',
          }}>
            {/* Icons take size as a positional arg — calling
                `Icon(14)` returns the rendered SVG at the right size.
                The earlier `<Icon size={20} />` was rendering each
                glyph at its 100%-width fallback (huge). */}
            {Icon(14)}
          </span>
          <span style={{
            fontFamily: FONT_DISPLAY, fontSize: 14.5, fontWeight: 600,
            color: 'var(--ink)', minWidth: 0, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{artifact.title}</span>
        </div>
        {/* Description — agent-supplied at create_artifact time. Two-
            line clamp keeps the card height stable across artifacts
            with short and long descriptions; the full text is in the
            modal viewer. */}
        {artifact.description && (
          <span
            title={artifact.description}
            style={{
              fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-3)',
              lineHeight: 1.4,
              display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {artifact.description}
          </span>
        )}
        {/* project: <name> — sits above the type line so the workspace
            origin reads first. Ellipsis-truncates so a long project
            name can't push the card out of grid alignment; full name
            is in `title` for hover. */}
        <span
          title={projectLabel}
          style={{
            fontFamily: FONT_MONO, fontSize: 11,
            color: 'var(--ink-4)', letterSpacing: '0.04em',
            display: 'flex', alignItems: 'baseline', gap: 4,
            minWidth: 0,
          }}
        >
          <span style={{ flexShrink: 0 }}>project:</span>
          {canOpenProject ? (
            <button
              type="button"
              // Same mousedown+click+keydown hardening the list row uses —
              // the grid card's outer `<div role="button">` opens the
              // artifact viewer, and we don't want the project click
              // to fall through to that.
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenProject(projectMatch);
                }
              }}
              title={`Open ${projectMatch.name}`}
              style={{
                all: 'unset', cursor: 'pointer',
                color: 'var(--ink-3)', minWidth: 0, flex: '0 1 auto',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                transition: 'color 120ms ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.color = 'var(--accent)';
                e.currentTarget.style.textDecoration = 'underline';
                e.currentTarget.style.textUnderlineOffset = '2px';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.color = 'var(--ink-3)';
                e.currentTarget.style.textDecoration = 'none';
              }}
            >{projectLabel}</button>
          ) : (
            <span style={{
              color: 'var(--ink-3)', minWidth: 0, flex: '0 1 auto',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{projectLabel}</span>
          )}
        </span>
        {/* type line — prefer the artifact's declared `type` (e.g.
            `html-app`, `fullstack-stateless-app`) since that's the
            metadata's source of truth; fall back to the bare
            extension for legacy artifacts that predate the rename.
            file-count chip surfaces multi-file artifacts at a glance
            without competing with the title for space. */}
        <span style={{
          fontFamily: FONT_MONO, fontSize: 11,
          color: 'var(--ink-4)', letterSpacing: '0.04em',
          display: 'flex', alignItems: 'baseline', gap: 8,
          minWidth: 0,
        }}>
          <span>
            type: <span style={{ color: 'var(--ink-3)' }}>{artifact.type || ext}</span>
          </span>
          {typeof artifact.fileCount === 'number' && artifact.fileCount > 1 && (
            <span title={`${artifact.fileCount} files in this artifact`}>
              · <span style={{ color: 'var(--ink-3)' }}>{artifact.fileCount} files</span>
            </span>
          )}
        </span>
        <ReviewBadges artifact={artifact} />
      </div>

      {/* Surface the public URL when published; otherwise the HTTP
          serve ("private") URL in the browser, where the artifact lives
          on the server rather than on this machine; falling back to the
          local OS path on desktop. Every card shows where the artifact
          actually lives. */}
      {published ? (
        <PublishedUrlRow
          url={artifact.publishedUrl}
          onOpen={onOpenPublished}
          onCopy={onCopyUrl}
        />
      ) : privateUrl ? (
        <PublishedUrlRow
          url={privateUrl}
          onOpen={onOpenPrivate}
          onCopy={onCopyPrivate}
        />
      ) : (
        <LocalPathRow path={localPath} />
      )}

      {/* Spacer pushes the meta + actions to the bottom of the card so
          the layout stays stable across cards of varying state. */}
      <div style={{ flex: 1 }} />

      <div style={{
        fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.04em',
        color: 'var(--ink-4)',
      }}>
        {artifact.updated || '—'}
      </div>
      {/* The shared HoverMenu lives at the page level (parent
          owns the menu state) — see the comment on
          components/collection/HoverMenu for why this matters. */}
    </div>
  );
}

// ─── List view ───────────────────────────────────────────────────────────

// Status dot · Title · Published · Review · Type · Kind · Project · Updated · ⋯
//
// `Type` is the bare file extension (html, csv, png, …) and lives
// before `Kind` (the broader category — Dashboard, Data, Image, …)
// so the at-a-glance scan reads from concrete to abstract.
const LIST_GRID = '24px minmax(150px, 2fr) 100px minmax(120px, 0.85fr) 60px 70px minmax(110px, 1fr) 110px 36px';

function ListHeaderRow() {
  const Cell = ({ children, align }) => (
    <div style={{
      fontFamily: FONT_MONO, fontSize: 10.5,
      color: 'var(--ink-4)', letterSpacing: '0.10em',
      textTransform: 'uppercase',
      textAlign: align || 'left',
    }}>{children}</div>
  );
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: LIST_GRID, gap: 14,
      padding: '10px 14px',
      borderBottom: '1px solid var(--line)',
    }}>
      <Cell />
      <Cell>Title</Cell>
      <Cell>Published</Cell>
      <Cell>Review</Cell>
      <Cell>Type</Cell>
      <Cell>Kind</Cell>
      <Cell>Project</Cell>
      <Cell>Updated</Cell>
      <Cell />
    </div>
  );
}

function StatusDot({ artifact }) {
  const published = !!artifact.publishedUrl;
  if (published) {
    return (
      <span aria-label="Published" title="Published" style={{
        width: 8, height: 8, borderRadius: 99,
        background: 'var(--accent)',
        boxShadow: '0 0 6px var(--accent-glow)',
        flexShrink: 0,
      }} />
    );
  }
  if (artifact.live) {
    return (
      <span aria-label="Live preview" title="Live preview" className="pulse-dot" style={{
        width: 8, height: 8, borderRadius: 99,
        background: 'var(--success)',
        boxShadow: '0 0 6px var(--success-glow)',
        flexShrink: 0,
      }} />
    );
  }
  return (
    <span style={{
      width: 8, height: 8, borderRadius: 99,
      background: 'var(--ink-5)', flexShrink: 0,
    }} />
  );
}

function RowMenu({ open, anchorRect, artifact, onClose, onOpen, onReveal, onDownload, onExport, onCopyUrl, onPublish, onUnpublish, onDelete, isMacPlatform = false }) {
  const isHtml = isHtmlArtifact(artifact);
  const published = !!artifact.publishedUrl;
  const canExport = !!onExport && canExportArtifact(artifact);
  const items = [
    {
      id: 'open',
      label: isHtml ? 'Open viewer' : 'Open',
      icon: Ico.externalLink(13),
      onClick: onOpen,
    },
    onReveal && {
      id: 'reveal',
      label: isMacPlatform ? 'Show in Finder' : 'Show in Explorer',
      icon: Ico.folder(13),
      onClick: onReveal,
    },
    onDownload && artifact?.serveUrl && {
      id: 'download',
      label: 'Download',
      icon: Ico.download(13),
      onClick: onDownload,
    },
    canExport && {
      id: 'export',
      label: 'Download as',
      icon: Ico.download(13),
      submenu: EXPORT_FORMATS.map((f) => ({
        id: `export-${f.id}`,
        label: f.label,
        icon: Ico.download(13),
        disabled: !canExportFormat(artifact, f.id),
        onClick: () => onExport(f.id),
      })),
    },
    published && {
      id: 'copy-url',
      label: 'Copy URL',
      icon: Ico.copy(13),
      onClick: onCopyUrl,
    },
    isPublishableArtifact(artifact) && !published && {
      id: 'publish',
      label: 'Publish',
      icon: Ico.upload(13),
      onClick: onPublish,
    },
    published && {
      id: 'unpublish',
      label: 'Unpublish',
      icon: Ico.upload(13),
      onClick: onUnpublish,
    },
    onDelete && { divider: true },
    onDelete && {
      id: 'delete',
      label: 'Delete artifact',
      icon: Ico.trash(13),
      danger: true,
      onClick: onDelete,
    },
  ].filter(Boolean);

  return (
    <HoverMenu
      open={open}
      anchorRect={anchorRect}
      onClose={onClose}
      width={200}
      items={items}
    />
  );
}

function ArtifactRow({ artifact, projects, onOpenViewer, onPublish: doPublish, onUnpublish: doUnpublish, onDelete: doDelete, onExport: doExport, onOpenProject }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const triggerRef = useRef(null);
  const { hovered, revealed: showKebab, hoverProps } = useRevealOnHover(menuOpen);

  const isHtml = isHtmlArtifact(artifact);
  const canPreview = isInlinePreviewable(artifact);
  const published = !!artifact.publishedUrl;
  const project = projectNameOf(artifact, projects);
  const projectMatch = projectOf(artifact, projects);
  const canOpenProject = !!(projectMatch && typeof onOpenProject === 'function');

  const onCopyUrl = async () => {
    if (!published) return false;
    return copyText(artifact.publishedUrl);
  };
  const onRowOpen = () => {
    if (canPreview) onOpenViewer?.(artifact);
    else openArtifactFile(artifact);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onRowOpen}
        onKeyDown={(e) => { if (e.key === 'Enter') onRowOpen(); }}
        {...hoverProps}
        style={{
          display: 'grid', gridTemplateColumns: LIST_GRID, gap: 14,
          padding: '12px 14px',
          background: hovered ? 'var(--surface)' : 'transparent',
          borderBottom: '1px solid var(--line)',
          cursor: 'pointer',
          transition: 'background .12s ease',
          alignItems: 'center',
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <StatusDot artifact={artifact} />
        </div>

        <div style={{
          fontFamily: FONT_DISPLAY, fontSize: 14.5, fontWeight: 600,
          color: 'var(--ink)', minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{artifact.title}</div>

        {/* Published column — pill when published, Live indicator when
            actively streaming, em-dash for plain local artifacts. Keeps
            the column width fixed so rows align cleanly. */}
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          {published ? (
            <PublishedPill mode={artifact.accessMode} protected={!!artifact.accessProtected} />
          ) : artifact.live ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontFamily: FONT_BODY, fontSize: 11, color: 'var(--accent)', fontWeight: 500,
              flexShrink: 0,
            }}>
              <span className="pulse-dot" style={{
                width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)',
              }} />
              Live
            </span>
          ) : (
            <span style={{ color: 'var(--ink-5)', fontFamily: FONT_MONO, fontSize: 11 }}>—</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <ReviewBadges artifact={artifact} compact />
        </div>

        {/* Type — prefer the metadata-declared `type` (html-app,
            fullstack-stateless-app, …); fall back to the primary
            file's extension for legacy artifacts. Mono + uppercase
            so it reads as a tag rather than a label. */}
        <div
          title={artifact.type || extensionOf(artifact)}
          style={{
            fontFamily: FONT_MONO, fontSize: 11,
            color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >{artifact.type || extensionOf(artifact)}</div>

        <div style={{
          fontFamily: FONT_MONO, fontSize: 11,
          color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{kindOf(artifact)}</div>

        <div style={{
          fontFamily: FONT_BODY, fontSize: 12.5,
          color: 'var(--ink-2)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          minWidth: 0,
        }}>
          {canOpenProject ? (
            <button
              type="button"
              // Stop propagation on BOTH mousedown and click — the
              // surrounding row is a `role="button"` whose onClick
              // opens the artifact, and a single onClick stopPropagation
              // wasn't reliably preventing the row handler from firing
              // first. Same defensive pattern the kebab uses.
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
              onKeyDown={(e) => {
                // Block keyboard Enter / Space from also bubbling to
                // the row's `onKeyDown` (which would re-open the
                // artifact). Activates the navigation in-place.
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenProject(projectMatch);
                }
              }}
              title={`Open ${projectMatch.name}`}
              style={{
                all: 'unset', cursor: 'pointer',
                color: 'var(--ink-2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: '100%', display: 'inline-block',
                transition: 'color 120ms ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.color = 'var(--accent)';
                e.currentTarget.style.textDecoration = 'underline';
                e.currentTarget.style.textUnderlineOffset = '2px';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.color = 'var(--ink-2)';
                e.currentTarget.style.textDecoration = 'none';
              }}
            >{project}</button>
          ) : project}
        </div>

        <div style={{
          fontFamily: FONT_MONO, fontSize: 11,
          color: 'var(--ink-4)', letterSpacing: '0.04em',
        }}>{artifact.updated || '—'}</div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            ref={triggerRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setAnchorRect(triggerRef.current?.getBoundingClientRect() || null);
              setMenuOpen(true);
            }}
            aria-label="Artifact menu"
            style={{
              width: 26, height: 26, borderRadius: 6,
              background: 'transparent', border: 0,
              color: 'var(--ink-3)',
              opacity: showKebab ? 1 : 0,
              display: 'inline-grid', placeItems: 'center',
              cursor: 'pointer',
              transition: 'opacity .15s ease, color .15s ease, background .15s ease',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3)'; }}
          >
            {Ico.moreVert(15)}
          </button>
        </div>
      </div>

      <RowMenu
        open={menuOpen}
        anchorRect={anchorRect}
        artifact={artifact}
        onClose={() => setMenuOpen(false)}
        onOpen={onRowOpen}
        onReveal={host.isWeb ? undefined : () => { try { revealArtifact(artifact.path); } catch { } }}
        onDownload={() => downloadArtifactFile(artifact)}
        onExport={doExport ? (format) => doExport(artifact, format) : undefined}
        onCopyUrl={onCopyUrl}
        onPublish={() => doPublish?.(artifact)}
        onUnpublish={() => doUnpublish?.(artifact)}
        onDelete={doDelete ? () => doDelete(artifact) : undefined}
        isMacPlatform={host.isMac() || /Mac|iPhone|iPod|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')}
      />
    </>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────

function EmptyState({ agentLabel = 'the agent' }) {
  return (
    <div style={{
      flex: 1, minHeight: 360,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '40px 24px',
    }}>
      <span style={{ display: 'inline-flex', color: 'var(--ink-5)' }}>{Ico.sparkle(32)}</span>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
        No artifacts yet
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: 'var(--ink-3)', maxWidth: 380, textAlign: 'center' }}>
        When {agentLabel} creates documents, dashboards, or code outputs they'll appear here.
      </div>
    </div>
  );
}

function DeletedArtifactCard({ artifact, busy, onRestore }) {
  const title = artifact?.title || artifact?.name || artifact?.slug || 'Deleted artifact';
  const deletedAt = shortDateTime(artifact?.deletedAt || artifact?.deleted_at);
  const fileCount = typeof artifact?.fileCount === 'number' ? artifact.fileCount : null;
  const canRestore = !!(artifact?.restoreEligible && artifact?.artifactId && artifact?.preDeleteVersionId);
  return (
    <article style={{
      minWidth: 0,
      border: '1px solid var(--line)',
      borderRadius: 8,
      background: 'color-mix(in srgb, var(--surface) 88%, var(--surface-2))',
      padding: 14,
      display: 'grid',
      gap: 10,
      boxShadow: '0 10px 26px rgba(0,0,0,.06)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', gap: 9, alignItems: 'start' }}>
        <span style={{
          width: 24,
          height: 24,
          display: 'inline-grid',
          placeItems: 'center',
          borderRadius: 8,
          background: 'color-mix(in srgb, var(--danger) 9%, var(--surface))',
          color: 'var(--danger)',
          border: '1px solid color-mix(in srgb, var(--danger) 22%, var(--line))',
        }}>
          {Ico.trash(13)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div title={title} style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {title}
          </div>
          <div style={{
            marginTop: 3,
            fontFamily: FONT_BODY,
            fontSize: 12,
            color: 'var(--ink-4)',
            display: 'flex',
            gap: 7,
            flexWrap: 'wrap',
          }}>
            {deletedAt && <span>Deleted {deletedAt}</span>}
            {fileCount != null && <span>{fileCount} {fileCount === 1 ? 'file' : 'files'}</span>}
          </div>
        </div>
      </div>
      <div title={artifact?.path || ''} style={{
        minWidth: 0,
        border: '1px solid var(--line)',
        borderRadius: 7,
        background: 'var(--surface-2)',
        color: 'var(--ink-4)',
        padding: '7px 8px',
        fontFamily: FONT_MONO,
        fontSize: 10.5,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {artifact?.path || artifact?.slug || 'No path recorded'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ActionButton
          primary
          title={canRestore ? 'Restore artifact' : 'This deleted artifact cannot be restored'}
          onClick={() => canRestore && onRestore?.(artifact)}
        >
          {busy ? 'Restoring...' : 'Restore'}
        </ActionButton>
      </div>
    </article>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────
//
// Inline banner that surfaces publish / unpublish results so failures
// (most commonly a missing ANTON_MINDS_API_KEY) don't disappear into
// the console. Auto-dismisses after a few seconds; success and error
// share the layout but have distinct accent / danger tints.

function Toast({ kind, message, actionLabel, onAction, onClose }) {
  if (!message) return null;
  const isError = kind === 'error';
  return (
    <div style={{
      // Position is owned by the parent wrapper now (fixed overlay),
      // so this card carries no outer margin.
      padding: '10px 14px',
      borderRadius: 8,
      background: isError
        ? 'color-mix(in srgb, var(--danger) 12%, var(--surface))'
        : 'color-mix(in srgb, var(--accent) 12%, var(--surface))',
      border: `1px solid ${isError ? 'color-mix(in srgb, var(--danger) 40%, transparent)' : 'color-mix(in srgb, var(--accent) 40%, transparent)'}`,
      color: isError ? 'var(--danger)' : 'var(--ink-2)',
      display: 'flex', alignItems: 'center', gap: 10,
      fontFamily: FONT_BODY, fontSize: 12.5,
    }}>
      <span style={{ display: 'inline-flex', flexShrink: 0, color: isError ? 'var(--danger)' : 'var(--accent)' }}>
        {isError ? Ico.alert?.(14) || Ico.trash(14) : Ico.check(14)}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{message}</span>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          style={{
            flexShrink: 0,
            height: 26,
            padding: '0 8px',
            borderRadius: 7,
            border: '1px solid var(--line)',
            background: 'var(--surface)',
            color: 'var(--ink-2)',
            cursor: 'pointer',
            fontFamily: FONT_BODY,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          background: 'transparent', border: 0,
          color: 'var(--ink-3)', cursor: 'pointer',
          padding: 4, display: 'inline-grid', placeItems: 'center',
        }}
      >
        {Ico.close ? Ico.close(12) : '×'}
      </button>
    </div>
  );
}

// ─── Composed view ───────────────────────────────────────────────────────

export default function ArtifactsView({ artifacts: initial = EMPTY_ARTIFACTS, projects = [], onOpenProject, onHandoffArtifact, agentLabel = 'the agent' }) {
  const [list, setList] = useState(initial);
  const [artifactMode, setArtifactMode] = useState('live');
  const [deletedList, setDeletedList] = useState([]);
  const [deletedAvailable, setDeletedAvailable] = useState(true);
  const [deletedBusyId, setDeletedBusyId] = useState('');
  const [viewer, setViewer] = useState(null);
  const { isMobile } = useBreakpoint();
  const [view, setView] = useState(() =>
    localStorage.getItem('anton:artifacts-view') === 'list' ? 'list' : 'grid'
  );
  // List rows break at phone widths (5-column grid). Force grid on
  // mobile so the toggle isn't needed; the user's persisted desktop
  // preference is left untouched.
  const effectiveView = isMobile ? 'grid' : view;
  const [search, setSearch] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [sort, setSort] = useState('published');
  // Per-artifact-path "in flight" set so multiple cards can publish
  // independently without freezing the whole grid.
  const [busyPaths, setBusyPaths] = useState(() => new Set());
  // The export currently running, as `${path}:${format}` (null when idle), so
  // overlapping picks are serialized to one in-flight conversion at a time.
  const [downloadingFor, setDownloadingFor] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  // Artifact awaiting the publish visibility choice (public vs password).
  // Null when the chooser is closed.
  const [publishTarget, setPublishTarget] = useState(null);
  // Resolver for the promise returned by `handlePublish`, so a delegated
  // caller (the preview's Publish button) can await the whole dialog +
  // POST flow for its busy state. Settled when the chooser confirms,
  // cancels, or errors — exactly once per flow.
  const publishResolveRef = useRef(null);
  const settlePublish = () => {
    publishResolveRef.current?.();
    publishResolveRef.current = null;
  };
  // Page-level state for the shared HoverMenu — mounting the menu at
  // the parent (and not inside a card) is required because cards
  // apply `transform` on hover, which would re-anchor a position:fixed
  // descendant to the card itself instead of the viewport.
  const [menuFor, setMenuFor] = useState(null); // { artifact, rect }
  const isMacPlatform = host.isMac() || /Mac|iPhone|iPod|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  // Toast surfaces publish/unpublish results — primarily so failures
  // don't disappear into the console.
  const [toast, setToast] = useState(null); // { kind: 'ok'|'error', message, actionLabel?, action? }
  const searchRef = useRef(null);

  const loadDeletedArtifacts = async () => {
    try {
      const data = await fetchDeletedArtifacts();
      setDeletedAvailable(data?.available !== false);
      setDeletedList(Array.isArray(data?.artifacts) ? data.artifacts : []);
    } catch {
      setDeletedAvailable(false);
      setDeletedList([]);
    }
  };

  // Reflect parent refreshes exactly. The parent refetches when the
  // route opens and after streams complete; if a file was trashed from
  // another surface, the refreshed prop is the source of truth and the
  // local grid must drop the stale card.
  useEffect(() => {
    setList(initial);
    setViewer((cur) => {
      if (!cur) return cur;
      const fresh = initial.find((a) => a.path === cur.path);
      return fresh ? { ...cur, ...fresh } : null;
    });
  }, [initial]);

  useEffect(() => {
    loadDeletedArtifacts();
  }, []);

  // Persist view toggle.
  useEffect(() => { localStorage.setItem('anton:artifacts-view', view); }, [view]);

  // ⌘K focuses the search input.
  useCollectionShortcut(searchRef);

  // Auto-dismiss the toast after 5s — long enough to read, short enough
  // not to linger across navigations.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const updateOne = (updated) => {
    setList((prev) => prev.map((a) => a.path === updated.path ? { ...a, ...updated } : a));
    setViewer((cur) => (cur && cur.path === updated.path ? { ...cur, ...updated } : cur));
  };

  const handleForkedArtifact = (result) => {
    const artifact = result?.artifact || {};
    const path = artifact.path || result?.preview?.path || result?.artifactPath || '';
    const folder = artifact.folder || result?.artifactPath || path;
    const next = {
      ...artifact,
      id: result?.artifactId || artifact.id || folder || path,
      path,
      folder,
      title: artifact.title || artifact.name || displayName(path || folder),
      mtime: Date.now(),
      updated: 'just now',
    };
    if (!next.path && !next.folder) return;
    setList((prev) => {
      const withoutDuplicate = prev.filter((item) => (
        item.id !== next.id
        && item.path !== next.path
        && item.folder !== next.folder
      ));
      return [next, ...withoutDuplicate];
    });
    setArtifactMode('live');
    setViewer(next);
    setToast({ kind: 'ok', message: 'Remix created.' });
  };

  const removeOne = (path) => {
    setList((prev) => prev.filter((a) => a.path !== path));
    setViewer((cur) => (cur && cur.path === path ? null : cur));
  };

  const setBusy = (path, isBusy) => {
    setBusyPaths((prev) => {
      const next = new Set(prev);
      if (isBusy) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  // Export a document artifact to PDF / Word / HTML and open (desktop) or
  // download (web) it. Result feedback mirrors the publish flow: a toast on
  // success/failure (the menu closes on pick, so progress lives in the toast).
  const handleExportDownload = async (artifact, format) => {
    if (!artifact?.path) return;
    const key = `${artifact.path}:${format}`;
    if (downloadingFor) return;
    setDownloadingFor(key);
    try {
      const { filename } = await exportAndDeliver(artifact, format);
      setToast({ kind: 'ok', message: filename ? `Exported ${filename}` : 'Export ready' });
    } catch (err) {
      setToast({ kind: 'error', message: err?.message || `Could not export as ${String(format).toUpperCase()}.` });
    } finally {
      setDownloadingFor(null);
    }
  };

  // Centralized publish — single source of truth for state updates,
  // toast dispatch, and busy bookkeeping. Mirrors anton's /publish
  // command flow: POST → server zips, scrubs credentials, uploads to
  // MindsHub, persists report_id in `.published.json`. We then reflect
  // the returned URL into the local list so the UI flips to "Published"
  // without a refetch.
  // Publishing is two steps: choose visibility (public / password) in a
  // small dialog, then confirmPublish does the actual POST. Re-publishing
  // a protected artifact pre-fills its existing password.
  const handlePublish = (artifact, options = {}) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return Promise.resolve();
    if (!isPublishableArtifact(artifact)) {
      setToast({ kind: 'error', message: 'Only HTML and Markdown artifacts can be published.' });
      return Promise.resolve();
    }
    // Settle any prior unresolved flow before starting a new one so a
    // delegated awaiter is never left hanging.
    settlePublish();
    setPublishTarget({
      ...artifact,
      publishVersionId: options.versionId || options.version_id || '',
      publishVersionLabel: options.versionLabel || options.label || '',
    });
    return new Promise((resolve) => { publishResolveRef.current = resolve; });
  };

  const confirmPublish = async (access) => {
    const artifact = publishTarget;
    setPublishTarget(null);
    if (!artifact?.path || busyPaths.has(artifact.path)) { settlePublish(); return; }
    setBusy(artifact.path, true);
    try {
      const publishOptions = artifact.publishVersionId ? { versionId: artifact.publishVersionId } : {};
      const r = await publishArtifact(publishTargetPath(artifact), access, publishOptions);
      if (r?.url) {
        // Server is authoritative (it degrades an empty restricted/password
        // selection back to public); fall back to the requested access.
        const m = r.accessMode || access?.mode || 'public';
        updateOne({
          ...artifact,
          publishedUrl: r.url,
          accessMode: m,
          accessProtected: m === 'password',
          accessPassword: m === 'password' ? (access?.password || '') : '',
          accessEmails: m === 'restricted' ? (r.accessEmails || access?.emails || []) : [],
          orgAllowed: m === 'restricted' ? !!(r.orgAllowed ?? access?.org_allowed) : false,
          publishedVersionId: r.publishedVersionId || r.published_version_id || artifact.publishVersionId || artifact.publishedVersionId || '',
          publishedFilesHash: r.publishedFilesHash || r.published_files_hash || artifact.publishedFilesHash || '',
          publishedManifestHash: r.publishedManifestHash || r.published_manifest_hash || artifact.publishedManifestHash || '',
          publishedVersionNumber: r.publishedVersionNumber || r.published_version_number || artifact.publishedVersionNumber || null,
        });
        const label = m === 'password' ? 'password protected' : m === 'restricted' ? 'restricted' : null;
        trackArtifactPublished(r.report_id || artifact.id || '', m);
        setToast({
          kind: 'ok',
          message: label ? `Published (${label}) — ${r.url}` : `Published — ${r.url}`,
        });
      } else {
        setToast({ kind: 'error', message: 'Publish returned no URL.' });
      }
    } catch (e) {
      const msg = e?.message || String(e);
      // Map the most common failure to a clearer next step.
      const friendly = /minds_api_key/i.test(msg) || /minds api key/i.test(msg)
        ? 'Set your Minds API key in Settings to publish artifacts.'
        : `Publish failed: ${msg}`;
      setToast({ kind: 'error', message: friendly });
    } finally {
      setBusy(artifact.path, false);
      settlePublish();
    }
  };

  const handleUnpublish = async (artifact) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return;
    setBusy(artifact.path, true);
    try {
      await unpublishArtifact(publishTargetPath(artifact));
      updateOne({
        ...artifact,
        publishedUrl: '',
        publishedVersionId: '',
        publishedFilesHash: '',
        publishedManifestHash: '',
        publishedVersionNumber: null,
      });
      setToast({ kind: 'ok', message: 'Unpublished from MindsHub.' });
    } catch (e) {
      setToast({ kind: 'error', message: `Unpublish failed: ${e?.message || e}` });
    } finally {
      setBusy(artifact.path, false);
    }
  };

  const requestTrash = (artifact) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return;
    setMenuFor(null);
    setPendingDelete(artifact);
  };

	  const handleTrash = async (artifact) => {
	    if (!artifact?.path || busyPaths.has(artifact.path)) return;
	    setBusy(artifact.path, true);
	    try {
	      // Unpublish first so deletion never leaves an orphaned public copy.
	      // If this fails we abort and keep the artifact (the server enforces
	      // the same rule as a backstop).
	      if (artifact.publishedUrl) {
	        await unpublishArtifact(publishTargetPath(artifact));
	      }
	      await deleteArtifact(artifact.folder || artifact.path);
	      removeOne(artifact.path);
	      await loadDeletedArtifacts();
	      setToast({
	        kind: 'ok',
	        message: 'Moved to Deleted. Restore is available when Cowork has a saved checkpoint.',
	        actionLabel: 'View Deleted',
	        action: () => setArtifactMode('deleted'),
	      });
	    } catch (e) {
	      setToast({ kind: 'error', message: `Delete failed: ${e?.message || e}` });
	    } finally {
	      setBusy(artifact.path, false);
	    }
	  };

	  const handleRestoreDeleted = async (artifact) => {
	    const artifactId = artifact?.artifactId || artifact?.id;
	    const versionId = artifact?.preDeleteVersionId || artifact?.versionId;
	    if (!artifactId || !versionId || deletedBusyId) return;
	    setDeletedBusyId(artifactId);
	    try {
	      const result = await restoreDeletedArtifact(artifactId, versionId);
	      const restored = result?.artifact || {
	        ...artifact,
	        id: artifactId,
	        path: result?.artifactPath || artifact.path,
	        folder: result?.artifactPath || artifact.folder || artifact.path,
	      };
	      setDeletedList((prev) => prev.filter((item) => (item.artifactId || item.id) !== artifactId));
	      setList((prev) => {
	        const restoredPath = restored.path || restored.folder;
	        if (!restoredPath) return prev;
	        const withoutDuplicate = prev.filter((item) => item.path !== restoredPath && item.folder !== restoredPath);
	        return [{ ...restored, mtime: Date.now(), updated: 'just now' }, ...withoutDuplicate];
	      });
	      setArtifactMode('live');
	      setToast({ kind: 'ok', message: 'Artifact restored.' });
	    } catch (e) {
	      setToast({ kind: 'error', message: `Restore failed: ${e?.message || e}` });
	    } finally {
	      setDeletedBusyId('');
	    }
	  };

	  const handleHandoffArtifact = async (artifact, options = {}) => {
	    if (!onHandoffArtifact) return null;
	    const result = await onHandoffArtifact(artifact, options);
	    const conversationId = result?.conversationId || result?.conversation_id || result?.conversation?.id;
	    if (conversationId) setViewer(null);
	    return result;
	  };

	  // Filter + sort.
	  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = (list || []).slice();
    if (q) out = out.filter((a) =>
      (a.title || '').toLowerCase().includes(q)
      || (a.path || '').toLowerCase().includes(q)
      || (a.kind || '').toLowerCase().includes(q)
	      || (reviewSummaryOf(a).hasReview && 'review notes suggestions needs review open notes for you new'.includes(q)),
	    );
    if (reviewFilter === 'forYou') {
      out = out.filter((a) => reviewSummaryOf(a).needsAction > 0);
    } else if (reviewFilter === 'new') {
      out = out.filter((a) => reviewSummaryOf(a).unreadTotal > 0);
    } else if (reviewFilter === 'needsReview') {
      out = out.filter((a) => reviewSummaryOf(a).needsReview);
    } else if (reviewFilter === 'openNotes') {
      out = out.filter((a) => reviewSummaryOf(a).openNotes > 0);
    }

	    out.sort((a, b) => {
	      switch (sort) {
        case 'forYou': {
          const score = reviewSortScore(b, 'forYou') - reviewSortScore(a, 'forYou');
          return score || timestampOf(b) - timestampOf(a);
        }
        case 'new': {
          const score = reviewSortScore(b, 'new') - reviewSortScore(a, 'new');
          return score || timestampOf(b) - timestampOf(a);
        }
	        case 'needsReview': {
	          const score = reviewSortScore(b, 'needsReview') - reviewSortScore(a, 'needsReview');
	          return score || timestampOf(b) - timestampOf(a);
        }
        case 'openNotes': {
          const score = reviewSortScore(b, 'openNotes') - reviewSortScore(a, 'openNotes');
          return score || timestampOf(b) - timestampOf(a);
        }
        case 'recent':    return timestampOf(b) - timestampOf(a);
        case 'oldest':    return timestampOf(a) - timestampOf(b);
        case 'title':     return (a.title || '').localeCompare(b.title || '');
        case 'type':      return kindOf(a).localeCompare(kindOf(b));
        case 'published':
        default: {
          const pa = a.publishedUrl ? 0 : 1;
          const pb = b.publishedUrl ? 0 : 1;
          if (pa !== pb) return pa - pb;
          // Within each group, recency.
          return timestampOf(b) - timestampOf(a);
        }
      }
    });
	    return out;
	  }, [list, search, reviewFilter, sort]);

	  const visibleDeleted = useMemo(() => {
	    const q = search.trim().toLowerCase();
	    let out = (deletedList || []).slice();
	    if (q) out = out.filter((a) =>
	      (a.title || '').toLowerCase().includes(q)
	      || (a.path || '').toLowerCase().includes(q)
	      || (a.slug || '').toLowerCase().includes(q)
	      || (a.type || '').toLowerCase().includes(q),
	    );
	    out.sort((a, b) => {
	      const at = Date.parse(a.deletedAt || a.deleted_at || '') || 0;
	      const bt = Date.parse(b.deletedAt || b.deleted_at || '') || 0;
	      return bt - at;
	    });
	    return out;
	  }, [deletedList, search]);

	  const total = (list || []).length;
	  const deletedTotal = (deletedList || []).length;
	  const hasReviewSummaries = (list || []).some((a) => reviewSummaryOf(a).hasReview);
  useEffect(() => {
    if (!hasReviewSummaries && reviewFilter !== 'all') setReviewFilter('all');
  }, [hasReviewSummaries, reviewFilter]);
  // Published count reflects the *visible* set so it tracks the filter
  // (e.g. "Showing 5 of 12 · 2 published" surfaces what's in the view,
  // not the global count). The numerator stays accurate while the
  // denominator changes with the search.
	  const publishedCount = visible.filter((a) => a.publishedUrl).length;
		  const needsReviewCount = visible.filter((a) => reviewSummaryOf(a).needsReview).length;
		  const reviewQueue = useMemo(() => {
		    return (list || [])
		      .filter((artifact) => {
		        const summary = reviewSummaryOf(artifact);
		        return summary.needsAction > 0 || summary.unreadTotal > 0 || summary.needsReview || summary.openNotes > 0;
		      })
		      .sort((a, b) => {
		        const score = reviewSortScore(b, 'forYou') - reviewSortScore(a, 'forYou');
		        return score || timestampOf(b) - timestampOf(a);
		      });
		  }, [list]);
	  const reviewQueueTotals = useMemo(() => (
	    reviewQueue.reduce((acc, artifact) => {
		      const summary = reviewSummaryOf(artifact);
		      acc.needsAction += summary.needsAction;
		      acc.unreadTotal += summary.unreadTotal;
		      acc.openNotes += summary.openNotes;
		      acc.suggestions += summary.suggestions;
		      acc.reviewRequests += summary.reviewRequests;
		      return acc;
		    }, { needsAction: 0, unreadTotal: 0, openNotes: 0, suggestions: 0, reviewRequests: 0 })
	  ), [reviewQueue]);
	  const inDeletedMode = artifactMode === 'deleted';
	  const showControls = total > 0 || deletedTotal > 0 || inDeletedMode;

	  return (
    // Background intentionally omitted so the gravity-field canvas
    // painted behind the React root shows through.
    <div className="scroll-clean" style={{
      flex: 1, overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
    }}>
      <PageHeader
        title="Live Artifacts"
        subtitle={`Documents, dashboards, and code ${agentLabel} produces. Publish to share a live URL.`}
        // 20px below the subtitle text so the page reads with a
        // little air before the search-row begins. The 20px spacer
        // below the header still adds the standard between-section
        // rhythm — together they make Live Artifacts breathe a touch
        // more than other collection pages, where the action button
        // already anchors the lower edge of the header.
        subtitleBottom={20}
      />

      {/* Toast is portalled to document.body so it renders after modals
          in DOM order, which prevents iframes inside modals from
          compositing on top of it regardless of z-index. */}
      {createPortal(
        <div style={{
          position: 'fixed', top: 24, right: 32, zIndex: 90,
          pointerEvents: toast?.message ? 'auto' : 'none',
          maxWidth: 420,
        }}>
          <Toast
            kind={toast?.kind}
            message={toast?.message}
            actionLabel={toast?.actionLabel}
            onAction={() => {
              toast?.action?.();
              setToast(null);
            }}
            onClose={() => setToast(null)}
          />
        </div>,
        document.body,
      )}

      {/* Subtitle → search-row gap. Set to 20px per the design;
          ProjectsView uses 18px because its header has an anchor
          button on the right ("+ New project"), which reads as
          slightly taller — Artifacts compensates with a few extra. */}
      <div style={{ height: 20 }} />

	      {showControls && (
	        <FilterRow
	          search={
	            <SearchInput
	              value={search}
	              onChange={setSearch}
	              inputRef={searchRef}
	              placeholder={inDeletedMode ? 'Search deleted artifacts' : 'Search artifacts'}
	            />
	          }
	          sort={inDeletedMode ? null : <SortPill value={sort} onChange={setSort} options={SORT_OPTIONS} />}
	          right={(
	            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
	              <ArtifactModeToggle value={artifactMode} onChange={setArtifactMode} deletedCount={deletedTotal} />
	              {!inDeletedMode && hasReviewSummaries && (
	                <ReviewFilter value={reviewFilter} onChange={setReviewFilter} />
	              )}
	            </span>
	          )}
	          view={inDeletedMode ? null : <span className="artifacts-view-toggle"><ViewToggle value={view} onChange={setView} /></span>}
	          counts={
	            inDeletedMode ? (
	              deletedAvailable
	                ? `${visibleDeleted.length}${visibleDeleted.length === deletedTotal ? '' : ` of ${deletedTotal}`} deleted`
	                : 'Deleted artifacts are not available on this server'
	            ) : (
	              <ArtifactsCounts
	                search={search}
	                reviewFilter={reviewFilter}
	                total={total}
	                filtered={visible.length}
	                publishedCount={publishedCount}
	                needsReviewCount={needsReviewCount}
	              />
	            )
	          }
	        />
	      )}

	      {!inDeletedMode && reviewQueue.length > 0 && (
	        <ReviewQueueBand
	          items={reviewQueue}
	          totals={reviewQueueTotals}
	          onOpen={setViewer}
	          onFilter={(nextFilter) => {
	            setReviewFilter(nextFilter);
	            setSort(nextFilter);
	          }}
	        />
	      )}

	      {inDeletedMode ? (
	        visibleDeleted.length === 0 ? (
	          <div style={{
	            flex: 1,
	            minHeight: 320,
	            display: 'grid',
	            placeItems: 'center',
	            padding: '40px 24px',
	          }}>
	            <div style={{ textAlign: 'center', display: 'grid', gap: 8, justifyItems: 'center' }}>
	              <span style={{ display: 'inline-flex', color: 'var(--ink-5)' }}>{Ico.trash(28)}</span>
	              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>
	                {deletedAvailable ? 'No deleted artifacts' : 'Deleted artifacts are not available'}
	              </div>
	              <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink-3)', maxWidth: 360 }}>
	                {deletedAvailable
	                  ? 'Deleted artifacts that can be restored will appear here.'
	                  : 'This server is not exposing recoverable deleted artifacts yet.'}
	              </div>
	            </div>
	          </div>
	        ) : (
	          <div className="artifacts-grid" style={{
	            padding: '6px 32px 60px',
	            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14,
	            marginTop: 18,
	          }}>
	            {visibleDeleted.map((a) => {
	              const restoreId = a.artifactId || a.id;
	              return (
	                <DeletedArtifactCard
	                  key={`${restoreId}-${a.preDeleteVersionId || a.deletedAt || a.path}`}
	                  artifact={a}
	                  busy={deletedBusyId === restoreId}
	                  onRestore={handleRestoreDeleted}
	                />
	              );
	            })}
	          </div>
	        )
	      ) : total === 0 ? (
	        <EmptyState agentLabel={agentLabel} />
	      ) : effectiveView === 'grid' ? (
        <div className="artifacts-grid" style={{
          padding: '6px 32px 60px',
          // Same grid geometry as ProjectsView so cards line up at
          // the same density across pages.
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14,
          marginTop: 18,
        }}>
          {visible.map((a) => (
            <ArtifactBubble
              key={a.id || a.path}
              artifact={a}
              projects={projects}
              onOpenViewer={setViewer}
              onMenuOpen={(art, rect) => setMenuFor((prev) =>
                prev?.artifact?.path === art.path ? null : { artifact: art, rect },
              )}
              isMenuOpen={menuFor?.artifact?.path === a.path}
              busy={busyPaths.has(a.path)}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      ) : (
        <div style={{ padding: '6px 32px 60px', marginTop: 18 }}>
          <ListHeaderRow />
          {visible.map((a) => (
            <ArtifactRow
              key={a.id || a.path}
              artifact={a}
              projects={projects}
              onOpenViewer={setViewer}
              onPublish={handlePublish}
              onUnpublish={handleUnpublish}
              onDelete={requestTrash}
              onExport={handleExportDownload}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      )}

      <ArtifactWorkspace
        open={!!viewer}
        artifact={viewer}
        projects={projects}
        onClose={() => setViewer(null)}
        onChange={updateOne}
        onPublish={handlePublish}
        onUnpublish={handleUnpublish}
        onForked={handleForkedArtifact}
        onHandoff={onHandoffArtifact ? handleHandoffArtifact : null}
      />

      {publishTarget && (
        <PublishDialog
          artifact={publishTarget}
          onCancel={() => { setPublishTarget(null); settlePublish(); }}
          onConfirm={confirmPublish}
        />
      )}

      <ConfirmModal
        open={!!pendingDelete}
        title={`Move "${pendingDelete?.title || displayName(pendingDelete?.path || pendingDelete?.folder)}" to Deleted?`}
        message="Cowork will remove this artifact from Live Artifacts and move it to Deleted when recovery is available. If it is published, the live link will be unpublished first."
        confirmLabel="Move to Deleted"
        cancelLabel="Keep"
        destructive
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) handleTrash(target);
        }}
      />

      {/* Single shared menu for the whole grid — anchored to whichever
          card the user just clicked. Mounted here at the page level
          (not inside each card) so the dropdown's `position: fixed`
          stays viewport-relative regardless of card-level transforms. */}
      <HoverMenu
        open={!!menuFor}
        anchorRect={menuFor?.rect}
        onClose={() => setMenuFor(null)}
        items={(() => {
          const a = menuFor?.artifact;
          if (!a) return [];
          const isHtml = isHtmlArtifact(a);
          const isPublishable = isPublishableArtifact(a);
          const isBackend = isBackendArtifact(a);
          const published = !!a.publishedUrl;
          const busyA = busyPaths.has(a.path);
          const items = [];
          if (published) {
            items.push({
              id: 'unpublish',
              label: busyA ? 'Working…' : 'Unpublish',
              icon: Ico.power(13),
              onClick: () => handleUnpublish(a),
            });
          } else if (isPublishable) {
            items.push({
              id: 'publish',
              label: busyA ? 'Publishing…' : 'Publish',
              icon: Ico.power(13),
              onClick: () => handlePublish(a),
            });
          }
          items.push({
            id: 'preview',
            label: 'Preview',
            icon: (Ico.eye?.(13) || Ico.sparkle(13)),
            onClick: () => setViewer(a),
          });
          // Fullstack apps can't be opened from their static entry html
          // (it needs the backend), so only offer "Open in browser" for
          // them once published — then it opens the live public URL.
          // Unpublished fullstack gets no open/reveal item.
          if (isHtml && (!isBackend || published)) {
            items.push({
              id: 'open',
              label: 'Open in browser',
              icon: (Ico.link?.(13) || Ico.globe?.(13) || Ico.doc(13)),
              onClick: () => {
                if (a.publishedUrl) {
                  try { host.openExternal(a.publishedUrl); }
                  catch { window.open(a.publishedUrl, '_blank', 'noreferrer'); }
                } else {
                  openArtifactFile(a);
                }
              },
            });
          } else if (!isBackend && !host.isWeb) {
            // Reveal hits the server's /artifacts/reveal endpoint which
            // shells out to the OS opener — meaningful only on the
            // desktop where the renderer and server share a filesystem.
            items.push({
              id: 'reveal',
              label: isMacPlatform ? 'Show in Finder' : 'Show in Explorer',
              icon: Ico.folder(13),
              onClick: () => { try { revealArtifact(a.path); } catch { } },
            });
          }
          // Download as… — convert markdown/HTML documents to PDF / Word /
          // HTML. Hidden for non-document artifacts (apps, images, data).
          // Picking an item closes the menu (anchored menus dismiss on
          // activation), so progress shows via the toast, not in the menu.
          if (canExportArtifact(a)) {
            items.push({
              id: 'download',
              label: 'Download as',
              icon: Ico.download(13),
              submenu: EXPORT_FORMATS.map((f) => ({
                id: `download-${f.id}`,
                label: f.label,
                icon: Ico.download(13),
                disabled: !canExportFormat(a, f.id),
                onClick: () => handleExportDownload(a, f.id),
              })),
            });
          }
          items.push({ separator: true });
          items.push({
            id: 'delete',
            label: 'Move to Deleted',
            icon: Ico.trash(13),
            danger: true,
            onClick: () => requestTrash(a),
          });
          return items;
        })()}
      />
    </div>
  );
}
