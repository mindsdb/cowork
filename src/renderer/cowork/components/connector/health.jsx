// Connection-health presentation helpers, shared by the connections grid
// card and the detail panel so the badge styling/labels stay in one place.
//
// Health values mirror the server (cowork.services.connectors.health):
//   healthy | expiring_soon | broken | unknown
// Colors are theme-driven (--success / --danger / --ink-*), so the badges are
// automatically correct in both light and dark mode — see globals.css, where
// body[data-theme="dark"] overrides --success/--danger/etc.

import Ico from '../Icons';

const FONT_BODY = 'var(--font-body)';

// Per-status visual config. `tone` selects the color set; `dot` is the small
// status-dot color (a CSS color expression), `fg`/`bg`/`border` the pill.
const HEALTH = {
  healthy: {
    label: 'Healthy',
    fg: 'var(--success)',
    bg: 'color-mix(in srgb, var(--success) 14%, transparent)',
    border: 'color-mix(in srgb, var(--success) 32%, transparent)',
    icon: null, // a plain dot reads cleaner for the "all good" state
  },
  expiring_soon: {
    label: 'Expiring',
    // --tint-3 is the theme's "warm amber" (globals.css): #B98007 in light,
    // #E8C58E in dark — readable on both surfaces, unlike a single hex.
    fg: 'var(--tint-3)',
    bg: 'color-mix(in srgb, var(--tint-3) 16%, transparent)',
    border: 'color-mix(in srgb, var(--tint-3) 36%, transparent)',
    icon: Ico.clock,
  },
  broken: {
    label: 'Broken',
    fg: 'var(--danger)',
    bg: 'var(--danger-bg)',
    border: 'color-mix(in srgb, var(--danger) 34%, transparent)',
    icon: Ico.alert,
  },
  unknown: {
    label: 'Untested',
    fg: 'var(--ink-3)',
    bg: 'color-mix(in srgb, var(--ink) 6%, transparent)',
    border: 'var(--line)',
    icon: null,
  },
};

export function healthConfig(health) {
  return HEALTH[health] || HEALTH.unknown;
}

export function isReconnectable(connection) {
  // Server marks OAuth connections (always) and anything seen broken as
  // reconnectable. Default false so a healthy DB connection shows no nudge.
  return Boolean(connection?.reconnectable);
}

// Small pill: status dot (or icon) + label. `title` carries the server's
// human-readable detail as a tooltip.
export function HealthBadge({ health, detail, size = 'sm' }) {
  const cfg = healthConfig(health);
  const compact = size === 'sm';
  const Icon = cfg.icon;
  return (
    <span
      title={detail || cfg.label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        flexShrink: 0,
        height: compact ? 20 : 24,
        padding: compact ? '0 8px' : '0 10px',
        borderRadius: 999,
        background: cfg.bg,
        color: cfg.fg,
        border: `1px solid ${cfg.border}`,
        fontFamily: FONT_BODY,
        fontSize: compact ? 10.5 : 12,
        fontWeight: 600,
        letterSpacing: '0.01em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {Icon
        ? <span style={{ display: 'inline-flex' }}>{Icon(compact ? 11 : 13)}</span>
        : <span style={{
            width: compact ? 6 : 7, height: compact ? 6 : 7,
            borderRadius: 99, background: cfg.fg, flexShrink: 0,
          }} />
      }
      {cfg.label}
    </span>
  );
}

// "Encrypted" badge — a muted lock pill. The vault is encrypted at rest as of
// slice 1, so every saved connection's credentials are encrypted; the server
// echoes `encrypted: true` and we render it data-driven rather than hard-coded.
export function EncryptedBadge({ size = 'sm' }) {
  const compact = size === 'sm';
  return (
    <span
      title="Credentials are encrypted at rest in the local vault"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        flexShrink: 0,
        height: compact ? 20 : 24,
        padding: compact ? '0 8px' : '0 10px',
        borderRadius: 999,
        background: 'color-mix(in srgb, var(--ink) 6%, transparent)',
        color: 'var(--ink-3)',
        border: '1px solid var(--line)',
        fontFamily: FONT_BODY,
        fontSize: compact ? 10.5 : 12,
        fontWeight: 600,
        letterSpacing: '0.01em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ display: 'inline-flex' }}>{Ico.lock(compact ? 11 : 13)}</span>
      Encrypted
    </span>
  );
}
