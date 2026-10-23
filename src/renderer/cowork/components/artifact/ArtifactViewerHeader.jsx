import Ico from '../Icons';
import { Button, Menu, Tooltip } from '../ui';
import { host } from '../../../platform/host';
import { useOrgMode } from '../../../lib/orgMode';
import { isHtmlArtifact, isImageArtifact } from '../../lib/artifactKinds';
import { artifactExportFormats } from '../../lib/artifactExport';
import { PublishMenu } from './publish/PublishMenu';
import { ArtifactModeTabs } from './workspace/ArtifactModeTabs';
import { ArtifactAuthorshipBadge } from '../artifacts/ArtifactAuthorshipBadge';
import { IconButton } from './ArtifactViewerIconButton';
import { PreviewErrorsButton } from './PreviewErrorsButton';
import { ArtifactExportMenu } from './export/ArtifactExportMenu';

/*
 * Besides HTML and images, what a browser tab shows from the file's URL. The
 * serve route types a .csv as text/csv, which Chrome saves rather than shows,
 * so it is left out even though the viewer previews it.
 */
const BROWSER_TAB_EXTS = ['.md', '.txt', '.pdf'];

/*
 * Whether a browser tab shows this file rather than saving it, matched on the
 * declared `ext` and the path like the kind predicates in artifactKinds.js. On
 * web a tab opened on any other file's serve or draft URL saves the file
 * without a word. A published artifact opens its shared page, which a tab
 * always shows.
 */
function showsInBrowserTab(artifact, isPublished) {
  if (isPublished) return true;
  const ext = (artifact?.ext || '').toLowerCase();
  const path = (artifact?.path || '').toLowerCase();
  return isHtmlArtifact(artifact) || isImageArtifact(artifact)
    || BROWSER_TAB_EXTS.some((tabExt) => ext === tabExt || path.endsWith(tabExt));
}

