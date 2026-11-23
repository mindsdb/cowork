import { downloadUnavailableMessage } from '../lib/browserDownload';
// Live artifacts page — mirrors the Projects header / filter pattern.
//
// Header:    "Live artifacts" Inter title + Inter subtitle (no CTA —
//            artifacts are produced by Anton, not authored here).
// Filter:    search (⌘K) · sort pill · count · grid/list toggle.
// Sort:      default "Published first", then Recent · Oldest · Title · Type.
// Grid:      ArtifactBubble cards as today (HTML preview, URL pill,
//            Publish/Unpublish action).
// List:      kit rows (ListGroup / ListItem) — icon · title · filename, then
//            status · project · updated inline, ↗ and ⋯ shown at rest.

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { projectLabel } from '../lib/projectLabel';
import Ico from '../components/Icons';
import { Card } from '../components/ui/Card';
import OverflowMenu from '../components/OverflowMenu';
import { useToastManager } from '../components/ui/Toast';
import { Button, Tooltip } from '../components/ui';
import { badgeVariants } from '../components/ui/Badge';
import { cn } from '../lib/cn';
import {
  revealArtifact, publishArtifact, unpublishArtifact, updateArtifact,
  publishTargetPath, artifactServeUrl, openArtifactFile,
} from '../api';
import { copyText } from '../lib/clipboard';
import { projectNameOf } from '../lib/artifactProject';
import {
  noPreviewDownloadedNote, artifactOpenTarget, isArtifactActionAvailable, needsClientUnpublishBeforeDelete,
} from '../lib/artifactActions';
import { deleteArtifactAndSync } from '../lib/artifactsStore';
import { useOrgMode } from '../../lib/orgMode';
import { useLiveApps } from '../../lib/liveApps';
import { shareLiveAppLabel, canShareLiveApp, isLiveAppCard } from '../lib/liveAppSharing';
import {
  launchLiveAppLabel, canLaunchLiveApp, launchLiveAppPrompt, liveAppLines, liveAppOpenAddress,
} from '../lib/liveAppState';
import { useLiveAppStates } from '../hooks/useLiveAppStates';
import { LiveAppShareDialog } from '../components/artifacts/LiveAppShareDialog';
import { SharedLiveAppsSection } from '../components/artifacts/SharedLiveAppsSection';
import { downloadArtifactFile } from '../lib/artifactDownload';
import {
  canDownloadArtifact, canDownloadOrgDraft, canPreviewLocally, canPreviewOrgDraft, canShowInBrowserTab,
  isHtmlArtifact, isPublishableArtifact, isBackendArtifact, isInlinePreviewable,
} from '../lib/artifactKinds';
import { canPreviewDocument } from '../preview/kinds';
import { trackArtifactPublished } from '../lib/analytics';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';
import { ArtifactViewer } from '../components/artifact';
import {
  AccessChooser,
  accessDraftFromArtifact,
  isAccessDraftValid,
  buildAccessPayload,
} from '../components/artifact/publish/AccessChooser';
import { AUDIENCE_CHOICE, groupArtifactsBySection, isOrgSharingOn } from '../lib/orgSharing';
import { useArtifactAudiencesState } from '../hooks/useArtifactAudiences';
import { useKnownPeople, useMindsHubTeams, useSharingCapabilities, useSharingOrgName } from '../hooks/useOrgSharing';
import { artifactOwnerUserId } from '../lib/artifactAuthorship';
import { LOAD_STATUS, readAudienceAnswer, readAudienceRequest } from '../lib/sharingContract';
import { publishFailureReason, publishRefusalMessage } from '../components/artifact/publish/publishErrors';
import {
  publishedPageId, reportAccessChangeFailed, reportAccessChanged, reportLinkCopied, reportShareOpened, reportWithdrawal,
  shareSnapshot,
} from '../lib/artifactShareAnalytics';
import { republishNotice, stopSharingNotice } from '../components/artifact/publish/linkLeftLive';
import { ArtifactIcon, splitArtifactName, displayTitle, fileNameOf, isWebAppArtifact } from '../components/artifacts/ArtifactIcon';
import { ArtifactStatus, ArtifactStatusOrgName } from '../components/artifacts/ArtifactStatus';
import { ArtifactOwnerNamesProvider, useArtifactAuthorship } from '../hooks/useArtifactAuthorship';
import {
  PageHeader,
  FilterRow,
  FilterMenu,
  FilterChips,
  SearchInput,
  SortPill,
  HoverMenu,
  ViewToggle,
  CollectionState,
  ListGroup,
  ListItem,
  ItemActions,
  useCollectionShortcut,
  useCollectionView,
} from '../components/collection';
import { host } from '../../platform/host';
import { surfaceCopy } from '../lib/surface';
import { PLATFORM_UI } from '../../lib/deployment';
import { useRevealOnHover } from '../hooks/useRevealOnHover';
import { forgetOpenCommentCount, useOpenCommentCounts } from '../hooks/useOpenCommentCounts';
import i18n, { useTranslation } from '../../lib/i18n';

const tr = (key, vars) => i18n.t(key, { ns: 'artifacts', ...vars });

const EMPTY_ARTIFACTS = [];

// Page padding of the row group, shared with its loading skeleton so loading
// does not shift the layout.
const LIST_CLASS = 'mx-8 mb-[60px]';

// How long the page waits for what decides its sections (sharing, teams, who
// restricted artifacts reach) before showing anyway, so a slow or failing read
// never leaves it loading (ENG-4585).
export const GROUPING_WAIT_MS = 4000;

// With sharing in the org, artifacts are grouped as skills are (Mine, Shared
// with me, a team, everyone at the org), with the Skills page's icons.
const SECTION_ICONS = {
  mine: Ico.lock,
  shared_with_me: Ico.user,
  team: Ico.people,
  org: Ico.building,
};

function SectionTitle({ section }) {
  return (
    <h2 className="flex items-center gap-2">
      <span className="inline-flex text-ink-4" aria-hidden="true">{SECTION_ICONS[section.id](14)}</span>
      {section.title}
    </h2>
  );
}

// Sort options for the artifacts collection. Per-page (publishing
// state isn't relevant to other collections).
// Labels are artifactsView.sort.<id>, translated where the pill renders.
const SORT_IDS = ['published', 'recent', 'oldest', 'title', 'type'];

// ─── Helpers ─────────────────────────────────────────────────────────────

// projectNameOf moved to lib/artifactProject.js — in org mode the list spans every
// project of the organization, so the label has to come from the card's projectId /
// projectName rather than from its filesystem path.

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

// "Updated" is pre-formatted by the server (e.g. "3h ago") from the same
// content_mtime this sorts by (ENG-1123 Bug 2) — so the sort order and the
// printed age can no longer disagree. a.mtime is always a plain number of
// seconds (content_mtime) or absent/0 — never a string, so no Date.parse.
export function timestampOf(a) {
  return a.mtime || 0;
}

// Kind pill — short uppercase tag for the file type. Pulls from
// `artifact.kind` or falls back to the file extension.
// Who an artifact belongs to, for the Owner filter: the caller's own, a
// colleague by user id, or someone the server could not name.
const OWNER_ME = 'me';
const OWNER_UNKNOWN = 'unknown';
function ownerKeyOf(a) {
  const caps = a?.capabilities;
  if (!caps || caps.role !== 'reviewer') return OWNER_ME;
  return artifactOwnerUserId(caps) || OWNER_UNKNOWN;
}

// The status a row shows, for the Status filter: shared, not shared yet (a
// kind that can be), or a draft (one that can't).
function statusOf(a) {
  if (a?.publishedUrl) return 'shared';
  return isPublishableArtifact(a) ? 'not_shared' : 'draft';
}

function kindOf(a) {
  if (a.kind) return String(a.kind).toLowerCase();
  const ext = (a.ext || '').replace(/^\./, '').toLowerCase();
  return ext || 'file';
}

