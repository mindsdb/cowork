import { useState } from 'react';
import Ico from '../Icons';

// The reward state — shown once every step is done, until the user
// dismisses the checklist for good.
export default function OnboardingComplete({ onDismiss }) {
  const [hover, setHover] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14, padding: '10px 4px 2px' }}>
      <span
        style={{
          width: 56, height: 56, borderRadius: '50%',
          display: 'grid', placeItems: 'center',
          background: 'var(--accent-bg)', color: 'var(--accent)',
        }}
      >
        {Ico.taskCheck(30)}
      </span>
      <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--text-strong)' }}>
        You&rsquo;ve got the basics!
      </div>
      <button
        type="button"
        onClick={onDismiss}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: '100%', height: 36, borderRadius: 'var(--r)',
          border: '1px solid var(--border-01)',
          background: hover ? 'color-mix(in srgb, var(--ink) 6%, transparent)' : 'transparent',
          color: 'var(--text-strong)', fontSize: 13.5, fontWeight: 600,
          cursor: 'pointer', transition: 'background 140ms ease',
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
