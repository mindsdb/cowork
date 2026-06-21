/*
 * IconRail — 56px vertical app rail for the redesigned artifact workspace.
 *
 * Pure presentational shell component (M0 chassis). No data fetching, no app state.
 * Renders standalone with sensible mock defaults so it can be eyeballed in isolation.
 *
 * Layout (top → bottom): gradient "A" app mark · nav icons (folder, artifact, history)
 * · flexible spacer · user avatar pinned to the bottom.
 *
 * Props:
 *   activeNav    string  — which nav item is active: 'folder' | 'artifact' | 'history'.
 *                          The active item gets the accent treatment. Default 'artifact'.
 *   user         object  — { initials } shown in the bottom avatar. Default { initials:'JL' }.
 */

import React from 'react';

// AI-identity gradient (purple → cyan). The one place we hardcode hex, per the brief.
const AI_GRADIENT = 'linear-gradient(135deg,#A78BFA,#22D3EE)';

const NAV_ITEMS = ['folder', 'artifact', 'history'];

function NavIcon({ name }) {
  const common = {
    width: 19,
    height: 19,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  if (name === 'folder') {
    return (
      <svg {...common}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      </svg>
    );
  }
  if (name === 'history') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  // 'artifact' — the sparkle/asterisk mark used for the active artifact surface.
  return (
    <svg {...common}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
    </svg>
  );
}

export function IconRail({ activeNav = 'artifact', user = { initials: 'JL' } } = {}) {
  return (
    <div
      style={{
        width: 'var(--rd-icon-rail-width, 56px)',
        flexShrink: 0,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 14,
        boxShadow: 'var(--sh-2, 0 1px 0 rgba(0,0,0,.4),0 6px 18px rgba(0,0,0,.5))',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: 5,
      }}
    >
      {/* App mark */}
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: AI_GRADIENT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          color: '#04121a',
          fontSize: 16,
          marginBottom: 10,
        }}
      >
        A
      </div>

      {/* Nav icons */}
      {NAV_ITEMS.map((name) => {
        const active = name === activeNav;
        return (
          <div
            key={name}
            className={active ? undefined : 'rd-hov'}
            title={name}
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: active ? 'var(--accent)' : 'var(--ink-3)',
              background: active ? 'var(--accent-bg)' : 'transparent',
              boxShadow: active ? 'inset 0 0 0 1px rgba(34,211,238,.3)' : 'none',
            }}
          >
            <NavIcon name={name} />
          </div>
        );
      })}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* User avatar */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: '#2a3957',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--ink)',
          cursor: 'pointer',
        }}
      >
        {user?.initials ?? 'JL'}
      </div>
    </div>
  );
}

export default IconRail;
