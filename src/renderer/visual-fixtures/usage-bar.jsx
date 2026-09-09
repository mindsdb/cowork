import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../cowork/styles/globals.css';
import '../cowork/styles/skin-8bit.css';
import '../styles.css';
import '../cowork/styles/tailwind.css';
import UsageBar from '../cowork/components/UsageBar';
import { deriveComposerWarning } from '../cowork/lib/usageWarnings';
import { MINDSHUB_AIR_MODEL_ID } from '../cowork/lib/modelCatalog';

/* Every state the usage bar can reach, on one page.

   Driving a real account to a low balance means spending a real wallet down to
   the threshold and waiting for auth to agree, which is why the bar shipped
   without before/after images. These states come from the real
   `deriveComposerWarning`, so the copy here is the copy a user sees, and a
   change that alters any of it shows up in the picture rather than only in the
   diff. Open with `npm run dev:renderer` at /usage-bar-fixture.html, and add
   ?theme=dark for the dark pass. */

const RESET = '2026-10-01T12:00:00Z';

const usage = (over = {}) => ({
  reachable: true,
  isBillingOwner: true,
  freeTokens: { limit: 5_000_000, used: 1_000_000, remaining: 4_000_000, resetsAt: RESET },
  balance: { usd: 42.1, canConsume: true, hasToppedUp: true, alert: '' },
  autoTopUp: { enabled: false, thresholdUsd: null, rechargeToUsd: null, status: 'ok' },
  ...over,
});

const lowBalance = (usd, autoTopUp = {}) => usage({
  balance: { usd, canConsume: true, hasToppedUp: true, alert: 'low' },
  autoTopUp: { enabled: false, thresholdUsd: null, rechargeToUsd: null, status: 'ok', ...autoTopUp },
});

const withAuto = (status) => ({ enabled: true, thresholdUsd: 10, rechargeToUsd: 50, status });
const PAID = { model: 'claude-sonnet-4' };
const AIR = { model: MINDSHUB_AIR_MODEL_ID };

const CASES = [
  { label: 'Balance running low, no auto top up. The offer this ticket exists for.', usage: lowBalance(18), opts: PAID },
  { label: 'Same state, a step lower. A bar closed at $18 asks again here.', usage: lowBalance(8.42), opts: PAID },
  { label: 'Low, seen by a member rather than the billing owner.', usage: lowBalance(8.42), opts: PAID, owner: false },
  { label: 'Low, auto top up healthy. Informational: nothing to do.', usage: lowBalance(8.42, withAuto('ok')), opts: PAID },
  { label: 'Low, auto top up waiting on the bank.', usage: lowBalance(8.42, withAuto('pending_action')), opts: PAID },
  { label: 'Low, auto top up hit its monthly cap.', usage: lowBalance(8.42, withAuto('cap_reached')), opts: PAID },
  { label: 'Auto top up failed. Outranks every balance state.', usage: lowBalance(8.42, withAuto('payment_failed')), opts: PAID },
  {
    label: 'Balance empty on an explicit paid pick, free tokens still available.',
    usage: usage({ balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' } }),
    opts: PAID,
  },
  {
    label: 'Balance empty and the free tokens are gone too, on no explicit pick.',
    usage: usage({
      freeTokens: { limit: 5_000_000, used: 5_000_000, remaining: 0, resetsAt: RESET },
      balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
    }),
    opts: { model: null },
  },
  {
    label: 'Free monthly tokens running low, balance healthy.',
    usage: usage({ freeTokens: { limit: 5_000_000, used: 4_400_000, remaining: 600_000, resetsAt: RESET } }),
    opts: AIR,
  },
  {
    label: 'Free monthly tokens used up, paid balance carrying Air.',
    usage: usage({ freeTokens: { limit: 5_000_000, used: 5_000_000, remaining: 0, resetsAt: RESET } }),
    opts: AIR,
  },
];

function Case({ label, usage: view, opts, owner = true }) {
  const warning = deriveComposerWarning(view, opts);
  return (
    <section style={{ marginBottom: 28 }}>
      <p style={{ font: '12px/1.4 var(--font-body, system-ui)', color: 'var(--text-faint)', margin: '0 0 6px' }}>
        {label}{warning ? '' : ' — nothing to show'}
      </p>
      <div style={{ width: 640, maxWidth: '100%' }}>
        <UsageBar warning={warning} isBillingOwner={owner} usageKnown />
        {/* Stands in for the composer the bar tucks itself under. */}
        <div className="composer-wrap" style={{ height: 56 }} />
      </div>
    </section>
  );
}

/* The app themes off body[data-theme], so honour the same switch and paint the
   themed ground behind it. Without the background the page keeps the browser's
   white default and the dark pass is unreadable. globals.css also pins
   html/body to overflow:hidden for the app shell, which would clip a full-page
   screenshot of a list this long, so the fixture scrolls instead. */
document.body.dataset.theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light';
document.body.style.background = 'var(--bg)';
document.documentElement.style.overflow = 'auto';
document.body.style.overflow = 'auto';
document.body.style.height = 'auto';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <main style={{ padding: 32, display: 'flex', flexDirection: 'column' }}>
      {CASES.map((c) => <Case key={c.label} {...c} />)}
    </main>
  </StrictMode>,
);