export function ArtifactViewerHeader({
  title,
  authorship = null,
  workspace,
  review,
  publication,
  actions,
  // `{ errors, dismissed, dismiss }` from usePreviewDiagnostics.
  diagnostics,
  onClose,
}) {
  const orgMode = useOrgMode();
  const {
    enabled: commentsEnabled,
    open: commentsOpen,
    controller: comments,
    onToggle: toggleComments,
  } = review;
  const {
    canManage,
    publishable,
    controller: pub,
    hasActionPath,
    isPublished,
    disabledReason,
  } = publication;
  const {
    canOpenInBrowserTab,
    canOpenLocalFile,
    isBackendArtifact,
    backendPort,
    artifact,
    deleteBusy,
    onReload,
    onOpenInBrowserTab,
    onOpenFolder,
    onOpenOS,
    onDownload,
    onTrash,
  } = actions;
  /* A file to save needs a serve or draft URL. A full-stack app's primary file
     is its static shell, not the app, so it offers none. */
  const canDownload = !isBackendArtifact && !!(artifact?.serveUrl || artifact?.draftUrl);
  /* The tab-only rule is a web rule: on desktop an unpublished file opens in
     its default app instead, as it always has. Org mode serves no file a tab
     can load without the bearer, so there a tab opens only the shared page,
     as Live Artifacts' arrow does. */
  const canOpenAsTab = orgMode
    ? isPublished
    : (!host.isWeb || showsInBrowserTab(artifact, isPublished));
  const exportFormats = artifactExportFormats(workspace, artifact);
  const openDisabled = !hasActionPath || (isBackendArtifact && !backendPort);
  const openMenuItems = [
    ...(canDownload ? [{
      label: 'Download',
      icon: Ico.download(14),
      onClick: onDownload,
    }] : []),
    ...(canOpenLocalFile ? [{
      label: host.isMac() ? 'Show in Finder' : 'Show in folder',
      icon: Ico.openFolder(14),
      onClick: onOpenFolder,
    }] : []),
  ];
  const workspaceLoading = workspace.status === 'idle' || workspace.status === 'loading';
  /* A file the viewer only previews says so first: a card too old for the
     workspace would otherwise read "Refresh", and a refresh never makes it
     editable. The workspace hook sets `previewOnly` with its reason. */
  const editDisabledReason = workspace.previewOnly
    ? workspace.unsupportedReason || 'This artifact cannot be edited here'
    : !workspace.supported
      ? 'Refresh the artifact to load editing tools'
      : workspaceLoading
        ? 'Loading editing tools…'
        : workspace.capabilities?.canEdit === false
          ? 'Only the artifact owner can edit'
          // "Too old to edit" and "never shared with you" both land in the
          // `unsupported` status; the hook names which one so the tooltip doesn't
          // send the user looking in the wrong place.
          : workspace.unsupportedReason || 'This artifact cannot be edited here';
  const reviewDisabledReason = workspace.previewOnly
    ? workspace.unsupportedReason || 'Review is not available for this artifact'
    : !workspace.supported
      ? 'Refresh the artifact to load review tools'
      : workspaceLoading
        ? 'Loading review tools…'
        : workspace.unsupportedReason || 'Review is not available for this artifact';
  return (
    <div className="artifact-viewer-topbar" style={{
      flex: '0 0 auto',
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px',
      borderBottom: '1px solid var(--line)',
      background: 'var(--surface)',
    }}>
      {/* Left — artifact title. */}
      <div className="artifact-viewer-title-zone" style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
        <div
          id="artifact-viewer-title"
          className="s-h3"
          title={title}
          style={{
            color: 'var(--ink)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            minWidth: 0, paddingRight: 12,
          }}
        >{title}</div>
        {/* "Another member" / "Unknown owner" (ENG-2979). Renders nothing for
            the viewer's own artifact. A direct flex child of this zone
            (Tooltip renders the badge as its own trigger), so `shrink-0`
            keeps it whole while the title truncates. */}
        <ArtifactAuthorshipBadge authorship={authorship} className="shrink-0" />
      </div>

      {/* Middle — the artifact's three working modes. */}
      <div className="artifact-viewer-mode-zone" style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <ArtifactModeTabs
          value={workspace.mode}
          onChange={workspace.setMode}
          canEdit={!!workspace.source && workspace.capabilities?.canEdit !== false}
          canReview={commentsEnabled}
          editDisabledReason={editDisabledReason}
          reviewDisabledReason={reviewDisabledReason}
        />
        {/* Beside the tabs rather than in the ⋯ menu: that menu is hidden in org
            mode because its other entries are OS/file actions and `/publish`
            routes an org deployment cannot answer, and this belongs on both.
            Hidden outright when there is no URL to open — a button that opens
            nothing is worse than no button. Hidden on web, too, for a file a
            tab would save instead of show. */}
        {canOpenInBrowserTab && canOpenAsTab && (
          <Tooltip content="Open in a browser tab">
            <IconButton aria-label="Open in a browser tab" onClick={onOpenInBrowserTab}>
              {Ico.arrowUpRight(16)}
            </IconButton>
          </Tooltip>
        )}
      </div>

      {/* Right — preview errors, comments, publishing, more actions, and close. */}
      <div className="artifact-viewer-action-zone" style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        {diagnostics && <PreviewErrorsButton diagnostics={diagnostics} />}
        {commentsEnabled && (
          <div style={{ position: 'relative' }}>
            <Tooltip content={commentsOpen ? 'Hide comments' : 'Comments'}>
              <IconButton
                aria-label={comments.unreadCount > 0
                  ? `Comments, ${comments.unreadCount} unread`
                  : 'Comments'}
                onClick={toggleComments}
                active={commentsOpen}
              >
                {Ico.chats(16)}
              </IconButton>
            </Tooltip>
            {comments.unreadCount > 0 && (
              <span className="artifact-feedback-badge" aria-hidden="true">
                {Math.min(99, comments.unreadCount)}
              </span>
            )}
          </div>
        )}
        {/* Sharing is owner-side chrome on BOTH deployments now. It used to be
            desktop-only, on the grounds that org mode's window is a review
            surface and publishing "lives on the gallery card instead" — but the
            card filters publish out in org mode too, so that left Cloud with no
            way to share at all (ENG-2316). On Cloud this changes the audience of
            an already-autopublished artifact; the controller handles the
            transport difference. */}
        {canManage && publishable && (
          <PublishMenu
            controller={pub}
            disabled={!orgMode && !hasActionPath}
            disabledReason={disabledReason}
          />
        )}
        {/* Download is a visible control on every web host, org mode included,
            where the ⋯ menu is hidden. Desktop opens the file in its default
            app instead, and keeps Download in the Open button's menu. */}
        {host.isWeb && canDownload && (
          <Tooltip content="Download">
            <IconButton aria-label="Download" onClick={onDownload}>
              {Ico.download(16)}
            </IconButton>
          </Tooltip>
        )}
        {!host.isWeb && (
          <div style={{ display: 'inline-flex', alignItems: 'center' }}>
            <Button
              size="sm"
              disabled={openDisabled}
              title={isBackendArtifact && !backendPort ? 'Waiting for backend port…' : undefined}
              onClick={onOpenOS}
              style={openMenuItems.length > 0 ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : undefined}
            >
              {Ico.externalLink(14)} Open
            </Button>
            {openMenuItems.length > 0 && (
              <Menu
                ariaLabel="Open options"
                align="end"
                width={190}
                trigger={
                  <Button
                    size="sm"
                    icon
                    aria-label="More ways to open"
                    style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeftWidth: 0 }}
                  >
                    {Ico.chevDown(14)}
                  </Button>
                }
                items={openMenuItems}
              />
            )}
          </div>
        )}
        {/* Lists only the server's `exportFormats`, which cowork-server's
            artifact_capabilities() leaves empty for a caller who can't edit,
            so a reviewer and an ownerless artifact get no Export. An older
            server sends no list and gets none either. The route is addressed
            by the draft URL, so no draft URL means no Export. */}
        {exportFormats.length > 0 && artifact?.draftUrl && (
          <ArtifactExportMenu key={artifact.draftUrl} draftUrl={artifact.draftUrl} formats={exportFormats} />
        )}
        {/* Download, Open and Show in folder left this menu when they became
            visible controls, so nothing appears twice. "Open in browser" and
            "Open shared link" left too: they opened the published or serve
            URL, and ArtifactViewer's onOpenInBrowserTab opens that same URL
            from the browser-tab arrow, which shows whenever either exists. */}
        {!orgMode && (
          <Menu
            ariaLabel="Artifact actions"
            align="end"
            width={190}
            trigger={
              <IconButton aria-label="More actions">
                {Ico.moreVert(16)}
              </IconButton>
            }
            items={[
              {
                label: 'Reload preview',
                icon: Ico.reload(14),
                disabled: !hasActionPath,
                onClick: onReload,
              },
              { divider: true },
              {
                label: 'Delete',
                icon: Ico.trash(14),
                danger: true,
                disabled: deleteBusy || !hasActionPath || !canManage,
                onClick: onTrash,
              },
            ].filter((item) => canManage || item.label !== 'Delete')}
          />
        )}
        <Tooltip content="Close">
          <IconButton onClick={onClose} aria-label="Close">{Ico.close(16)}</IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

export default ArtifactViewerHeader;