// Shared by both comparison levels below, so a numeric-aware order (v2
// before v10) applies consistently to the primary compare AND the filename
// tie-break — using different collator options per level would let the
// tie-break re-introduce the wrong order it's supposed to help fix.
// Locale pinned to 'en' (not `undefined`, i.e. not the runtime's default
// locale) so digit-vs-letter collation order — and therefore this file's
// own test fixtures — can't vary between a developer's machine and CI.
// No `sensitivity: 'base'`: default sensitivity treats "Report" and "report"
// as unequal, which matters here — the tie-break must only ever run when the
// primary text is truly identical on screen, not merely case/accent-equivalent.
const NAME_COLLATOR = new Intl.Collator('en', { numeric: true });

export function titleCompare(a, b) {
  const t = NAME_COLLATOR.compare(displayTitle(a), displayTitle(b));
  if (t !== 0) return t;
  // Tie-break only when a visible secondary line exists on both sides —
  // web-app artifacts render no secondary line, so there is nothing on
  // screen to justify breaking the tie by (falling back to fileNameOf here
  // would reintroduce the exact "invisible sort key" bug this fixes).
  if (isWebAppArtifact(a) || isWebAppArtifact(b)) return 0;
  return NAME_COLLATOR.compare(fileNameOf(a), fileNameOf(b));
}

// Publish visibility chooser — a thin wrapper over the shared
// <AccessChooser>. Owns only the draft + dialog chrome; the Public /
// Password / Restricted UI and its validation live in one place now.
// On confirm it hands back the access payload. Re-publishing pre-fills
// the existing selection.
function PublishDialog({ artifact, onCancel, onConfirm }) {
  const { t } = useTranslation('artifacts');
  const [draft, setDraft] = useState(() => accessDraftFromArtifact(artifact));
  if (!artifact) return null;
  const canConfirm = isAccessDraftValid(draft);
  const submit = () => { if (canConfirm) onConfirm(buildAccessPayload(draft)); };

  return (
    <Modal open onClose={onCancel} size="sm" width="min(440px, 94vw)" maxHeight="min(600px, 90vh)" labelledBy="publish-dialog-title">
      <ModalHeader
        id="publish-dialog-title"
        title={t('publish.shareToWeb')}
        subtitle={artifact.title || artifact.path?.split('/').pop()}
        onClose={onCancel}
      />
      <ModalBody>
        <div className="font-[family-name:var(--font-body)] font-semibold text-sm text-ink mb-2">
          {t('publish.whoCanAccess')}
        </div>
        <AccessChooser value={draft} onChange={setDraft} onSubmit={submit} />
      </ModalBody>
      <ModalFooter cancel={<Button variant="subtle" onClick={onCancel}>{t('common.cancel')}</Button>}>
        <Button variant="primary" onClick={submit} disabled={!canConfirm}>
          {draft.mode === AUDIENCE_CHOICE.PASSWORD ? t('artifactsView.shareProtected')
            : draft.mode === AUDIENCE_CHOICE.SPECIFIC ? t('artifactsView.shareRestricted') : t('publish.share')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ─── Card / Bubble (grid view) ───────────────────────────────────────────

// Ghost icon button for the card header (open ↗ / ⋯). forwardRef so the
// kebab can be the anchor for the page-level HoverMenu.
// Hover treatment stays a JS handler (mutates .style on over/out) — a
// deliberate carry-over, not converted to a CSS `hover:` variant here.
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
        color: 'var(--ink-4)', transition: 'background var(--dur-hover) ease, color var(--dur-hover) ease',
      }}
      onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }}
      onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-4)'; }}
    >
      {children}
    </button>
  );
});

/*
 * Download with feedback. `downloadArtifactFile` is async and fallible — an
 * expired bearer, a file deleted server-side, or a network drop resolves it
 * false — and a discarded promise leaves the click doing nothing at all
 * (review pass 2 on #764). Every download this page offers routes through
 * here so the failure reaches a toast. `note`, when given, is a neutral toast
 * shown only once the download succeeded.
 */
async function downloadWithFeedback(artifact, toastManager, { note } = {}) {
  if (!(await downloadArtifactFile(artifact, { entry: 'list' }))) {
    toastManager.add({ title: downloadUnavailableMessage(tr('artifactsView.downloadFailed')), type: 'danger' });
    return;
  }
  if (note) toastManager.add({ title: note });
}

// The owner tag of the viewer's own artifact where a section shares it with
// others (My teams, Everyone at the org): there, whose it is isn't a given.
function useOwnTag(markOwn) {
  const { t } = useTranslation('artifacts');
  return markOwn ? { label: t('artifactsView.owner.you'), description: t('artifactsView.owner.youHint') } : null;
}

