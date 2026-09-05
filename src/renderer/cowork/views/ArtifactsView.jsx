import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { projectLabel } from '../lib/projectLabel';
import Ico from '../components/Icons';
import { Card } from '../components/ui/Card';
import { useToastManager } from '../components/ui/Toast';
import { EmptyState } from '../components/ui/EmptyState';
import { Button, Tooltip } from '../components/ui';
import {
  revealArtifact, publishArtifact, unpublishArtifact, updateArtifact,
  publishTargetPath, artifactServeUrl, openArtifactFile,
} from '../api';
import { copyText } from '../lib/clipboard';
import { projectNameOf } from '../lib/artifactProject';
import { isArtifactActionAvailable, needsClientUnpublishBeforeDelete } from '../lib/artifactActions';
import { deleteArtifactAndSync } from '../lib/artifactsStore';
import { useOrgMode } from '../../lib/orgMode';
import { downloadArtifactFile } from '../lib/artifactDownload';
import {
  canDownloadOrgDraft, canPreviewLocally, canPreviewOrgDraft, isHtmlArtifact,
  isPublishableArtifact, isBackendArtifact, isInlinePreviewable,
} from '../lib/artifactKinds';
import { trackArtifactPublished } from '../lib/analytics';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';
import { ArtifactViewer } from '../components/artifact';
import {
  AccessChooser,
  accessDraftFromArtifact,
  isAccessDraftValid,
  buildAccessPayload,
} from '../components/artifact/publish/AccessChooser';
import { ArtifactIcon, splitArtifactName, displayTitle, fileNameOf, isWebAppArtifact } from '../components/artifacts/ArtifactIcon';
import { ArtifactStatus } from '../components/artifacts/ArtifactStatus';
import {
  PageHeader,
  FilterRow,
  SearchInput,
  SortPill,
  HoverMenu,
  useCollectionShortcut,
} from '../components/collection';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { host } from '../../platform/host';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useRevealOnHover } from '../hooks/useRevealOnHover';

const EMPTY_ARTIFACTS = [];

