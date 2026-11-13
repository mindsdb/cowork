import Ico from '../Icons';
import { Button, Menu, Tooltip } from '../ui';
import { host } from '../../../platform/host';
import { useOrgMode } from '../../../lib/orgMode';
import { canDownloadArtifact, canShowInBrowserTab } from '../../lib/artifactKinds';
import { artifactExportFormats } from '../../lib/artifactExport';
import { PublishMenu } from './publish/PublishMenu';
import { ArtifactAddressPill } from './ArtifactAddressPill';
import { ArtifactAuthorshipBadge } from '../artifacts/ArtifactAuthorshipBadge';
import { IconButton } from './ArtifactViewerIconButton';
import { PreviewErrorsButton } from './PreviewErrorsButton';
import { ArtifactExportMenu } from './export/ArtifactExportMenu';
import { useTranslation } from '../../../lib/i18n';

export function ArtifactViewerHeader({
  title,
  authorship = null,
  workspace,
  review,
  // `{ open, onToggle }` for the Stats side panel; absent on surfaces without it.
  stats = null,
  publication,
  actions,
  // `{ errors, dismissed, dismiss }` from usePreviewDiagnostics.
  diagnostics,
  // The address pill: `{ kind, url, fallback }`.
  address = null,
  onClose,
}) {
  const { t } = useTranslation('artifacts');
  const orgMode = useOrgMode();
  // Comments is a layer toggle on the revision line now (ENG-4227); `review`
  // stays in the props for callers that pass it.
  void review;
  const {
    canManage,
    publishable,
    controller: pub,
    hasActionPath,
    isPublished,
    disabledReason,
  } = publication;
  const showStats = !!stats && isPublished && canManage;
  // A caller with no address to give still gets the pill, named by the
  // title, so ↗ keeps its place.
  const shownAddress = address || { kind: isPublished ? 'published' : 'draft', url: '', fallback: title };
  const {
    canOpenInBrowserTab,
    canOpenLocalFile,
    isBackendArtifact,
    isLiveApp,
    opensDraftLinkInTab,
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
  const canDownload = canDownloadArtifact(artifact);
  /* The tab-only rule is a web rule: on desktop an unpublished file opens in
     its default app instead, as it always has. Org mode serves no file a tab
     can load without the bearer, so there a tab opens only the shared page,
     as Live Artifacts' arrow does. A published artifact opens its shared
     page, which a tab always shows. A live app opens at the address where it
     runs, which is a page in every mode, not a file a tab could save. With
     draft links on, an unshared draft the preview opens by a signed link
     opens one in the tab too, which needs no bearer. */
  const canOpenAsTab = isLiveApp || opensDraftLinkInTab || (orgMode
    ? isPublished
    : (!host.isWeb || isPublished || canShowInBrowserTab(artifact)));
  const exportFormats = artifactExportFormats(workspace, artifact);
  const openDisabled = !hasActionPath || (isBackendArtifact && !backendPort);
  const openMenuItems = [
    ...(canDownload ? [{
      label: t('documentPreview.download'),
      icon: Ico.download(14),
      onClick: onDownload,
    }] : []),
    ...(canOpenLocalFile ? [{
      label: host.isMac() ? t('header.showInFinder') : t('header.showInFolder'),
      icon: Ico.openFolder(14),
      onClick: onOpenFolder,
    }] : []),
  ];
  return (
    // Three columns, 1fr auto 1fr (artifactWorkspace.css): the address pill
    // in the true centre, the title and the actions on either side.
    <div className="artifact-viewer-topbar is-centered" style={{
      flex: '0 0 auto',
      padding: '10px 12px',
      borderBottom: '1px solid var(--line)',
      background: 'var(--surface)',
    }}>
      {/* Left — artifact title. */}
      <div className="artifact-viewer-title-zone" style={{ minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
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

      {/* Middle — the artifact's address, with copy and open-in-a-tab. ↗ is
          here rather than in the ⋯ menu, which org mode hides, and is offered
          by the same rule as before: never a button that opens nothing, nor a
          tab that would save a file instead of showing it. */}
      <div className="artifact-viewer-mode-zone" style={{ minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {shownAddress && (
          <ArtifactAddressPill
            kind={shownAddress.kind}
            url={shownAddress.url}
            fallback={shownAddress.fallback}
            canOpen={!!canOpenInBrowserTab && canOpenAsTab}
            onOpen={onOpenInBrowserTab}
          />
        )}
      </div>

      {/* Right — preview errors, comments, stats, publishing, more actions, and close. */}
      <div className="artifact-viewer-action-zone" style={{ minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        {diagnostics && <PreviewErrorsButton diagnostics={diagnostics} />}
        {showStats && (
          <Tooltip content={stats.open ? t('stats.toggle.hide') : t('stats.toggle.show')}>
            <IconButton aria-label={t('stats.toggle.show')} onClick={stats.onToggle} active={!!stats.open}>
              {Ico.chartColumn(16)}
            </IconButton>
          </Tooltip>
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
          <Tooltip content={t('documentPreview.download')}>
            <IconButton aria-label={t('documentPreview.download')} onClick={onDownload}>
              {Ico.download(16)}
            </IconButton>
          </Tooltip>
        )}
        {!host.isWeb && (
          <div style={{ display: 'inline-flex', alignItems: 'center' }}>
            <Button
              size="sm"
              disabled={openDisabled}
              title={isBackendArtifact && !backendPort ? t('header.waitingForPort') : undefined}
              onClick={onOpenOS}
              style={openMenuItems.length > 0 ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : undefined}
            >
              {Ico.externalLink(14)} {t('documentPreview.open')}
            </Button>
            {openMenuItems.length > 0 && (
              <Menu
                ariaLabel={t('header.openOptions')}
                align="end"
                width={190}
                trigger={
                  <Button
                    size="sm"
                    icon
                    aria-label={t('header.moreWaysToOpen')}
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
            ariaLabel={t('header.artifactActions')}
            align="end"
            width={190}
            trigger={
              <IconButton aria-label={t('header.moreActions')}>
                {Ico.moreVert(16)}
              </IconButton>
            }
            items={[
              {
                label: t('header.reloadPreview'),
                icon: Ico.reload(14),
                disabled: !hasActionPath,
                onClick: onReload,
              },
              { divider: true },
              {
                label: t('common.delete'),
                key: 'delete',
                icon: Ico.trash(14),
                danger: true,
                disabled: deleteBusy || !hasActionPath || !canManage,
                onClick: onTrash,
              },
            ].filter((item) => canManage || item.key !== 'delete')}
          />
        )}
        <Tooltip content={t('header.close')}>
          <IconButton onClick={onClose} aria-label={t('header.close')}>{Ico.close(16)}</IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

export default ArtifactViewerHeader;
