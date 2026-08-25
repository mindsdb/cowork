import { forwardRef } from 'react';
import Ico from '../Icons';
import { Menu, Tooltip } from '../ui';
import { host } from '../../../platform/host';
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
  commentsEnabled,
  commentsOpen,
  comments,
  toggleComments,
  canManage,
  publishable,
  pub,
  hasActionPath,
  isPublished,
  publishBlock,
  disabledReason,
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
  onClose,
}) {
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
          editDisabledReason={workspace.status === 'idle' || workspace.status === 'loading'
            ? 'Loading editing tools…'
            : workspace.capabilities?.canEdit === false
              ? 'Only the artifact owner can edit'
              : 'This artifact cannot be edited here'}
          reviewDisabledReason={workspace.status === 'idle' || workspace.status === 'loading'
            ? 'Loading review tools…'
            : 'Review is not available for this artifact'}
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
        {canManage && publishable && (
          // Block only the Publish direction for forbidden types (e.g.
          // fullstack-stateful-app); once published, the menu stays usable
          // so the artifact can still be unpublished.
          <PublishMenu
            controller={pub}
            disabled={!hasActionPath || (!isPublished && !!publishBlock)}
            disabledReason={(!isPublished && publishBlock) ? publishBlock : disabledReason}
          />
        )}
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
        <Tooltip content="Close">
          <IconButton onClick={onClose} aria-label="Close">{Ico.close(15)}</IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

export default ArtifactViewerHeader;