// Sort options for the artifacts collection. Per-page (publishing
// state isn't relevant to other collections).
const SORT_OPTIONS = [
  { id: 'published', label: 'Shared first' },
  { id: 'recent', label: 'Recent' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'title', label: 'Title (A–Z)' },
  { id: 'type', label: 'Type' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────

// projectNameOf moved to lib/artifactProject.js — in org mode the list spans every
// project of the organization, so the label has to come from the card's projectId /
// projectName rather than from its filesystem path.

// Return a project only for known path roots; unmatched labels remain informational.
function projectOf(artifact, projects = []) {
  const p = artifact?.path || '';
  if (!p) return null;
  return projects.find((proj) => {
    if (!proj?.path) return false;
    const pre = proj.path.replace(/\/+$/, '') + '/';
    return p.startsWith(pre);
  }) || null;
}

// mtime is numeric content_mtime in seconds, matching the server’s displayed age.
export function timestampOf(a) {
  return a.mtime || 0;
}

// Kind pill — short uppercase tag for the file type. Pulls from
// `artifact.kind` or falls back to the file extension.
function kindOf(a) {
  if (a.kind) return String(a.kind).toLowerCase();
  const ext = (a.ext || '').replace(/^\./, '').toLowerCase();
  return ext || 'file';
}

// Use numeric English collation at both levels for stable v2/v10 ordering across machines.
// Keep default sensitivity so case/accent differences do not trigger the filename tie-break.
const NAME_COLLATOR = new Intl.Collator('en', { numeric: true });

export function titleCompare(a, b) {
  const t = NAME_COLLATOR.compare(displayTitle(a), displayTitle(b));
  if (t !== 0) return t;
  // Break ties only with visible secondary filenames; web-app artifacts have none.
  if (isWebAppArtifact(a) || isWebAppArtifact(b)) return 0;
  return NAME_COLLATOR.compare(fileNameOf(a), fileNameOf(b));
}

function PublishDialog({ artifact, onCancel, onConfirm }) {
  const [draft, setDraft] = useState(() => accessDraftFromArtifact(artifact));
  if (!artifact) return null;
  const canConfirm = isAccessDraftValid(draft);
  const submit = () => { if (canConfirm) onConfirm(buildAccessPayload(draft)); };

  return (
    <Modal open onClose={onCancel} size="sm" width="min(440px, 94vw)" maxHeight="min(600px, 90vh)" labelledBy="publish-dialog-title">
      <ModalHeader
        id="publish-dialog-title"
        title="Share to the Web"
        subtitle={artifact.title || artifact.path?.split('/').pop()}
        onClose={onCancel}
      />
      <ModalBody>
        <div className="font-[family-name:var(--font-body)] font-semibold text-sm text-ink mb-2">
          Who can access your app
        </div>
        <AccessChooser value={draft} onChange={setDraft} onSubmit={submit} />
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!canConfirm}>
          {draft.mode === 'password' ? 'Share protected' : draft.mode === 'restricted' ? 'Share restricted' : 'Share'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ─── Card / Bubble (grid view) ───────────────────────────────────────────

// Forward the ref so the page-level menu can anchor to this button.
const CardIconButton = forwardRef(function CardIconButton({ onClick, ariaLabel, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      {...rest}
      style={{
        width: 28, height: 28, borderRadius: 7,
        display: 'inline-grid', placeItems: 'center',
        background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
        color: 'var(--ink-4)', transition: 'background .12s ease, color .12s ease',
      }}
      onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }}
      onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-4)'; }}
    >
      {children}
    </button>
  );
});

/*
 * Await downloads and toast false results; discarded promises turn failed downloads into silent
 * clicks.
 */
async function downloadWithFeedback(artifact, toastManager) {
  if (!(await downloadArtifactFile(artifact))) {
    toastManager.add({ title: 'Could not download this artifact.', type: 'danger' });
  }
}

function ArtifactBubble({ artifact, projects = [], onOpenViewer, onMenuOpen, isMenuOpen, phase, onRetry, onOpenProject }) {
  const orgMode = useOrgMode();
  const toastManager = useToastManager();
  /*
   * Preview the local bytes or authenticated draft when supported; otherwise use the best available
   * destination.
   */
  const canPreview = orgMode ? canPreviewOrgDraft(artifact) : isInlinePreviewable(artifact);
  const published = !!artifact.publishedUrl;
  // In the browser the artifact's address is its HTTP serve URL, not a local
  // OS path the user can't reach — open that "private" URL instead.
  const privateUrl = !orgMode && host.isWeb ? artifactServeUrl(artifact) : '';

  const { hoverProps } = useRevealOnHover(isMenuOpen);
  const kebabRef = useRef(null);

  const onOpenPublished = async () => {
    if (!published) return;
    try { await host.openExternal(artifact.publishedUrl); } catch {
      window.open(artifact.publishedUrl, '_blank', 'noreferrer');
    }
  };
  const onOpenPrivate = async () => {
    if (!privateUrl) return;
    try { await host.openExternal(privateUrl); } catch {
      window.open(privateUrl, '_blank', 'noreferrer');
    }
  };

  const projectDisplay = projectNameOf(artifact, projects);
  // The project the artifact belongs to. When resolved, the project label
  // becomes a clickable affordance that navigates to that project's page.
  const projectMatch = projectOf(artifact, projects);
  const canOpenProject = !!(projectMatch && typeof onOpenProject === 'function');

  // Let the parent render the menu: card transforms would anchor fixed descendants to the card
  // instead of the viewport.
  const openMenu = (e) => {
    e.stopPropagation();
    if (!kebabRef.current) return;
    onMenuOpen?.(artifact, kebabRef.current.getBoundingClientRect());
  };

  // Publishability controls status independently of name/icon type; markdown files remain
  // publishable.
  const publishable = isPublishableArtifact(artifact);
  const { base, secondary } = splitArtifactName(artifact);
  // Open the live thing: published URL, else served URL, else local file. In org
  // mode the last fallback is skipped — there is no local file the user can reach,
  // and `privateUrl` is empty there by construction.
  const openBest = () => {
    if (canPreview) onOpenViewer?.(artifact);
    else if (published) onOpenPublished();
    else if (privateUrl) onOpenPrivate();
    // Org mode, non-HTML, unshared: the draft URL still streams the bytes —
    // save them rather than do nothing (ENG-2044). Same rule as
    // artifactOpenTarget's 'download'.
    else if (orgMode && canDownloadOrgDraft(artifact)) downloadWithFeedback(artifact, toastManager);
    else if (!orgMode) openArtifactFile(artifact);
  };
  // ↗
  const onOpenExternal = (e) => {
    e.stopPropagation();
    openBest();
  };

  return (
    <Card
      as="div"
      interactive
      padding="none"
      className="cw-artifact-card flex flex-col overflow-hidden"
      {...hoverProps}
      onActivate={() => (canPreview ? onOpenViewer(artifact) : openBest())}
    >
      {/* Body — icon + name·ext + actions, then the status row. */}
      <div className="flex flex-col gap-3 py-[14px] px-4 flex-1">
        <div className="flex items-center gap-[10px] min-w-0">
          <span className="inline-flex shrink-0 self-start mt-0.5">
            <ArtifactIcon artifact={artifact} size={18} />
          </span>
          {/* Name: title primary, filename secondary (ENG-1123 Bug 1) — the
              secondary line always renders (empty for web apps) so row
              height stays uniform whether or not there's a filename. */}
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <div
              className="flex items-baseline min-w-0 font-[family-name:var(--font-display)] text-base font-semibold leading-[1.2]"
              title={base}
            >
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-ink">{base}</span>
            </div>
            <div
              className="flex items-baseline min-w-0 font-[family-name:var(--font-body)] text-[12px] leading-[1.2] min-h-[1.2em]"
              title={secondary ? secondary.name + secondary.ext : undefined}
            >
              {secondary && (
                <>
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-ink-3">{secondary.name}</span>
                  <span className="shrink-0 text-ink-4">{secondary.ext}</span>
                </>
              )}
            </div>
          </div>
          {/* Actions — open-in-browser + ⋯ menu. */}
          <div className="flex items-center gap-0.5 shrink-0">
            <Tooltip content="Open">
              <CardIconButton ariaLabel="Open" onClick={onOpenExternal}>{Ico.externalLink(15)}</CardIconButton>
            </Tooltip>
            <Tooltip content="More actions">
              <CardIconButton ref={kebabRef} ariaLabel="Artifact menu"
                onClick={(e) => { e.stopPropagation(); openMenu(e); }}>
                {Ico.moreVert(16)}
              </CardIconButton>
            </Tooltip>
          </div>
        </div>

        <div className="flex min-w-0">
          <ArtifactStatus artifact={artifact} phase={phase} publishable={publishable} onRetry={onRetry} />
        </div>
      </div>

      {/* Footer — project origin + last-updated, divided from the body. */}
      <div className="flex items-center gap-2 py-[9px] px-4 border-t border-x-0 border-b-0 border-solid border-line bg-surface-2">
        <span className="inline-flex shrink-0 text-ink-4">{Ico.folder(13)}</span>
        {canOpenProject ? (
          <Tooltip content={`Open ${projectLabel(projectMatch)}`}>
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenProject(projectMatch); } }}
              style={{
                all: 'unset', cursor: 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-3)',
                minWidth: 0, flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                transition: 'color 120ms ease',
              }}
              onMouseOver={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.textUnderlineOffset = '2px'; }}
              onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.textDecoration = 'none'; }}
            >{projectDisplay}</button>
          </Tooltip>
        ) : (
          <span title={projectDisplay} className="font-[family-name:var(--font-body)] text-[12px] text-ink-3 min-w-0 flex-[0_1_auto] overflow-hidden text-ellipsis whitespace-nowrap">{projectDisplay}</span>
        )}
        <span className="ml-auto shrink-0 font-[family-name:var(--font-body)] text-[12px] text-ink-4">{artifact.updated || '—'}</span>
      </div>
    </Card>
  );
}

