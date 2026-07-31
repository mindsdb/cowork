// ArtifactStatus — the status-pill cluster shown on every card / list row.
//
// ONE component for both views so they can never disagree. It derives the
// whole row PURELY from props (the artifact's published/access/modified
// flags + a transient `phase` the parent owns) — no internal state, so the
// status can't get "stuck": whatever the parent passes is exactly what shows.
//
//   <ArtifactStatus artifact={a} phase={statusByPath[a.path]} publishable onRetry={…} />
//
// phase: 'publishing' | 'updating' | 'unpublishing' | 'failed' | undefined(idle)

import Ico from '../Icons';
import { Badge } from '../ui';

const FONT_BODY = "'Inter', system-ui, sans-serif";

// One mode-aware badge per published artifact (ENG-1212). ONLY a genuinely
// public artifact gets the green "success" treatment — password/restricted
// are neutral so a protected artifact can never read as "Shared / available
// to all". Every badge carries a `dot` (the "this is live" affordance that the
// old green "Shared" pill provided — draft/"Not shared" has none) plus an icon,
// so the label may collapse to icon-only on a narrow card (see .cw-access-label
// @container) without going blank.
const ACCESS_BADGE = {
  public: { variant: 'success', icon: Ico.globe(11), label: 'Public' },
  password: { variant: 'default', icon: Ico.lock(11), label: 'Password' },
  restricted: { variant: 'default', icon: Ico.people(11), label: 'Restricted' },
};

// Fail CLOSED: only a positively-recognised mode gets its badge, and only
// `public` is ever green. An unrecognised mode (server adds `org`/`link`/… ),
// or an artifact whose access state hasn't loaded (neither accessMode nor the
// legacy accessProtected flag — e.g. a synthesized chat-bubble stub, cf.
// usePublish `hasServerAccess`), must NEVER read as "available to all", so it
// resolves to a neutral protected pill instead of defaulting to Public.
// `Object.hasOwn` (not `mode in`/`ACCESS_BADGE[mode]`) also stops a mode string
// like `constructor`/`__proto__` from yielding a blank inherited-property pill.
const UNKNOWN_BADGE = { variant: 'default', icon: Ico.lock(11), label: 'Restricted' };

function accessBadge(artifact) {
  const mode = artifact.accessMode || (artifact.accessProtected ? 'password' : null);
  return mode && Object.hasOwn(ACCESS_BADGE, mode) ? ACCESS_BADGE[mode] : UNKNOWN_BADGE;
}

// `inlineChanges` — list view flows the "Unpublished changes" pill inline
// right after the access chip; the card (default) pushes it to the right edge.
export function ArtifactStatus({ artifact, phase, publishable = true, onRetry, inlineChanges = false }) {
  // Transient phases win over the persisted state.
  if (phase === 'failed') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Badge variant="danger" size="sm">Sharing failed</Badge>
        <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          Couldn't share.{onRetry ? ' ' : ''}
          {onRetry && (
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

  // Idle — persisted state.
  if (!artifact?.publishedUrl) {
    return <Badge variant="default" size="sm">{publishable ? 'Not shared' : 'Draft'}</Badge>;
  }
  const badge = accessBadge(artifact);
  return (
    // Fills the status area: access badge on the left, the "Unpublished
    // changes" warning pushed to the right (margin-left:auto). On a tight
    // card it wraps to its own line, still right-aligned there.
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minWidth: 0, flexWrap: 'wrap' }}>
      <Badge variant={badge.variant} size="sm" dot icon={badge.icon} title={badge.label}>
        {/* Drops to icon-only on a narrow card (see .cw-access-label @container). */}
        <span className="cw-access-label">{badge.label}</span>
      </Badge>
      {artifact.modified && (
        inlineChanges
          ? <Badge variant="warning" size="sm" dot>Unshared changes</Badge>
          : <span style={{ marginLeft: 'auto', display: 'inline-flex' }}><Badge variant="warning" size="sm" dot>Unshared changes</Badge></span>
      )}
    </span>
  );
}

export default ArtifactStatus;
