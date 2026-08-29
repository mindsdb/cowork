import { forwardRef } from 'react';
import Ico from '../Icons';
import { Menu, Tooltip } from '../ui';
import { host } from '../../../platform/host';
import { useOrgMode } from '../../../lib/orgMode';
import { PublishMenu } from './publish/PublishMenu';
import { ArtifactModeTabs } from './workspace/ArtifactModeTabs';

// Ghost icon button shared by every top-bar affordance (folder, reload,
// open-in-browser, kebab, close). forwardRef so it can be the render
// target of a Base UI Tooltip/Menu trigger (those inject a ref).
//
// `active` gives a persistent toggled-on state (accent-tinted fill + accent
// glyph) that survives mouse-leave — used by the comments switch so it reads
// as on/off, not just a hover. Hover-idle colors are resolved from `active`
// so the two states never fight over the inline background.
const IconButton = forwardRef(function IconButton(
  { size = 30, disabled = false, active = false, style, children, ...rest }, ref,
) {
  const idleBg = active ? 'var(--accent-bg)' : 'transparent';
  const idleFg = active ? 'var(--accent)' : 'var(--ink-3)';
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-pressed={active}
      {...rest}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        background: idleBg, border: 0, color: idleFg,
        width: size, height: size, borderRadius: 8, flexShrink: 0,
        display: 'inline-grid', placeItems: 'center',
        transition: 'background .12s ease, color .12s ease',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = active
            ? 'color-mix(in srgb, var(--accent) 22%, transparent)'
            : 'var(--surface-2)';
          e.currentTarget.style.color = active ? 'var(--accent)' : 'var(--ink)';
        }
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = idleBg;
        e.currentTarget.style.color = idleFg;
        rest.onMouseLeave?.(e);
      }}
    >
      {children}
    </button>
  );
});

export function ArtifactViewerHeader({
  title,
  workspace,
  review,
  publication,
  actions,
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
    canOpenInBrowser,
    canOpenLocalFile,
    isBackendArtifact,
    backendPort,
    artifact,
    deleteBusy,
    onReload,
    onOpenInBrowser,
    onOpenFolder,
    onOpenOS,
    onDownload,
    onTrash,
  } = actions;
  const workspaceLoading = workspace.status === 'idle' || workspace.status === 'loading';
  const editDisabledReason = !workspace.supported
    ? 'Refresh the artifact to load editing tools'
    : workspaceLoading
      ? 'Loading editing tools…'
      : workspace.capabilities?.canEdit === false
        ? 'Only the artifact owner can edit'
        // "Too old to edit" and "never shared with you" both land in the
        // `unsupported` status; the hook names which one so the tooltip doesn't
        // send the user looking in the wrong place.
        : workspace.unsupportedReason || 'This artifact cannot be edited here';
  const reviewDisabledReason = !workspace.supported
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
      </div>

      {/* Right — comments, publishing, more actions, and close. */}
      <div className="artifact-viewer-action-zone" style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
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
                {Ico.chats(18)}
              </IconButton>
            </Tooltip>
            {comments.unreadCount > 0 && (
              <span className="artifact-feedback-badge" aria-hidden="true">
                {Math.min(99, comments.unreadCount)}
              </span>
            )}
          </div>
        )}
        {/* Sharing is owner-side desktop chrome. In org mode this window is a
            review surface for MVP: publishing and the actions below live on the
            gallery card instead, which is also where Delete stays reachable. */}
        {!orgMode && canManage && publishable && (
          <PublishMenu
            controller={pub}
            disabled={!hasActionPath}
            disabledReason={disabledReason}
          />
        )}
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
                icon: Ico.reload(13),
                disabled: !hasActionPath,
                onClick: onReload,
              },
              ...(canOpenInBrowser ? [{
                label: isPublished ? 'Open shared link' : 'Open in browser',
                icon: Ico.arrowUpRight(13),
                onClick: onOpenInBrowser,
              }] : []),
              ...(canOpenLocalFile ? [{
                label: 'Open folder',
                icon: Ico.openFolder(13),
                onClick: onOpenFolder,
              }] : []),
              ...(host.isWeb ? [] : [{
                label: 'Open in OS',
                icon: Ico.externalLink(13),
                disabled: !hasActionPath || (isBackendArtifact && !backendPort),
                title: isBackendArtifact && !backendPort ? 'Waiting for backend port…' : undefined,
                onClick: onOpenOS,
              }]),
              ...(artifact?.serveUrl ? [{
                label: 'Download',
                icon: Ico.download(13),
                onClick: onDownload,
              }] : []),
              { divider: true },
              {
                label: 'Delete',
                icon: Ico.trash(13),
                danger: true,
                disabled: deleteBusy || !hasActionPath || !canManage,
                onClick: onTrash,
              },
            ].filter((item) => canManage || item.label !== 'Delete')}
          />
        )}
        <Tooltip content="Close">
          <IconButton onClick={onClose} aria-label="Close">{Ico.close(15)}</IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

export default ArtifactViewerHeader;