// ─── List view ───────────────────────────────────────────────────────────

// Fix the trailing action-column width so header and row grids distribute their remaining columns
// identically.
const LIST_GRID = 'minmax(0, 2.4fr) minmax(0, 1.3fr) minmax(0, 2fr) 200px';

function ListHeaderRow() {
  const Cell = ({ children }) => (
    <div className="font-[family-name:var(--font-body)] text-[13px] font-semibold text-ink-2">{children}</div>
  );
  return (
    <div
      className="grid gap-4 py-2.5 px-4 border-b border-t-0 border-x-0 border-solid border-line"
      style={{ gridTemplateColumns: LIST_GRID }}
    >
      <Cell>Name</Cell>
      <Cell>Project</Cell>
      <Cell>Status</Cell>
      <Cell />
    </div>
  );
}

function RowMenu({ open, anchorRect, artifact, onClose, onOpen, onOpenShared, onPreview, onReveal, onDownload, onCopyUrl, onPublish, onUnpublish, onUpdate, onDelete, busy = false, isMacPlatform = false }) {
  const isHtml = isHtmlArtifact(artifact);
  const orgMode = useOrgMode();
  const published = !!artifact.publishedUrl;
  const items = [
    {
      id: 'open',
      /* In org mode this action opens the shared page; draft preview is on the row itself. */
      label: orgMode ? 'Open shared link' : (isHtml ? 'Open viewer' : 'Open'),
      icon: Ico.externalLink(13),
      onClick: orgMode ? onOpenShared : onOpen,
    },
    // Org only: on Desktop the item above already opens the viewer.
    orgMode && canPreviewOrgDraft(artifact) && {
      id: 'preview',
      label: 'Preview',
      icon: (Ico.eye?.(13) || Ico.sparkle(13)),
      onClick: onPreview,
    },
    onReveal && {
      id: 'reveal',
      label: isMacPlatform ? 'Show in Finder' : 'Show in Explorer',
      icon: Ico.folder(13),
      onClick: onReveal,
    },
    // Presence of EITHER url, checked without building it: the org draft URL
    // is what makes a non-HTML artifact downloadable on web (ENG-2044).
    onDownload && (artifact?.serveUrl || canDownloadOrgDraft(artifact)) && {
      id: 'download',
      label: 'Download',
      icon: Ico.download(13),
      onClick: onDownload,
    },
    published && {
      id: 'copy-url',
      label: 'Copy URL',
      icon: Ico.copy(13),
      onClick: onCopyUrl,
    },
    published && artifact.modified && {
      id: 'update',
      label: 'Update',
      icon: Ico.refresh(13),
      onClick: onUpdate,
    },
    !published && isPublishableArtifact(artifact) && {
      id: 'publish',
      label: 'Share',
      icon: Ico.upload(13),
      onClick: onPublish,
    },
    published && {
      id: 'unpublish',
      label: 'Stop sharing',
      icon: Ico.upload(13),
      onClick: onUnpublish,
    },
    onDelete && { divider: true },
    onDelete && {
      id: 'delete',
      // See the grid menu's delete for why this is disabled while busy.
      label: busy ? 'Deleting…' : 'Delete artifact',
      icon: Ico.trash(13),
      danger: true,
      disabled: busy,
      onClick: onDelete,
    },
  ]
    .filter(Boolean)
    // Mode gate on top of each item's own condition — see lib/artifactActions.
    .filter((it) => it.divider || isArtifactActionAvailable(it.id, {
      orgMode, hasBridge: host.isElectron, published, hasDraft: canDownloadOrgDraft(artifact),
    }));

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

function ArtifactRow({ artifact, projects, onOpenViewer, onPublish: doPublish, onUnpublish: doUnpublish, onUpdate: doUpdate, onDelete: doDelete, onOpenProject, phase, onRetry }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const triggerRef = useRef(null);
  const { hovered, hoverProps } = useRevealOnHover(menuOpen);

  const orgMode = useOrgMode();
  const toastManager = useToastManager();
  const canPreview = orgMode ? canPreviewOrgDraft(artifact) : isInlinePreviewable(artifact);
  const published = !!artifact.publishedUrl;
  const publishable = isPublishableArtifact(artifact);   // HTML + Markdown — see ArtifactBubble note
  const privateUrl = !orgMode && host.isWeb ? artifactServeUrl(artifact) : '';
  const { base, secondary } = splitArtifactName(artifact);
  const project = projectNameOf(artifact, projects);
  const projectMatch = projectOf(artifact, projects);
  const canOpenProject = !!(projectMatch && typeof onOpenProject === 'function');

  const onCopyUrl = async () => {
    if (!published) return false;
    return copyText(artifact.publishedUrl);
  };
  const openUrl = async (url) => {
    try { await host.openExternal(url); } catch { window.open(url, '_blank', 'noreferrer'); }
  };
  const onRowOpen = () => {
    if (canPreview) onOpenViewer?.(artifact);
    else if (published) openUrl(artifact.publishedUrl);
    else if (privateUrl) openUrl(privateUrl);
    // Unshared org files can still download through the draft URL, matching grid behavior.
    else if (orgMode && canDownloadOrgDraft(artifact)) downloadWithFeedback(artifact, toastManager);
    else if (!orgMode) openArtifactFile(artifact);
  };
  const onOpenExternal = async (e) => {
    e.stopPropagation();
    const url = published ? artifact.publishedUrl : privateUrl;
    // Org mode has no local file or serve URL to fall back to — but the
    // authenticated draft URL still delivers the bytes as a download.
    if (url) await openUrl(url);
    else if (orgMode && canDownloadOrgDraft(artifact)) await downloadWithFeedback(artifact, toastManager);
    else if (!orgMode) openArtifactFile(artifact);
  };
  const openMenu = (e) => {
    e.stopPropagation();
    setAnchorRect(triggerRef.current?.getBoundingClientRect() || null);
    setMenuOpen(true);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onRowOpen}
        onKeyDown={(e) => { if (e.key === 'Enter') onRowOpen(); }}
        {...hoverProps}
        className="grid gap-4 py-3 px-4 border-b border-t-0 border-x-0 border-solid border-line cursor-pointer items-center [outline:none] [transition:background_.12s_ease]"
        style={{
          gridTemplateColumns: LIST_GRID,
          background: hovered ? 'var(--surface-2)' : 'transparent',
        }}
      >
        {/* Name — title primary, filename secondary (ENG-1123 Bug 1). */}
        <div className="flex items-center gap-[10px] min-w-0">
          <span className="inline-flex shrink-0 self-start mt-0.5">
            <ArtifactIcon artifact={artifact} size={16} />
          </span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <div
              className="flex items-baseline min-w-0 font-[family-name:var(--font-display)] text-base font-semibold leading-[1.2]"
              title={base}
            >
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-ink">{base}</span>
            </div>
            <div
              className="flex items-baseline min-w-0 font-[family-name:var(--font-body)] text-[12px] leading-[1.2] min-h-[1.2em]"
              title={secondary ? secondary.name + secondary.ext : undefined}
            >
              {secondary && (
                <>
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-ink-3">{secondary.name}</span>
                  <span className="shrink-0 text-ink-4">{secondary.ext}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Project */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="inline-flex shrink-0 text-ink-4">{Ico.folder(13)}</span>
          {canOpenProject ? (
            <Tooltip content={`Open ${projectLabel(projectMatch)}`}>
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenProject(projectMatch); } }}
                style={{
                  all: 'unset', cursor: 'pointer',
                  fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-2)',
                  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  display: 'inline-block', maxWidth: '100%', transition: 'color 120ms ease',
                }}
                onMouseOver={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.textUnderlineOffset = '2px'; }}
                onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-2)'; e.currentTarget.style.textDecoration = 'none'; }}
              >{project}</button>
            </Tooltip>
          ) : (
            <span title={project} className="font-[family-name:var(--font-body)] text-sm text-ink-2 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{project}</span>
          )}
        </div>

        {/* Status — query container so the access chip drops to icon-only
            when the column gets tight (frees room for "Unpublished changes"). */}
        <div className="cw-status-cell flex items-center min-w-0">
          <ArtifactStatus artifact={artifact} phase={phase} publishable={publishable} onRetry={onRetry} inlineChanges />
        </div>

        {/* Updated + open + ⋯ */}
        <div className="flex items-center gap-1.5 justify-end whitespace-nowrap">
          <span className="font-[family-name:var(--font-body)] text-[12px] text-ink-4">{artifact.updated || '—'}</span>
          <Tooltip content="Open">
            <CardIconButton ariaLabel="Open" onClick={onOpenExternal}>{Ico.externalLink(14)}</CardIconButton>
          </Tooltip>
          <Tooltip content="More actions">
            <CardIconButton ref={triggerRef} ariaLabel="Artifact menu" onClick={openMenu}>{Ico.moreVert(15)}</CardIconButton>
          </Tooltip>
        </div>
      </div>

      <RowMenu
        open={menuOpen}
        anchorRect={anchorRect}
        artifact={artifact}
        onClose={() => setMenuOpen(false)}
        onOpen={onRowOpen}
        onOpenShared={() => openUrl(artifact.publishedUrl)}
        onPreview={() => onOpenViewer?.(artifact)}
        onReveal={host.isWeb ? undefined : () => { try { revealArtifact(artifact.path); } catch { } }}
        onDownload={() => downloadWithFeedback(artifact, toastManager)}
        onCopyUrl={onCopyUrl}
        onPublish={() => doPublish?.(artifact)}
        onUnpublish={() => doUnpublish?.(artifact)}
        onUpdate={() => doUpdate?.(artifact)}
        onDelete={doDelete && artifact?.capabilities?.canEdit !== false
          ? () => doDelete(artifact)
          : undefined}
        // Derived from `phase` rather than threading a second prop: the row
        // already receives it, and 'deleting' is exactly the window to disable.
        busy={phase === 'deleting'}
        isMacPlatform={host.isMac() || /Mac|iPhone|iPod|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')}
      />
    </>
  );
}

