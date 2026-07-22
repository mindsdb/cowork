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

// Neutral access chip beside the Published badge (Public / Password / Restricted).
function AccessChip({ mode }) {
  const m = mode === 'password'
    ? { icon: Ico.lock(11), label: 'Password' }
    : mode === 'restricted'
      ? { icon: Ico.people(11), label: 'Restricted' }
      : { icon: Ico.globe(11), label: 'Public' };
  return (
    <span title={m.label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
      fontFamily: FONT_BODY, fontSize: 11, fontWeight: 500, color: 'var(--ink-3)',
    }}>
      <span style={{ display: 'inline-flex', color: 'var(--ink-4)' }}>{m.icon}</span>
      {/* Drops to icon-only on a narrow card (see .cw-access-label @container). */}
      <span className="cw-access-label">{m.label}</span>
    </span>
  );
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
  const mode = artifact.accessMode || (artifact.accessProtected ? 'password' : 'public');
  return (
    // Fills the status area: Published + access on the left, the
    // "Unpublished changes" warning pushed to the right (margin-left:auto).
    // On a tight card it wraps to its own line, still right-aligned there.
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minWidth: 0, flexWrap: 'wrap' }}>
      <Badge variant="success" size="sm" dot>Shared</Badge>
      <AccessChip mode={mode} />
      {artifact.modified && (
        inlineChanges
          ? <Badge variant="warning" size="sm" dot>Unshared changes</Badge>
          : <span style={{ marginLeft: 'auto', display: 'inline-flex' }}><Badge variant="warning" size="sm" dot>Unshared changes</Badge></span>
      )}
    </span>
  );
}

export default ArtifactStatus;
