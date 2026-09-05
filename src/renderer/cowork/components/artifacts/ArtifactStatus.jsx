// phase: publishing | updating | unpublishing | deleting | failed | undefined (idle).
// The parent owns transient state; all status derives from props.

import Ico from '../Icons';
import { Badge } from '../ui';

// Only public artifacts use the green badge; protected modes stay neutral. Keep labels visible and
// let multiple badges wrap. ENG-1212, ENG-1475.
const ACCESS_BADGE = {
  public: { variant: 'success', icon: Ico.globe(11), label: 'Public' },
  password: { variant: 'default', icon: Ico.lock(11), label: 'Password' },
  restricted: { variant: 'default', icon: Ico.people(11), label: 'Restricted' },
};

// Unknown or unloaded access modes must display a neutral protected badge, never Public. Use
// own-property checks
// so modes such as constructor or __proto__ cannot resolve to inherited values.
const UNKNOWN_BADGE = { variant: 'default', icon: Ico.lock(11), label: 'Restricted' };

function accessBadge(artifact) {
  const mode = artifact.accessMode || (artifact.accessProtected ? 'password' : null);
  return mode && Object.hasOwn(ACCESS_BADGE, mode) ? ACCESS_BADGE[mode] : UNKNOWN_BADGE;
}

// inlineChanges keeps the changes badge beside access; cards align it to the right.
export function ArtifactStatus({ artifact, phase, publishable = true, onRetry, inlineChanges = false }) {
  // Transient phases win over the persisted state.
  if (phase === 'failed') {
    return (
      <span className="inline-flex items-center gap-2 min-w-0">
        <Badge variant="danger" size="sm">Sharing failed</Badge>
        <span className="font-body text-[12px] text-ink-3 whitespace-nowrap">
          Couldn't share.{onRetry ? ' ' : ''}
          {onRetry && (
            // `all: unset` stays inline — as a utility its ordering vs the
            // sibling utilities isn't guaranteed, so it could reset them.
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRetry(); }}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ all: 'unset', cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: '2px' }}
            >Try again</button>
          )}
        </span>
      </span>
    );
  }
  if (phase === 'publishing') return <Badge variant="accent" size="sm">Sharing…</Badge>;
  if (phase === 'updating') return <Badge variant="accent" size="sm">Updating…</Badge>;
  if (phase === 'unpublishing') return <Badge variant="default" size="sm">Stopping sharing…</Badge>;
  if (phase === 'deleting') return <Badge variant="default" size="sm">Deleting…</Badge>;

  if (!artifact?.publishedUrl) {
    return <Badge variant="default" size="sm">{publishable ? 'Not shared' : 'Draft'}</Badge>;
  }
  const badge = accessBadge(artifact);
  return (
    <span className="flex items-center gap-[10px] w-full min-w-0 flex-wrap">
      <Badge variant={badge.variant} size="sm" dot icon={badge.icon}>
        {badge.label}
      </Badge>
      {artifact.modified && (
        inlineChanges
          ? <Badge variant="warning" size="sm" dot>Unshared changes</Badge>
          : <span className="ml-auto inline-flex"><Badge variant="warning" size="sm" dot>Unshared changes</Badge></span>
      )}
    </span>
  );
}

export default ArtifactStatus;