// ─── Composed view ───────────────────────────────────────────────────────

export default function ArtifactsView({
  artifacts: initial = EMPTY_ARTIFACTS,
  projects = [],
  onOpenProject,
  onAddressWithAgent,
  resolveRepairConversation,
  agentLabel = 'the agent',
}) {
  // For the grid's shared menu below. The list view's menu (ArtifactMenu) reads
  // this for itself; the grid's is built here, so the gate has to be applied at
  // both sites or one view silently keeps the desktop-only actions.
  const orgMode = useOrgMode();
  const [list, setList] = useState(initial);
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
  const [sort, setSort] = useState('published');
  // Per-artifact-path "in flight" set so multiple cards can publish
  // independently without freezing the whole grid.
  const [busyPaths, setBusyPaths] = useState(() => new Set());
  // Artifact awaiting the publish visibility choice (public vs password).
  // Null when the chooser is closed.
  const [publishTarget, setPublishTarget] = useState(null);
  // Resolve after the entire publish chooser/request flow so delegated callers retain busy state
  // through confirm, cancel, or error.
  const publishResolveRef = useRef(null);
  const settlePublish = () => {
    publishResolveRef.current?.();
    publishResolveRef.current = null;
  };
  // Render the menu at page level so hovered card transforms cannot change its fixed-position
  // containing block.
  const [menuFor, setMenuFor] = useState(null); // { artifact, rect }
  const isMacPlatform = host.isMac() || /Mac|iPhone|iPod|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  // Toast surfaces publish/unpublish results — primarily so failures
  // don't disappear into the console.
  const toastManager = useToastManager();
  const showToast = ({ kind, message }) => toastManager.add({ title: message, type: kind === 'ok' ? 'success' : 'danger' });
  const searchRef = useRef(null);

  // Replace local data on parent refresh so deletions from other surfaces remove stale cards too.
  useEffect(() => {
    setList(initial);
    setViewer((cur) => {
      if (!cur) return cur;
      const fresh = initial.find((a) => a.path === cur.path);
      return fresh ? { ...cur, ...fresh } : null;
    });
  }, [initial]);

  // Persist view toggle.
  useEffect(() => { localStorage.setItem('anton:artifacts-view', view); }, [view]);

  // ⌘K focuses the search input.
  useCollectionShortcut(searchRef);


  const updateOne = (updated) => {
    setList((prev) => prev.map((a) => a.path === updated.path ? { ...a, ...updated } : a));
    setViewer((cur) => (cur && cur.path === updated.path ? { ...cur, ...updated } : cur));
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

  // Clear transient status on success; failure remains until retry.
  const [statusByPath, setStatusByPath] = useState({});
  const setPhase = (path, phase) => setStatusByPath((prev) => {
    if (!phase) {
      if (!(path in prev)) return prev;
      const { [path]: _drop, ...rest } = prev;
      return rest;
    }
    return { ...prev, [path]: phase };
  });

  // Choose visibility before publishing, prefilled from existing protection. Reflect the returned
  // URL locally
  // so successful publication updates immediately.
  const handlePublish = (artifact) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return Promise.resolve();
    if (!isPublishableArtifact(artifact)) {
      showToast({ kind: 'error', message: 'Only HTML and Markdown artifacts can be shared.' });
      return Promise.resolve();
    }
    // Settle any prior unresolved flow before starting a new one so a
    // delegated awaiter is never left hanging.
    settlePublish();
    setPublishTarget(artifact);
    return new Promise((resolve) => { publishResolveRef.current = resolve; });
  };

  const confirmPublish = async (access) => {
    const artifact = publishTarget;
    setPublishTarget(null);
    if (!artifact?.path || busyPaths.has(artifact.path)) { settlePublish(); return; }
    setBusy(artifact.path, true);
    setPhase(artifact.path, 'publishing');
    try {
      const r = await publishArtifact(publishTargetPath(artifact), access);
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
          ownerOnly: m === 'restricted' ? !!(r.ownerOnly ?? access?.owner_only) : false,
        });
        setPhase(artifact.path, null);
        const label = m === 'password' ? 'password protected' : m === 'restricted' ? 'restricted' : null;
        trackArtifactPublished(r.report_id || artifact.id || '', m);
        showToast({
          kind: 'ok',
          message: label ? `Shared (${label}) — ${r.url}` : `Shared — ${r.url}`,
        });
      } else {
        setPhase(artifact.path, 'failed');
        showToast({ kind: 'error', message: 'Sharing returned no URL.' });
      }
    } catch (e) {
      const msg = e?.message || String(e);
      // Map the most common failure to a clearer next step.
      const friendly = /minds_api_key/i.test(msg) || /minds api key/i.test(msg)
        ? 'Set your Minds API key in Settings to share artifacts.'
        : `Sharing failed: ${msg}`;
      setPhase(artifact.path, 'failed');
      showToast({ kind: 'error', message: friendly });
    } finally {
      setBusy(artifact.path, false);
      settlePublish();
    }
  };

  const handleUnpublish = async (artifact) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return;
    setBusy(artifact.path, true);
    setPhase(artifact.path, 'unpublishing');
    try {
      await unpublishArtifact(publishTargetPath(artifact));
      updateOne({ ...artifact, publishedUrl: '' });
      showToast({ kind: 'ok', message: 'Stopped sharing on MindsHub.' });
    } catch (e) {
      showToast({ kind: 'error', message: `Couldn't stop sharing: ${e?.message || e}` });
    } finally {
      setBusy(artifact.path, false);
      setPhase(artifact.path, null);
    }
  };

  const handleUpdate = async (artifact) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return;
    setBusy(artifact.path, true);
    setPhase(artifact.path, 'updating');
    try {
      const r = await updateArtifact(publishTargetPath(artifact));
      // Server refreshed last_md5 + published_mtime, so the artifact is no
      // longer "modified". Reflect it locally without a refetch.
      updateOne({ ...artifact, modified: false, publishedUrl: r?.url || artifact.publishedUrl });
      showToast({ kind: 'ok', message: 'Updated the shared version.' });
    } catch (e) {
      showToast({ kind: 'error', message: `Update failed: ${e?.message || e}` });
    } finally {
      setBusy(artifact.path, false);
      setPhase(artifact.path, null);
    }
  };

  const handleTrash = async (artifact) => {
    if (artifact?.capabilities?.canEdit === false) {
      showToast({ kind: 'error', message: 'Only the artifact owner can delete it.' });
      return;
    }
    if (!artifact?.path || busyPaths.has(artifact.path)) return;
    setBusy(artifact.path, true);
    // Show deletion progress while remote unpublishing and org credentials are resolved.
    setPhase(artifact.path, 'deleting');
    try {
      // Unpublish before local deletion and abort if it fails. Org deletion performs this
      // server-side; its client unpublish route returns 501.
      if (needsClientUnpublishBeforeDelete({ orgMode, published: artifact.publishedUrl })) {
        await unpublishArtifact(artifact.path);
      }
      await deleteArtifactAndSync(artifact);
      removeOne(artifact.path);
      showToast({ kind: 'ok', message: 'Deleted.' });
    } catch (e) {
      showToast({ kind: 'error', message: `Delete failed: ${e?.message || e}` });
      // Only on failure: on success the row is already gone, and clearing the
      // phase of a removed path would just leave a dead entry in statusByPath.
      setPhase(artifact.path, null);
    } finally {
      setBusy(artifact.path, false);
    }
  };

  // Filter + sort.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = (list || []).slice();
    if (q) out = out.filter((a) =>
      (a.title || '').toLowerCase().includes(q)
      || (a.path || '').toLowerCase().includes(q)
      || (a.kind || '').toLowerCase().includes(q),
    );

    out.sort((a, b) => {
      switch (sort) {
        case 'recent': return timestampOf(b) - timestampOf(a);
        case 'oldest': return timestampOf(a) - timestampOf(b);
        case 'title': return titleCompare(a, b);
        case 'type': return kindOf(a).localeCompare(kindOf(b));
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
  }, [list, search, sort]);

  const total = (list || []).length;

  return (
    // Background intentionally omitted so the gravity-field canvas
    // painted behind the React root shows through.
    <div
      className="scroll-clean flex-1 overflow-y-auto flex flex-col [container-type:inline-size]"
    >
      <PageHeader
        title="Live Artifacts"
        subtitle={`Documents, dashboards, and code ${agentLabel} produces. Share to get a live URL.`}
      />

      <div className="h-5" />

      {total > 0 && (
        <FilterRow
          search={
            <SearchInput
              value={search}
              onChange={setSearch}
              inputRef={searchRef}
              placeholder="Search artifacts"
            />
          }
          sort={<SortPill value={sort} onChange={setSort} options={SORT_OPTIONS} />}
          view={<span className="artifacts-view-toggle"><ToggleGroup value={view} onValueChange={setView} size="md" aria-label="View" options={[{ value: 'grid', label: 'Grid', icon: Ico.grid(13) }, { value: 'list', label: 'List', icon: Ico.list(13) }]} /></span>}
        />
      )}

      {total === 0 ? (
        <EmptyState
          icon={<span className="inline-flex text-ink-5">{Ico.sparkle(32)}</span>}
          title="No artifacts yet"
          description={`When ${agentLabel} creates documents, dashboards, or code outputs they'll appear here.`}
          style={{ flex: 1 }}
        />
      ) : effectiveView === 'grid' ? (
        <div className="artifacts-grid pt-1.5 px-8 pb-[60px] mt-[18px]">
          {/* Grid layout (display + responsive columns + gap) lives in CSS
              (.artifacts-grid in globals.css): 2 cols, 3 when wide, 1 on
              mobile — pure CSS media queries, no JS resize listener. */}
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
              phase={statusByPath[a.path]}
              onRetry={() => handlePublish(a)}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      ) : (
        <div className="pt-1.5 px-8 pb-[60px] mt-[18px]">
          <ListHeaderRow />
          {visible.map((a) => (
            <ArtifactRow
              key={a.id || a.path}
              artifact={a}
              projects={projects}
              onOpenViewer={setViewer}
              onPublish={handlePublish}
              onUnpublish={handleUnpublish}
              onUpdate={handleUpdate}
              onDelete={handleTrash}
              onOpenProject={onOpenProject}
              phase={statusByPath[a.path]}
              onRetry={() => handlePublish(a)}
            />
          ))}
        </div>
      )}

      <ArtifactViewer
        open={!!viewer}
        artifact={viewer}
        onClose={() => setViewer(null)}
        onChange={updateOne}
        onDelete={removeOne}
        onPublish={handlePublish}
        onAddressWithAgent={onAddressWithAgent}
        // No host chat here — the viewer asks which one a repair belongs to.
        resolveRepairConversation={resolveRepairConversation}
      />

      {publishTarget && (
        <PublishDialog
          artifact={publishTarget}
          onCancel={() => { setPublishTarget(null); settlePublish(); }}
          onConfirm={confirmPublish}
        />
      )}

      <HoverMenu
        open={!!menuFor}
        anchorRect={menuFor?.rect}
        onClose={() => setMenuFor(null)}
        items={(() => {
          const a = menuFor?.artifact;
          if (!a) return [];
          const isHtml = isHtmlArtifact(a);
          const isBackend = isBackendArtifact(a);
          const published = !!a.publishedUrl;
          const busyA = busyPaths.has(a.path);
          const items = [];
          const canManage = a.capabilities?.canEdit !== false;
          if (published) {
            if (a.modified) {
              items.push({
                id: 'update',
                label: busyA ? 'Working…' : 'Update',
                icon: Ico.refresh(13),
                onClick: () => handleUpdate(a),
              });
            }
            items.push({
              id: 'unpublish',
              label: busyA ? 'Working…' : 'Stop sharing',
              icon: Ico.power(13),
              onClick: () => handleUnpublish(a),
            });
          } else if (isHtml) {
            items.push({
              id: 'publish',
              label: busyA ? 'Sharing…' : 'Share',
              icon: Ico.power(13),
              onClick: () => handlePublish(a),
            });
          }
          // Desktop keeps images here — the viewer renders them, and this menu
          // used to be the only way in (a click on an image card hands the file
          // to the OS instead, which is what it did before this branch too).
          if (orgMode ? canPreviewOrgDraft(a) : canPreviewLocally(a)) {
            items.push({
              id: 'preview',
              label: 'Preview',
              icon: (Ico.eye?.(13) || Ico.sparkle(13)),
              onClick: () => setViewer(a),
            });
          }
          /*
           * Fullstack static HTML needs its backend, so desktop opens it only through a published
           * URL.
           * Org menus offer every published artifact’s shared page independently of draft preview
           * support.
           */
          if (orgMode ? published : (isHtml && (!isBackend || published))) {
            items.push({
              id: 'open',
              label: orgMode ? 'Open shared link' : 'Open in browser',
              icon: (Ico.link?.(13) || Ico.globe?.(13) || Ico.doc(13)),
              /* Await the bridge call so rejection reaches the browser fallback. */
              onClick: async () => {
                if (a.publishedUrl) {
                  try { await host.openExternal(a.publishedUrl); }
                  catch { window.open(a.publishedUrl, '_blank', 'noopener,noreferrer'); }
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
          /* Org downloads use the authenticated draft URL for primary-file bytes. */
          if (orgMode && canDownloadOrgDraft(a)) {
            items.push({
              id: 'download',
              label: 'Download',
              icon: Ico.download(13),
              onClick: () => downloadWithFeedback(a, toastManager),
            });
          }
          if (canManage) {
            items.push({ separator: true });
            items.push({
              id: 'delete',
              // Disable deletion while remote cleanup runs so delayed removal does not invite
              // duplicate clicks.
              label: busyA ? 'Deleting…' : 'Delete',
              icon: Ico.trash(13),
              danger: true,
              disabled: busyA,
              onClick: () => handleTrash(a),
            });
          }
          // Same mode gate the list view's menu applies — see lib/artifactActions.
          // Note this menu marks its rule with `separator`, not `divider` like
          // ArtifactMenu, so the pass-through key differs.
          return items.filter((it) => it.separator || isArtifactActionAvailable(it.id, {
            orgMode, hasBridge: host.isElectron, published, hasDraft: canDownloadOrgDraft(a),
          }));
        })()}
      />
    </div>
  );
}
