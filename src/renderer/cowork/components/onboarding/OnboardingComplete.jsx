import Ico from '../Icons';
import { Button } from '../ui';

// The reward state — shown once every step is done, until the user
// dismisses the checklist for good.
export default function OnboardingComplete({ onDismiss }) {
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
      <Button block onClick={onDismiss}>Close</Button>
    </div>
  );
}
