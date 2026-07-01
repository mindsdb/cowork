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

const FONT_BODY = "'Inter', system-ui, sans-serif";

// Semantic tones (status colors are intentionally semantic, matching the
// design): published = green, pending changes = amber, in-flight = accent,
// failed = danger. Neutral pills (Draft / Unpublished) use the surface tint.
const TONE = {
  green: '#16A34A',
  amber: '#F5A623',
  info: 'var(--accent)',
  danger: 'var(--danger)',
};

// One tinted pill. `tone` omitted → neutral grey. `dot` adds a leading status
// dot; `icon` a leading glyph.
function Pill({ tone, label, dot = false, icon = null, title }) {
  const c = TONE[tone];
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '2px 8px', borderRadius: 999,
        fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600, lineHeight: 1.3,
        whiteSpace: 'nowrap', flexShrink: 0,
        color: c || 'var(--ink-3)',
        background: c ? `color-mix(in srgb, ${c} 12%, transparent)` : 'var(--surface-2)',
        border: `1px solid ${c ? `color-mix(in srgb, ${c} 30%, transparent)` : 'var(--line)'}`,
      }}
    >
      {dot && <span style={{ width: 5, height: 5, borderRadius: 99, background: c, flexShrink: 0 }} />}
      {icon && <span style={{ display: 'inline-flex' }}>{icon}</span>}
      {label}
    </span>
  );
}

// Neutral access chip beside the Published pill (Public / Password / Restricted).
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
        <Pill tone="danger" label="Publish failed" />
        <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          Couldn't publish.{onRetry ? ' ' : ''}
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
  if (phase === 'publishing') return <Pill tone="info" label="Publishing…" />;
  if (phase === 'updating') return <Pill tone="info" label="Updating…" />;
  if (phase === 'unpublishing') return <Pill label="Unpublishing…" />;

  // Idle — persisted state.
  if (!artifact?.publishedUrl) {
    return <Pill label={publishable ? 'Unpublished' : 'Draft'} />;
  }
  const mode = artifact.accessMode || (artifact.accessProtected ? 'password' : 'public');
  return (
    // Fills the status area: Published + access on the left, the
    // "Unpublished changes" warning pushed to the right (margin-left:auto).
    // On a tight card it wraps to its own line, still right-aligned there.
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minWidth: 0, flexWrap: 'wrap' }}>
      <Pill tone="green" dot label="Published" />
      <AccessChip mode={mode} />
      {artifact.modified && (
        inlineChanges
          ? <Pill tone="amber" dot label="Unpublished changes" />
          : <span style={{ marginLeft: 'auto', display: 'inline-flex' }}><Pill tone="amber" dot label="Unpublished changes" /></span>
      )}
    </span>
  );
}

export default ArtifactStatus;