// Open comments on one of the caller's own artifacts (ENG-4560): an accent
// pill with the count, drawn only when there is at least one. A click opens
// the preview on its Comments panel, and only that: the row or card under it
// does not open as well.
function OpenCommentsCounter({ count, onOpen }) {
  const { t } = useTranslation('artifacts');
  if (!count || !onOpen) return null;
  const label = t('artifactsView.openComments', { count });
  return (
    <Tooltip
      content={(
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{label}</span>
          <span className="opacity-80">{t('artifactsView.openCommentsHint')}</span>
        </span>
      )}
    >
      <button
        type="button"
        aria-label={label}
        data-testid="open-comments"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        className={cn(
          badgeVariants({ variant: 'accent', size: 'sm' }),
          'm-0 shrink-0 cursor-pointer font-semibold tabular-nums transition-colors',
          'hover:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        )}
      >
        <span className="inline-flex shrink-0" aria-hidden="true">{Ico.chats(12)}</span>
        {count > 99 ? '99+' : count}
      </button>
    </Tooltip>
  );
}

function ArtifactBubble({ artifact, projects = [], onOpenViewer, onOpenComments, openComments = null, onMenuOpen, isMenuOpen, phase, onRetry, onOpenProject, liveLines = null, liveAppCard = false, liveAppAddress = '', markOwn = false }) {
  /* Same open rules as the list row: the body opens the best destination, and
     ↗ opens the artifact outside the app. */
  const { target, openBest, openOutside, canOpenOutside } = useArtifactOpen(artifact, onOpenViewer, { liveAppCard, liveAppAddress });
  const orgMode = useOrgMode();
  const { t } = useTranslation('artifacts');

  const { hoverProps } = useRevealOnHover(isMenuOpen);
  const kebabRef = useRef(null);

  // Not `projectLabel`: that name belongs to the imported
  // `projectLabel(project)` function the tooltip below calls, and shadowing it
  // with this string made that call throw "projectLabel is not a function",
  // blanking the whole page. Not `projectName` either — that name is reserved
  // for slugs (projectLabelSurfaces guards it). This is a resolved display
  // label: projectNameOf routes through projectLabel itself.
  const projectDisplay = projectNameOf(artifact, projects);
  // The project the artifact belongs to. When resolved, the project label
  // becomes a clickable affordance that navigates to that project's page.
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

  // Publishable = HTML + Markdown (isPublishableArtifact — the same predicate
  // the Publish action + backend use); those show "Unpublished", everything
  // else "Draft". Distinct from isWebAppArtifact (icon / name-only), so a .md
  // is a "file" (shows its extension) yet still publishable. The name renders
  // base-truncated with the extension always visible.
  const publishable = isPublishableArtifact(artifact);
  // The owner's name, "Another member" or "Unknown owner" (ENG-2979,
  // ENG-4455). Null for the viewer's own artifact, so ArtifactStatus renders
  // exactly what it did before.
  const ownTag = useOwnTag(markOwn);
  const authorship = useArtifactAuthorship(artifact.capabilities) || ownTag;
  const { base, secondary } = splitArtifactName(artifact);
  // A duplicated live app says whose it was, in the line a web app leaves empty.
  const received = liveLines?.received ?? null;
  // ↗
  const onOpenExternal = (e) => {
    e.stopPropagation();
    openOutside();
  };

  return (
    <Card
      as="div"
      interactive
      padding="none"
      className="railed cw-artifact-card flex flex-col"
      {...hoverProps}
      onActivate={openBest}
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
              title={received || (secondary ? secondary.name + secondary.ext : undefined)}
            >
              {received ? (
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-ink-3">{received}</span>
              ) : secondary && (
                <>
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-ink-3">{secondary.name}</span>
                  <span className="shrink-0 text-ink-4">{secondary.ext}</span>
                </>
              )}
            </div>
          </div>
          {/* Actions — open-in-browser + ⋯ menu. */}
          <div className="flex items-center gap-0.5 shrink-0">
            {canOpenOutside && (
              <Tooltip content={t('documentPreview.open')}>
                <CardIconButton ariaLabel={t('documentPreview.open')} onClick={onOpenExternal}>{Ico.externalLink(16)}</CardIconButton>
              </Tooltip>
            )}
            <Tooltip content={t('header.moreActions')}>
              <CardIconButton ref={kebabRef} ariaLabel={t('artifactsView.menu')}
                onClick={(e) => { e.stopPropagation(); openMenu(e); }}>
                {Ico.moreVert(16)}
              </CardIconButton>
            </Tooltip>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <ArtifactStatus
            artifact={artifact}
            phase={phase}
            publishable={publishable}
            onRetry={onRetry}
            authorship={authorship}
            orgMode={orgMode}
            // A live app has no page link to report; its state line says what matters.
            pageBadge={!liveAppCard}
          />
          <OpenCommentsCounter
            count={openComments}
            onOpen={target === 'preview' && onOpenComments ? () => onOpenComments(artifact) : null}
          />
        </div>
        {liveLines?.state && (
          <div className="font-[family-name:var(--font-body)] text-[12px] leading-[1.35] text-ink-3">{liveLines.state}</div>
        )}
      </div>

      {/* Footer — project origin + last-updated, divided from the body. */}
      <div className="card__rail flex items-center gap-2 py-[9px] px-4">
        <span className="inline-flex shrink-0 text-ink-4">{Ico.folder(14)}</span>
        {canOpenProject ? (
          <Tooltip content={t('artifactsView.openProject', { project: projectLabel(projectMatch) })}>
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenProject(projectMatch); } }}
              style={{
                all: 'unset', cursor: 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-3)',
                minWidth: 0, flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                transition: 'color var(--dur-hover) ease',
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
//
// Rows sit on the collection kit (ListGroup / ListItem): the title is a real
// button stretched over the row, and anything else clickable (the project
// link, the status badges and their Try again, the ↗ and ⋯ controls) is
// lifted above it. The ↗ and ⋯ controls show at rest, like the grid card's.

async function openUrl(url) {
  try { await host.openExternal(url); } catch {}
}

// How a row or a grid card opens. `liveAppAddress` is where an unpublished
// live app runs (liveAppOpenAddress), '' while it isn't running.
function useArtifactOpen(artifact, onOpenViewer, { liveAppCard = false, liveAppAddress = '' } = {}) {
  const orgMode = useOrgMode();
  const toastManager = useToastManager();
  const published = !!artifact.publishedUrl;
  // In the browser the artifact's address is its HTTP serve URL, not a local
  // OS path the user can't reach — open that "private" URL instead.
  const privateUrl = !orgMode && host.isWeb ? artifactServeUrl(artifact) : '';
  /*
   * A click means "show me this artifact" in both deployments: Desktop renders
   * the local bytes, org mode renders the authenticated draft. What org mode
   * cannot render (a fullstack app, an image) falls through to the shared
   * page, then to a download. Desktop hands an image to the default app; with
   * no shell to hand it to, the viewer shows it, as the chat card does. The
   * document types join both previews wherever the shared document gate
   * allows them.
   */
  const hasBridge = host.isElectron;
  const canPreviewDoc = canPreviewDocument(artifact, host);
  const target = artifactOpenTarget({
    orgMode,
    published,
    canPreviewInline: (hasBridge ? isInlinePreviewable(artifact) : canPreviewLocally(artifact)) || canPreviewDoc,
    canPreviewDraft: canPreviewOrgDraft(artifact) || canPreviewDoc,
    hasBridge,
    hasDraft: canDownloadOrgDraft(artifact),
    canDownload: canDownloadArtifact(artifact),
  });

  /*
   * Open the live thing: the viewer, else a download that says why, else the
   * shared page. Desktop tries the shared page before it hands the file to the
   * default app.
   */
  const openBest = () => {
    if (target === 'preview') onOpenViewer?.(artifact);
    else if (target === 'download') downloadWithFeedback(artifact, toastManager, { note: noPreviewDownloadedNote() });
    else if (published) openUrl(artifact.publishedUrl);
    else if (target === 'os') openArtifactFile(artifact);
  };
  /* ↗ skips the viewer: the shared page, else the serve URL, else the file.
     Org mode has no serve URL and no local file, so there ↗ opens only the
     shared page. A live app opens only where it runs: the serve URL's copy of
     its page has no backend. */
  const openOutside = async () => {
    if (liveAppCard) {
      if (liveAppAddress) await openUrl(liveAppAddress);
      return;
    }
    const url = published ? artifact.publishedUrl : privateUrl;
    if (url) await openUrl(url);
    else if (!orgMode) openArtifactFile(artifact);
  };
  /* Org mode offers ↗ only once a shared link exists, the same rule as its
     "Open shared link" menu item; an unshared file saves from the menu's
     Download. On web a tab shows only what canShowInBrowserTab allows and
     saves anything else without a word, so ↗ is offered for those alone. A
     live app offers ↗ only while it runs, as its viewer does. */
  const canOpenOutside = liveAppCard
    ? Boolean(liveAppAddress)
    : isArtifactActionAvailable('open', { orgMode, published })
      && (!host.isWeb || canShowInBrowserTab(artifact));
  return { orgMode, toastManager, published, target, openBest, openOutside, canOpenOutside };
}

// Name: title primary, filename secondary (ENG-1123 Bug 1). Web apps have no
// secondary line. The extension always stays visible.
function ArtifactTitle({ artifact }) {
  const { base } = splitArtifactName(artifact);
  return <span title={base}>{base}</span>;
}

function ArtifactFileName({ artifact, liveLines = null }) {
  /* A live app's state, and whom a duplicated one came from, in the line a web app leaves empty. */
  const live = liveLines ? [liveLines.state, liveLines.received].filter(Boolean).join(' · ') : '';
  if (live) return <span className="min-w-0 truncate text-ink-3" title={live}>{live}</span>;
  const { secondary } = splitArtifactName(artifact);
  if (!secondary) return null;
  return (
    <span className="flex min-w-0 items-baseline" title={secondary.name + secondary.ext}>
      <span className="min-w-0 truncate text-ink-3">{secondary.name}</span>
      <span className="shrink-0 text-ink-4">{secondary.ext}</span>
    </span>
  );
}

// Project origin. When it resolves to a known project, the label opens it.
function ArtifactProject({ artifact, projects, onOpenProject }) {
  const { t } = useTranslation('artifacts');
  // Not `projectName`: that name is reserved for slugs (projectLabelSurfaces
  // guards it). projectNameOf routes through projectLabel itself.
  const projectDisplay = projectNameOf(artifact, projects);
  const projectMatch = projectOf(artifact, projects);
  const canOpenProject = !!(projectMatch && typeof onOpenProject === 'function');
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="inline-flex shrink-0 text-ink-4">{Ico.folder(14)}</span>
      {canOpenProject ? (
        <ItemActions className="min-w-0 shrink">
          <Tooltip content={t('artifactsView.openProject', { project: projectLabel(projectMatch) })}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
              className="m-0 min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 font-body text-xs text-ink-3 underline-offset-2 transition-colors hover:text-accent hover:underline"
            >{projectDisplay}</button>
          </Tooltip>
        </ItemActions>
      ) : (
        <span title={projectDisplay} className="min-w-0 truncate text-ink-3">{projectDisplay}</span>
      )}
    </span>
  );
}

// Status badges carry tooltips and a Try again link, so they sit above the
// stretched open button.
function ArtifactStatusSlot({ artifact, phase, onRetry, inlineChanges = false, pageBadge = true, markOwn = false }) {
  const orgMode = useOrgMode();
  const ownTag = useOwnTag(markOwn);
  const authorship = useArtifactAuthorship(artifact.capabilities) || ownTag;
  return (
    <ItemActions className="min-w-0 shrink">
      <ArtifactStatus
        orgMode={orgMode}
        artifact={artifact}
        phase={phase}
        // Publishable = HTML + Markdown (isPublishableArtifact — the same
        // predicate the Share action + backend use); those show "Not shared",
        // everything else "Draft".
        publishable={isPublishableArtifact(artifact)}
        onRetry={onRetry}
        inlineChanges={inlineChanges}
        pageBadge={pageBadge}
        // The owner's name, "Another member" or "Unknown owner" (ENG-2979,
        // ENG-4455). Null for the viewer's own artifact.
        authorship={authorship}
      />
    </ItemActions>
  );
}

function ArtifactActions({ onOpen, showOpen, menuItems }) {
  const { t } = useTranslation('artifacts');
  return (
    <>
      {showOpen && (
        <Tooltip content={t('documentPreview.open')}>
          {/* Same ghost icon Button as the menu trigger beside it. */}
          <Button
            icon
            size="sm"
            variant="subtle"
            aria-label={t('documentPreview.open')}
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
          >
            {Ico.externalLink(14)}
          </Button>
        </Tooltip>
      )}
      <OverflowMenu
        items={menuItems}
        label={t('artifactsView.menu')}
        title={t('header.moreActions')}
        icon={Ico.moreVert(16)}
        size="sm"
        zIndex={60}
      />
    </>
  );
}

// The list view's menu. Built separately from the grid's (in the view) — the
// two have always offered different items; the org-mode gate covers both.
function rowMenuItems({ artifact, orgMode, liveApps = false, onOpen, onOpenShared, onPreview, onReveal, onDownload, onCopyUrl, onPublish, onUnpublish, onUpdate, onShareLiveApp, onLaunchLiveApp, onDelete, busy = false, isMacPlatform = false }) {
  const isHtml = isHtmlArtifact(artifact);
  const published = !!artifact.publishedUrl;
  return [
    (orgMode || onOpen) && {
      id: 'open',
      /*
       * "Open viewer" would be a lie in org mode: the row itself previews the
       * authenticated draft there, and this item is the page a collaborator
       * opens. The filter below drops it when nothing is shared yet. Outside
       * org mode the row leaves out onOpen when its click downloads, since the
       * Download item below already does that.
       */
      label: orgMode ? tr('artifactsView.openSharedLink') : (isHtml ? tr('artifactsView.openViewer') : tr('documentPreview.open')),
      icon: Ico.externalLink(14),
      onClick: orgMode ? onOpenShared : onOpen,
    },
    // Org only: on Desktop the item above already opens the viewer.
    orgMode && (canPreviewOrgDraft(artifact) || canPreviewDocument(artifact, host)) && {
      id: 'preview',
      label: tr('modeTabs.preview'),
      icon: (Ico.eye?.(13) || Ico.sparkle(14)),
      onClick: onPreview,
    },
    onReveal && {
      id: 'reveal',
      label: isMacPlatform ? tr('header.showInFinder') : tr('artifactsView.showInExplorer'),
      icon: Ico.folder(14),
      onClick: onReveal,
    },
    /* Presence of EITHER url, checked without building it; a fullstack app's
       primary is only its shell, so it gets none. */
    onDownload && canDownloadArtifact(artifact) && {
      id: 'download',
      label: tr('documentPreview.download'),
      icon: Ico.download(14),
      onClick: onDownload,
    },
    published && {
      id: 'copy-url',
      label: tr('publish.copyUrl'),
      icon: Ico.copy(14),
      onClick: onCopyUrl,
    },
    published && artifact.modified && {
      id: 'update',
      label: tr('publish.update'),
      icon: Ico.refresh(14),
      onClick: onUpdate,
    },
    // A live app shares through "Share with…": cowork-server refuses it as a page.
    !published && isPublishableArtifact(artifact) && !isLiveAppCard(artifact, liveApps) && {
      id: 'publish',
      label: tr('publish.share'),
      icon: Ico.upload(14),
      onClick: onPublish,
    },
    published && {
      id: 'unpublish',
      label: tr('publish.stopSharing'),
      icon: Ico.upload(14),
      onClick: onUnpublish,
    },
    onShareLiveApp && canShareLiveApp(artifact, liveApps) && {
      id: 'share-live-app',
      label: shareLiveAppLabel(),
      icon: Ico.userPlus(14),
      onClick: onShareLiveApp,
    },
    // Only for an app that isn't running (canLaunchLiveApp), so the caller passes it or not.
    onLaunchLiveApp && {
      id: 'launch-live-app',
      label: launchLiveAppLabel(),
      icon: Ico.play(14),
      onClick: onLaunchLiveApp,
    },
    onDelete && { divider: true },
    onDelete && {
      id: 'delete',
      // See the grid menu's delete for why this is disabled while busy.
      label: busy ? tr('status.deleting') : tr('artifactsView.deleteItem'),
      icon: Ico.trash(14),
      danger: true,
      disabled: busy,
      onClick: onDelete,
    },
  ]
    .filter(Boolean)
    // Mode gate on top of each item's own condition — see lib/artifactActions.
    .filter((it) => it.divider || isArtifactActionAvailable(it.id, {
      orgMode,
      hasBridge: host.isElectron,
      published,
      hasDraft: canDownloadOrgDraft(artifact),
      canDownload: canDownloadArtifact(artifact),
    }));
}

function ArtifactRow({ artifact, projects, onOpenViewer, onOpenComments, openComments = null, onPublish: doPublish, onUnpublish: doUnpublish, onUpdate: doUpdate, onShareLiveApp: doShareLiveApp, onLaunchLiveApp: doLaunchLiveApp, onDelete: doDelete, onOpenProject, phase, onRetry, isMacPlatform, liveLines = null, liveAppCard = false, liveAppAddress = '', markOwn = false }) {
  const { orgMode, toastManager, published, target, openBest, openOutside, canOpenOutside } = useArtifactOpen(artifact, onOpenViewer, { liveAppCard, liveAppAddress });
  const liveApps = useLiveApps();
  const menuItems = rowMenuItems({
    artifact,
    orgMode,
    liveApps,
    onOpen: target === 'download' ? undefined : openBest,
    onOpenShared: () => openUrl(artifact.publishedUrl),
    onPreview: () => onOpenViewer?.(artifact),
    onReveal: host.isWeb ? undefined : () => { try { revealArtifact(artifact.path); } catch { } },
    onDownload: () => downloadWithFeedback(artifact, toastManager),
    onCopyUrl: async () => {
      const copied = published ? await copyText(artifact.publishedUrl) : false;
      if (copied) reportLinkCopied(artifact, { entry: 'list' });
      return copied;
    },
    onPublish: () => doPublish?.(artifact),
    onUnpublish: () => doUnpublish?.(artifact),
    onUpdate: () => doUpdate?.(artifact),
    onShareLiveApp: doShareLiveApp ? () => doShareLiveApp(artifact) : undefined,
    onLaunchLiveApp: doLaunchLiveApp ? () => doLaunchLiveApp(artifact) : undefined,
    onDelete: doDelete && artifact?.capabilities?.canEdit !== false
      ? () => doDelete(artifact)
      : undefined,
    // Derived from `phase` rather than threading a second prop: the row
    // already receives it, and 'deleting' is exactly the window to disable.
    busy: phase === 'deleting',
    isMacPlatform,
  });
  return (
    <ListItem
      leading={<ArtifactIcon artifact={artifact} size={16} />}
      title={<ArtifactTitle artifact={artifact} />}
      description={<ArtifactFileName artifact={artifact} liveLines={liveLines} />}
      onActivate={openBest}
      actions={<ArtifactActions onOpen={openOutside} showOpen={canOpenOutside} menuItems={menuItems} />}
      meta={(
        <>
          <ArtifactStatusSlot
            artifact={artifact}
            phase={phase}
            onRetry={onRetry}
            inlineChanges
            pageBadge={!liveAppCard}
            markOwn={markOwn}
          />
          {openComments > 0 && target === 'preview' && onOpenComments && (
            <ItemActions>
              <OpenCommentsCounter count={openComments} onOpen={() => onOpenComments(artifact)} />
            </ItemActions>
          )}
          <ArtifactProject artifact={artifact} projects={projects} onOpenProject={onOpenProject} />
          <span className="shrink-0 whitespace-nowrap">{artifact.updated || '—'}</span>
        </>
      )}
    />
  );
}

// ─── Composed view ───────────────────────────────────────────────────────

export default function ArtifactsView({
  artifacts: cards = EMPTY_ARTIFACTS,
  // App owns the list (it also feeds the sidebar count), so publish-state
  // changes go up rather than into a local copy that the next prop would reset.
  // Deletes reach App on their own through artifactsStore.onArtifactDeleted.
  onArtifactChanged,
  // Reads the list again; a copy of a shared live app is new to it.
  onRefreshArtifacts,
  projects = [],
  onOpenProject,
  onAddressWithAgent,
  resolveRepairConversation,
  onOpenConversation,
  agentLabel = 'the agent',
  // True until the app's first artifacts fetch settles; shows skeletons.
  loading = false,
}) {
  // For the grid's shared menu below. The list view's menu (rowMenuItems) reads
  // this for itself; the grid's is built here, so the gate has to be applied at
  // both sites or one view silently keeps the desktop-only actions.
  const orgMode = useOrgMode();
  // In MindsHub mode a restricted card doesn't say who it reaches; read it,
  // so its section, badge and hover say (useArtifactAudiences).
  const { list, settled: audiencesSettled } = useArtifactAudiencesState(cards, { enabled: orgMode });
  const liveApps = useLiveApps();
  // App hands down a new list after each turn, so the states re-read with it.
  const liveAppStates = useLiveAppStates(liveApps, list);
  const linesOf = (a) => liveAppLines(a, { liveApps, states: liveAppStates });
  const liveAddressOf = (a) => liveAppOpenAddress(a, { liveApps, states: liveAppStates });
  // Launch asks the agent in a chat of the app's project, behind the usual card.
  const launchLiveApp = onAddressWithAgent
    ? (a) => onAddressWithAgent({ artifact: a, prompt: launchLiveAppPrompt(a) })
    : null;
  const launchOf = (a) => (launchLiveApp && canLaunchLiveApp(a, { liveApps, states: liveAppStates })
    ? launchLiveApp
    : undefined);
  // Where a copy made from "Shared with you" goes; boot creates it (hooks/useBootDecisions.js).
  const generalProjectId = projects.find((p) => p.name === 'general')?.id || null;
  // The live app whose "Share with…" dialog is open.
  const [shareTarget, setShareTarget] = useState(null);
  // By path, so the viewer always shows the current card and closes once the
  // card leaves the list (e.g. after a delete).
  const [viewerPath, setViewerPath] = useState(null);
  const viewer = viewerPath ? list.find((a) => a.path === viewerPath) || null : null;
  // A new object each time a comments counter opens the viewer: it opens on
  // its Comments panel then (ArtifactViewer's commentsRequest), and as it
  // remembers otherwise.
  const [commentsRequest, setCommentsRequest] = useState(null);
  const openViewer = (artifact, { comments = false } = {}) => {
    setCommentsRequest(comments ? {} : null);
    setViewerPath(artifact?.path || null);
  };
  const openComments = (artifact) => openViewer(artifact, { comments: true });
  // Read again after the viewer closes: its comments may have been resolved
  // or added while it was open.
  const [commentsRefresh, setCommentsRefresh] = useState(0);
  const closeViewer = () => {
    if (viewer) forgetOpenCommentCount(viewer);
    setViewerPath(null);
    setCommentsRequest(null);
    setCommentsRefresh((n) => n + 1);
  };
  // Phones always get the grid (list rows are 5 columns); see ViewToggle.
  const { view, setView, effectiveView } = useCollectionView('anton:artifacts-view');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('published');
  // Per-artifact-path "in flight" set so multiple cards can publish
  // independently without freezing the whole grid.
  const [busyPaths, setBusyPaths] = useState(() => new Set());
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
  const { t } = useTranslation('artifacts');
  const sortOptions = SORT_IDS.map((id) => ({ id, label: t(`artifactsView.sort.${id}`) }));
  const isMacPlatform = host.isMac() || /Mac|iPhone|iPod|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  // Toast surfaces publish/unpublish results — primarily so failures
  // don't disappear into the console.
  const toastManager = useToastManager();
  // A warning names a shared link Cowork left live, so it stays until the
  // person dismisses it.
  const showToast = ({ kind, message }) => toastManager.add(
    kind === 'warning'
      ? { title: message, type: 'warning', timeout: 0 }
      : { title: message, type: kind === 'ok' ? 'success' : 'danger' },
  );
  const searchRef = useRef(null);


  // ⌘K focuses the search input.
  useCollectionShortcut(searchRef);


  const updateOne = (updated) => onArtifactChanged?.(updated);

  const setBusy = (path, isBusy) => {
    setBusyPaths((prev) => {
      const next = new Set(prev);
      if (isBusy) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  // Per-path transient status the status pills read: 'publishing' |
  // 'updating' | 'unpublishing' | 'failed'. Cleared (idle) when the action
  // settles successfully; 'failed' sticks until the user retries. Pure map
  // → the pill is whatever's here, so the status can't get stuck.
  const [statusByPath, setStatusByPath] = useState({});
  const setPhase = (path, phase) => setStatusByPath((prev) => {
    if (!phase) {
      if (!(path in prev)) return prev;
      const { [path]: _drop, ...rest } = prev;
      return rest;
    }
    return { ...prev, [path]: phase };
  });

  // Centralized publish — single source of truth for state updates,
  // toast dispatch, and busy bookkeeping. Mirrors anton's /publish
  // command flow: POST → server zips, scrubs credentials, uploads to
  // MindsHub, persists report_id in `.published.json`. We then reflect
  // the returned URL into App's list so the UI flips to "Published"
  // without a refetch.
  // Publishing is two steps: choose visibility (public / password) in a
  // small dialog, then confirmPublish does the actual POST. Re-publishing
  // a protected artifact pre-fills its existing password.
  const handlePublish = (artifact) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return Promise.resolve();
    if (!isPublishableArtifact(artifact)) {
      showToast({ kind: 'error', message: t('artifactsView.onlyHtmlMd') });
      return Promise.resolve();
    }
    // Settle any prior unresolved flow before starting a new one so a
    // delegated awaiter is never left hanging.
    settlePublish();
    setPublishTarget(artifact);
    reportShareOpened(artifact, { entry: 'list', isShared: shareSnapshot(artifact).shared });
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
        // Each audience field the answer leaves out is the request's
        // (lib/sharingContract reads both).
        const answered = readAudienceAnswer(r);
        const requested = readAudienceRequest(access);
        const saved = {
          ...artifact,
          reportId: publishedPageId(r) || artifact.reportId || '',
          publishedUrl: r.url,
          accessMode: m,
          accessProtected: m === 'password',
          accessPassword: m === 'password' ? (access?.password || '') : '',
          accessEmails: m === 'restricted' ? (answered.emails ?? requested.emails) : [],
          orgAllowed: m === 'restricted' ? (answered.orgAllowed ?? requested.orgAllowed) : false,
          ownerOnly: m === 'restricted' ? (answered.ownerOnly ?? requested.ownerOnly) : false,
        };
        updateOne(saved);
        setPhase(artifact.path, null);
        trackArtifactPublished(r.report_id || artifact.id || '', m);
        reportAccessChanged(artifact, {
          entry: 'list',
          before: shareSnapshot(artifact),
          after: shareSnapshot(saved),
          reportId: publishedPageId(r),
          access,
        });
        showToast({
          kind: 'ok',
          message: t('artifactsView.sharedToast', { mode: m === 'password' || m === 'restricted' ? m : 'other', url: r.url }),
        });
      } else {
        setPhase(artifact.path, 'failed');
        showToast({ kind: 'error', message: t('publish.errors.noUrl') });
      }
    } catch (e) {
      reportAccessChangeFailed(artifact, { entry: 'list', reason: publishFailureReason(e) });
      const msg = e?.message || String(e);
      // Map the failures a user can act on to a clearer message.
      const refusal = publishRefusalMessage(e);
      let friendly = refusal ?? t('publish.errors.sharingFailed', { message: msg });
      if (!refusal && (/minds_api_key/i.test(msg) || /minds api key/i.test(msg))) {
        friendly = t('artifactsView.mindsApiKey');
      }
      /* A refused share (another owner's artifact, or a share with everyone
         the caller may not make) is refused again, so the card keeps its
         state and offers no Try again; the toast says why. */
      setPhase(artifact.path, refusal ? null : 'failed');
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
      const leftLive = stopSharingNotice(await unpublishArtifact(publishTargetPath(artifact)));
      reportWithdrawal(artifact, { entry: 'list', before: shareSnapshot(artifact), leftLive: !!leftLive });
      updateOne({ ...artifact, publishedUrl: '', reportId: '' });
      // Without the platform UI the deployment decides where shares live,
      // so the toast names no service.
      showToast(leftLive
        ? { kind: 'warning', message: leftLive }
        : { kind: 'ok', message: PLATFORM_UI ? t('artifactsView.stoppedOnMindsHub') : t('artifactsView.stopped') });
    } catch (e) {
      showToast({ kind: 'error', message: t('publish.errors.stopFailed', { message: String(e?.message || e) }) });
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
      const replaced = republishNotice(r);
      showToast(replaced ? { kind: 'warning', message: replaced } : { kind: 'ok', message: t('artifactsView.updated') });
    } catch (e) {
      const message = publishRefusalMessage(e) ?? t('publish.errors.updateFailed', { message: String(e?.message || e) });
      showToast({ kind: 'error', message });
    } finally {
      setBusy(artifact.path, false);
      setPhase(artifact.path, null);
    }
  };

  const handleTrash = async (artifact) => {
    if (artifact?.capabilities?.canEdit === false) {
      showToast({ kind: 'error', message: t('artifactsView.ownerOnlyDelete') });
      return;
    }
    if (!artifact?.path || busyPaths.has(artifact.path)) return;
    setBusy(artifact.path, true);
    // Delete is the slowest action on the card — it unpublishes remotely before
    // it removes anything, and in org mode it also mints a turn key first — so
    // without a phase the card sat there looking untouched for seconds and the
    // only feedback was the row vanishing at the end.
    setPhase(artifact.path, 'deleting');
    try {
      // Unpublish first so deletion never leaves an orphaned public copy.
      // If this fails we abort and keep the artifact (the server enforces
      // the same rule as a backstop). Skipped in org mode — see
      // needsClientUnpublishBeforeDelete: there this call 501s and the server's
      // own delete does the unpublish with the right credential.
      let leftLive = '';
      const clientUnpublishes = needsClientUnpublishBeforeDelete({ orgMode, published: artifact.publishedUrl });
      if (clientUnpublishes) {
        leftLive = stopSharingNotice(await unpublishArtifact(artifact.path));
        reportWithdrawal(artifact, { entry: 'list_delete', before: shareSnapshot(artifact), leftLive: !!leftLive });
      }
      await deleteArtifactAndSync(artifact);
      // On Web the delete itself takes the page down, or fails.
      if (!clientUnpublishes && artifact.publishedUrl) {
        reportWithdrawal(artifact, { entry: 'list_delete', before: shareSnapshot(artifact) });
      }
      showToast(leftLive ? { kind: 'warning', message: leftLive } : { kind: 'ok', message: t('artifactsView.deleted') });
    } catch (e) {
      showToast({ kind: 'error', message: t('artifactsView.deleteFailed', { message: String(e?.message || e) }) });
      // Only on failure: on success the row is already gone, and clearing the
      // phase of a removed path would just leave a dead entry in statusByPath.
      setPhase(artifact.path, null);
    } finally {
      setBusy(artifact.path, false);
    }
  };

  // Filter + sort.
  // Type, Status and Owner filters (ENG-4560): a facet only where it would
  // narrow anything, with one way to clear them all.
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const statuses = useMemo(
    () => ['shared', 'not_shared', 'draft'].filter((s) => (list || []).some((a) => statusOf(a) === s)),
    [list],
  );
  const [ownerFilter, setOwnerFilter] = useState('all');
  const kinds = useMemo(() => [...new Set((list || []).map(kindOf))].sort(), [list]);
  const ownerKeys = useMemo(() => [...new Set((list || []).map(ownerKeyOf))], [list]);
  const colleagueIds = useMemo(
    () => ownerKeys.filter((key) => key !== OWNER_ME && key !== OWNER_UNKNOWN),
    [ownerKeys],
  );
  const { people: owners } = useKnownPeople(colleagueIds);
  const ownerName = (id) => {
    const person = owners.find((p) => p.id === id);
    return (person && !person.pending && !person.failed && (person.name || person.email)) || t('artifactsView.filter.anotherMember');
  };
  // A filter on a value the list no longer has would hide everything.
  useEffect(() => { if (typeFilter !== 'all' && !kinds.includes(typeFilter)) setTypeFilter('all'); }, [kinds, typeFilter]);
  useEffect(() => { if (ownerFilter !== 'all' && !ownerKeys.includes(ownerFilter)) setOwnerFilter('all'); }, [ownerKeys, ownerFilter]);
  useEffect(() => { if (statusFilter !== 'all' && !statuses.includes(statusFilter)) setStatusFilter('all'); }, [statuses, statusFilter]);
  const STATUS_LABELS = {
    shared: t('publish.shared'),
    not_shared: t('status.notShared'),
    draft: t('status.draft'),
  };
  const filters = [
    kinds.length > 1 && {
      id: 'type',
      label: t('artifactsView.filter.type'),
      value: typeFilter,
      allValue: 'all',
      onChange: setTypeFilter,
      options: [
        { value: 'all', label: t('artifactsView.filter.allTypes') },
        ...kinds.map((kind) => ({ value: kind, label: kind.toUpperCase() })),
      ],
    },
    statuses.length > 1 && {
      id: 'status',
      label: t('artifactsView.filter.status'),
      value: statusFilter,
      allValue: 'all',
      onChange: setStatusFilter,
      options: [
        { value: 'all', label: t('artifactsView.filter.allStatuses') },
        ...statuses.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
      ],
    },
    ownerKeys.length > 1 && {
      id: 'owner',
      label: t('artifactsView.filter.owner'),
      value: ownerFilter,
      allValue: 'all',
      onChange: setOwnerFilter,
      options: [
        { value: 'all', label: t('artifactsView.filter.allOwners') },
        ...(ownerKeys.includes(OWNER_ME) ? [{ value: OWNER_ME, label: t('artifactsView.filter.me') }] : []),
        ...colleagueIds
          .map((id) => ({ value: id, label: ownerName(id) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        ...(ownerKeys.includes(OWNER_UNKNOWN) ? [{ value: OWNER_UNKNOWN, label: t('artifactsView.filter.unknownOwner') }] : []),
      ],
    },
  ].filter(Boolean);
  const clearFilters = () => { setTypeFilter('all'); setStatusFilter('all'); setOwnerFilter('all'); };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = (list || []).slice();
    if (typeFilter !== 'all') out = out.filter((a) => kindOf(a) === typeFilter);
    if (statusFilter !== 'all') out = out.filter((a) => statusOf(a) === statusFilter);
    if (ownerFilter !== 'all') out = out.filter((a) => ownerKeyOf(a) === ownerFilter);
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
  }, [list, search, sort, typeFilter, statusFilter, ownerFilter]);

  // Open comments on the caller's own artifacts the page shows, read after it
  // paints (useOpenCommentCounts).
  const openCommentsOf = useOpenCommentCounts(visible, { refresh: commentsRefresh });

  const total = (list || []).length;
  const { artifactsNote } = surfaceCopy(host.isWeb);

  // Sections, where the org shares (as on the Skills page); one list elsewhere.
  const sharingState = useSharingCapabilities();
  const sharingCapabilities = sharingState.capabilities;
  const sectionsOn = isOrgSharingOn(sharingCapabilities);
  const orgName = useSharingOrgName(sectionsOn);
  const teamsState = useMindsHubTeams(sectionsOn);
  // The page shows once, in its final sections (ENG-4585): the skeleton stays
  // until, in MindsHub mode, sharing is known (off draws one list, on draws
  // sections) and restricted artifacts' audiences are read (unknown files
  // under Yours), and, wherever sections are on, the teams are in (a default
  // team counts as the org). Once shown it never goes back to the skeleton,
  // so a list that changes after a turn just updates in place.
  const groupingSettled = (!orgMode || sharingState.status !== LOAD_STATUS.LOADING)
    && (!sectionsOn || teamsState.status === LOAD_STATUS.READY)
    && audiencesSettled;
  const [shownOnce, setShownOnce] = useState(false);
  const bodyReady = !loading && (shownOnce || groupingSettled);
  useEffect(() => {
    if (bodyReady && !shownOnce) setShownOnce(true);
  }, [bodyReady, shownOnce]);
  useEffect(() => {
    if (loading || shownOnce) return undefined;
    const timer = setTimeout(() => setShownOnce(true), GROUPING_WAIT_MS);
    return () => clearTimeout(timer);
  }, [loading, shownOnce]);
  const sections = useMemo(
    () => (sectionsOn ? groupArtifactsBySection(visible, { orgName, teams: teamsState?.teams || [] }) : null),
    [sectionsOn, visible, orgName, teamsState?.teams],
  );

  // `section`: the section the item sits in, when the page is grouped.
  const sharedSection = (section) => section === 'team' || section === 'org';
  const renderCard = (a, section) => (
    <ArtifactBubble
      key={a.id || a.path}
      markOwn={sharedSection(section)}
      artifact={a}
      projects={projects}
      onOpenViewer={openViewer}
      onOpenComments={openComments}
      openComments={openCommentsOf(a)}
      onMenuOpen={(art, rect) => setMenuFor((prev) =>
        prev?.artifact?.path === art.path ? null : { artifact: art, rect },
      )}
      isMenuOpen={menuFor?.artifact?.path === a.path}
      phase={statusByPath[a.path]}
      onRetry={() => handlePublish(a)}
      onOpenProject={onOpenProject}
      liveLines={linesOf(a)}
      liveAppCard={isLiveAppCard(a, liveApps)}
      liveAppAddress={liveAddressOf(a)}
    />
  );
  const renderRow = (a, section) => (
    <ArtifactRow
      key={a.id || a.path}
      markOwn={sharedSection(section)}
      artifact={a}
      projects={projects}
      onOpenViewer={openViewer}
      onOpenComments={openComments}
      openComments={openCommentsOf(a)}
      onPublish={handlePublish}
      onUnpublish={handleUnpublish}
      onUpdate={handleUpdate}
      onShareLiveApp={setShareTarget}
      onLaunchLiveApp={launchOf(a)}
      onDelete={handleTrash}
      onOpenProject={onOpenProject}
      phase={statusByPath[a.path]}
      onRetry={() => handlePublish(a)}
      isMacPlatform={isMacPlatform}
      liveLines={linesOf(a)}
      liveAppCard={isLiveAppCard(a, liveApps)}
      liveAppAddress={liveAddressOf(a)}
    />
  );

  return (
    // Background intentionally omitted so the gravity-field canvas
    // painted behind the React root shows through.
    <div
      className="scroll-clean flex-1 overflow-y-auto flex flex-col [container-type:inline-size]"
    >
      <PageHeader
        title={t('artifactsView.title')}
        subtitle={t('artifactsView.subtitle', { agent: agentLabel })}
        // 20px below the subtitle text so the page reads with a
        // little air before the search-row begins. The 20px spacer
        // below the header still adds the standard between-section
        // rhythm — together they make Live Artifacts breathe a touch
        // more than other collection pages, where the action button
        // already anchors the lower edge of the header.
      />

      {/* Subtitle → search-row gap. Set to 20px per the design;
          ProjectsView uses 18px because its header has an anchor
          button on the right ("+ New project"), which reads as
          slightly taller — Artifacts compensates with a few extra.
          shrink-0: this is a flex child of the scroll column, so without it
          the spacer collapses whenever the body overflows (and by a different
          amount in grid vs list, since their heights differ). */}
      <div className="h-5 shrink-0" />

      {liveApps && generalProjectId && (
        <SharedLiveAppsSection
          projectId={generalProjectId}
          // The copy sorts with the viewer's own artifacts, often below the
          // fold, so the toast is what says it worked.
          onDuplicated={() => {
            showToast({ kind: 'ok', message: t('artifactsView.duplicated') });
            onRefreshArtifacts?.();
          }}
          className="mx-8 mb-6"
        />
      )}

      {(loading || total > 0) && (
        <FilterRow
          search={
            <SearchInput
              value={search}
              onChange={setSearch}
              inputRef={searchRef}
              placeholder={t('artifactsView.search')}
            />
          }
          filter={filters.length > 0 ? <FilterMenu filters={filters} /> : undefined}
          chips={filters.length > 0 ? <FilterChips filters={filters} onClear={clearFilters} /> : undefined}
          sort={<SortPill value={sort} onChange={setSort} options={sortOptions} />}
          view={<ViewToggle value={view} onValueChange={setView} />}
        />
      )}

      {/* Every card's owner named in one lookup (ENG-4455), and the org's
          name for "Everyone at ‹org›" badges once for the list. */}
      <ArtifactStatusOrgName.Provider value={orgName}>
      <ArtifactOwnerNamesProvider capabilitiesList={visible.map((a) => a.capabilities)}>
      <CollectionState
        loading={!bodyReady}
        total={total}
        shown={visible.length}
        query={search}
        // Search and the Type and Owner filters all narrow the list, so the
        // copy and the action cover them all.
        onClear={() => { setSearch(''); clearFilters(); }}
        noMatchTitle={filters.length > 0 ? t('artifactsView.filter.noMatch') : undefined}
        clearLabel={filters.length > 0 ? t('artifactsView.filter.clear') : undefined}
        // Each skeleton takes its loaded layout's own wrapper classes.
        skeleton={effectiveView === 'grid' ? 'cards' : 'group'}
        skeletonClassName={effectiveView === 'grid' ? 'px-8 pb-[60px]' : LIST_CLASS}
        skeletonGridClassName="artifacts-grid"
        empty={{
          icon: Ico.sparkle(20),
          title: t('artifactsView.emptyTitle'),
          // Second line (ENG-2169): the two apps keep separate artifacts, so
          // someone looking for work made in the other one is told where it is.
          description: (
            <>
              {t('artifactsView.emptyBody', { agent: agentLabel })}
              {artifactsNote && <span className="block mt-2 text-ink-4">{artifactsNote}</span>}
            </>
          ),
          className: 'mx-8 mb-8',
        }}
      >
        {effectiveView === 'grid' ? (
          sections ? (
            <div className="px-8 pb-[60px] flex flex-col gap-6">
              {sections.map((section) => (
                <section key={section.id} aria-label={section.title} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 font-body text-[13px] font-semibold text-ink">
                    <SectionTitle section={section} />
                    <span className="font-normal text-ink-4" data-testid="section-count">{section.artifacts.length}</span>
                  </div>
                  <div className="artifacts-grid">
                    {section.artifacts.map((a) => renderCard(a, section.id))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="artifacts-grid px-8 pb-[60px]">
              {/* Grid layout (display + responsive columns + gap) lives in CSS
                  (.artifacts-grid in globals.css): 2 cols, 3 when wide, 1 on
                  mobile — pure CSS media queries, no JS resize listener. */}
              {visible.map(renderCard)}
            </div>
          )
        ) : (
          sections ? (
            <div className={`${LIST_CLASS} flex flex-col gap-6`}>
              {sections.map((section) => (
                <ListGroup
                  key={section.id}
                  aria-label={section.title}
                  title={<SectionTitle section={section} />}
                  description={<span data-testid="section-count">{section.artifacts.length}</span>}
                >
                  {section.artifacts.map((a) => renderRow(a, section.id))}
                </ListGroup>
              ))}
            </div>
          ) : (
            <ListGroup className={LIST_CLASS}>
              {visible.map(renderRow)}
            </ListGroup>
          )
        )}
      </CollectionState>
      </ArtifactOwnerNamesProvider>
      </ArtifactStatusOrgName.Provider>

      <ArtifactViewer
        open={!!viewer}
        artifact={viewer}
        onClose={closeViewer}
        commentsRequest={commentsRequest}
        onChange={updateOne}
        // The viewer closes once its card leaves the list, so a link the
        // delete left live is told here instead.
        onDelete={(_path, { notice } = {}) => { if (notice) showToast({ kind: 'warning', message: notice }); }}
        onPublish={handlePublish}
        onAddressWithAgent={onAddressWithAgent}
        // No host chat here — the viewer asks which one a repair belongs to.
        resolveRepairConversation={resolveRepairConversation}
        // The viewer stays open while the agent works in the artifact's chat;
        // "Open in chat" goes there.
        onOpenConversation={onOpenConversation}
      />

      {shareTarget && (
        <LiveAppShareDialog artifact={shareTarget} onClose={() => setShareTarget(null)} />
      )}

      {publishTarget && (
        <PublishDialog
          artifact={publishTarget}
          onCancel={() => { setPublishTarget(null); settlePublish(); }}
          onConfirm={confirmPublish}
        />
      )}

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
          const isBackend = isBackendArtifact(a);
          const published = !!a.publishedUrl;
          const busyA = busyPaths.has(a.path);
          const items = [];
          const canManage = a.capabilities?.canEdit !== false;
          if (published) {
            if (a.modified) {
              items.push({
                id: 'update',
                label: busyA ? t('artifactsView.working') : t('publish.update'),
                icon: Ico.refresh(14),
                onClick: () => handleUpdate(a),
              });
            }
            items.push({
              id: 'unpublish',
              label: busyA ? t('artifactsView.working') : t('publish.stopSharing'),
              icon: Ico.power(14),
              onClick: () => handleUnpublish(a),
            });
          } else if (isHtml && !isLiveAppCard(a, liveApps)) {
            // A live app shares through "Share with…": cowork-server refuses it as a page.
            items.push({
              id: 'publish',
              label: busyA ? t('status.sharing') : t('publish.share'),
              icon: Ico.power(14),
              onClick: () => handlePublish(a),
            });
          }
          // Desktop keeps images here — the viewer renders them, and this menu
          // used to be the only way in (a click on an image card hands the file
          // to the OS instead, which is what it did before this branch too).
          if (canPreviewDocument(a, host) || (orgMode ? canPreviewOrgDraft(a) : canPreviewLocally(a))) {
            items.push({
              id: 'preview',
              label: t('modeTabs.preview'),
              icon: (Ico.eye?.(13) || Ico.sparkle(14)),
              onClick: () => openViewer(a),
            });
          }
          /*
           * Fullstack apps can't be opened from their static entry html
           * (it needs the backend), so only offer "Open in browser" for
           * them once published — then it opens the live public URL.
           * Unpublished fullstack gets no open/reveal item.
           *
           * Org mode asks a different question. The card body previews the
           * draft there, so this item is the page a collaborator opens, and
           * every published artifact needs it — a shared .md would otherwise
           * have no route to its URL from this card at all, because the HTML
           * test below is the only one it ever fails. Grid is the default
           * view and the only view on mobile, so there is no list row to
           * fall back to.
           */
          if (orgMode ? published : (isHtml && (!isBackend || published))) {
            items.push({
              id: 'open',
              label: orgMode ? t('artifactsView.openSharedLink') : t('liveAppPreview.openInBrowser'),
              icon: (Ico.link?.(13) || Ico.globe?.(13) || Ico.doc(14)),
              /*
               * Awaited so a rejected bridge call is caught rather than left
               * unhandled. No raw window.open fallback: host.openExternal is
               * what restricts the agent-writable URL to http(s)/mailto.
               */
              onClick: async () => {
                if (a.publishedUrl) {
                  try { await host.openExternal(a.publishedUrl); } catch {}
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
              label: isMacPlatform ? t('header.showInFinder') : t('artifactsView.showInExplorer'),
              icon: Ico.folder(14),
              onClick: () => { try { revealArtifact(a.path); } catch { } },
            });
          }
          /*
           * Org mode and web: the draft or serve URL is the one route to a
           * file's bytes there. Desktop's grid keeps its existing menu, since the
           * list view already offers Download from `serveUrl`.
           */
          if ((orgMode || host.isWeb) && canDownloadArtifact(a)) {
            items.push({
              id: 'download',
              label: t('documentPreview.download'),
              icon: Ico.download(14),
              onClick: () => downloadWithFeedback(a, toastManager),
            });
          }
          if (canShareLiveApp(a, liveApps)) {
            items.push({
              id: 'share-live-app',
              label: shareLiveAppLabel(),
              icon: Ico.userPlus(14),
              onClick: () => setShareTarget(a),
            });
          }
          const launch = launchOf(a);
          if (launch) {
            items.push({
              id: 'launch-live-app',
              label: launchLiveAppLabel(),
              icon: Ico.play(14),
              onClick: () => launch(a),
            });
          }
          if (canManage) {
            items.push({ separator: true });
            items.push({
              id: 'delete',
              // Delete unpublishes remotely first, so it is the slowest item here.
              // Disabled while it runs: handleTrash already ignores a re-entrant
              // call, but a menu item that still looks clickable reads as "nothing
              // happened" and invites the second click.
              label: busyA ? t('status.deleting') : t('common.delete'),
              icon: Ico.trash(14),
              danger: true,
              disabled: busyA,
              onClick: () => handleTrash(a),
            });
          }
          // Same mode gate the list view's menu applies — see lib/artifactActions.
          // Note this menu marks its rule with `separator`, not `divider` like
          // rowMenuItems, so the pass-through key differs.
          return items.filter((it) => it.separator || isArtifactActionAvailable(it.id, {
            orgMode,
            hasBridge: host.isElectron,
            published,
            hasDraft: canDownloadOrgDraft(a),
            canDownload: canDownloadArtifact(a),
          }));
        })()}
      />
    </div>
  );
}
