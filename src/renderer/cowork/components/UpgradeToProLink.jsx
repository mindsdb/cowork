import Ico from './Icons';
import { host } from '../../platform/host';
import { MINDS_BILLING_URL } from '../../lib/mindsUrls';

// Shared free-tier upsell CTA: an underlined text link (theme-aware
// --link-strong) + lock glyph that opens the billing/upgrade page. Used by
// both the composer model picker header and the Settings agent-model dropdown
// so the destination, icon, and styling stay in sync (ENG-531).
export default function UpgradeToProLink({ label = 'Upgrade to Pro', onActivate, style }) {
  return (
    <button
      type="button"
      onClick={() => { host.openExternal(MINDS_BILLING_URL); onActivate?.(); }}
      title="Upgrade to Pro Hub to unlock"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: 'none', border: 0, padding: 0, cursor: 'pointer',
        fontSize: 11.5, color: 'var(--link-strong)',
        ...style,
      }}
    >
      <span style={{ textDecoration: 'underline' }}>{label}</span>
      <span style={{ display: 'inline-flex' }}>{Ico.lock(12)}</span>
    </button>
  );
}
