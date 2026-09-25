import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../cowork/styles/globals.css';
import '../cowork/styles/skin-8bit.css';
import '../styles.css';
import '../cowork/styles/tailwind.css';
import {
  AllowanceExhaustedCard,
  BalanceEmptyCard,
  ConnectProviderCard,
  FreeServingPausedCard,
  ModelUnavailableCard,
} from '../cowork/views/ChatView';

/* Every card a MindsHub billing stop, or an org admin's model rule, can leave
   in a task, on one page.

   Reaching these for real means draining a wallet, spending the free
   allowance, or waiting for the fleet-wide daily fuse to trip, so none of them
   is something a reviewer can produce on demand. The cards here are the ones
   ChatView renders, fed the same props its card chain passes, so the copy on
   the page is the copy a user sees. Open with `npm run dev:renderer` at
   /billing-stop-fixture.html, and add ?theme=dark for the dark pass.

   Times are relative to now, so the "with a time" cases keep rendering a time
   instead of going stale and dropping the clause: the allowance refills a few
   hours out on the hour, and the fuse lifts at the next UTC midnight, which is
   the reset_at auth sends for it. */

const hoursFromNow = (hours) => {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + hours);
  return d.toISOString();
};
const nextUtcMidnight = () => {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
};

const REFILL = hoursFromNow(3);
const GATE_REFILL = hoursFromNow(4);
const FUSE_LIFTS = nextUtcMidnight();

/* The `/hub/usage/` view for an org whose wallet is empty, with the free
   allowance in whatever state a case needs. */
const emptyWallet = (freeTokens) => ({
  reachable: true,
  isBillingOwner: true,
  freeTokens,
  balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
  autoTopUp: { enabled: false, thresholdUsd: null, rechargeToUsd: null, status: 'ok' },
});
const ROOM = emptyWallet({ limit: 100, used: 40, remaining: 60, resetsAt: REFILL });
const SPENT = emptyWallet({ limit: 100, used: 100, remaining: 0, resetsAt: REFILL });
/* An org with no free grant: cowork-server sends limit 0 and no refill time
   when auth reports free_grant_eligible false. */
const NO_GRANT = emptyWallet({ limit: 0, used: 0, remaining: 0, resetsAt: null });
const DARK = { reachable: false };

const noop = () => {};
const COMMON = { time: '2:14 PM', agentLabel: 'Anton' };

const CASES = [
  {
    id: 'token-limit-free-room',
    label: 'Drained wallet on a priced model while the free allowance has room: the priced model is what stopped, so Air is offered.',
    render: () => <BalanceEmptyCard {...COMMON} usage={ROOM} isBillingOwner onSwitchToAir={noop} />,
  },
  {
    id: 'token-limit-free-spent',
    label: 'Drained wallet and the free allowance is spent too: both resources named, with the refill time.',
    render: () => <BalanceEmptyCard {...COMMON} usage={SPENT} isBillingOwner onSwitchToAir={noop} />,
  },
  {
    id: 'token-limit-fallback',
    label: 'Drained wallet with hub usage dark (also no grant, uncapped, or no usable time): the fixed copy.',
    render: () => <BalanceEmptyCard {...COMMON} usage={DARK} isBillingOwner onSwitchToAir={noop} />,
  },
  {
    id: 'allowance-exhausted-gate-time',
    label: 'Free allowance spent, with the refill time the gate sent (a desktop turn).',
    render: () => <AllowanceExhaustedCard {...COMMON} resetAt={GATE_REFILL} usage={SPENT} isBillingOwner />,
  },
  {
    id: 'allowance-exhausted-hub-time',
    label: 'Free allowance spent, no time from the gate (a hosted turn): the refill time comes from hub usage.',
    render: () => <AllowanceExhaustedCard {...COMMON} resetAt={null} usage={SPENT} isBillingOwner />,
  },
  {
    id: 'allowance-exhausted-no-grant',
    label: 'The same stop on an org with no free grant: the console\'s no-grant sentence, and no refill time even though the gate sent one.',
    render: () => <AllowanceExhaustedCard {...COMMON} resetAt={GATE_REFILL} usage={NO_GRANT} isBillingOwner />,
  },
  {
    id: 'free-paused-time',
    label: 'Free MindsHub Air paused for everyone by the daily spend fuse, with the time it lifts.',
    render: () => <FreeServingPausedCard {...COMMON} resetAt={FUSE_LIFTS} isBillingOwner />,
  },
  {
    id: 'free-paused-no-time',
    label: 'The same pause with no usable time (a hosted turn).',
    render: () => <FreeServingPausedCard {...COMMON} resetAt={null} isBillingOwner />,
  },
  {
    id: 'model-restricted-named',
    label: 'An org admin restricted the model the task ran on (a desktop turn names it). Open Settings only: money does not lift an admin rule.',
    render: () => (
      <ModelUnavailableCard
        {...COMMON}
        code="model_restricted"
        failedModel="claude-opus-4-8"
        onOpenSettings={noop}
        onSwitchToAir={noop}
      />
    ),
  },
  {
    id: 'model-restricted-unnamed',
    label: 'The same restriction on a hosted turn, which cannot name the model.',
    render: () => <ModelUnavailableCard {...COMMON} code="model_restricted" onOpenSettings={noop} />,
  },
  {
    id: 'connect-provider',
    label: 'No provider connected. HomeView opens its card with the same pitch.',
    render: () => <ConnectProviderCard time={COMMON.time} onOpenSettings={noop} />,
  },
];

function Case({ id, label, render }) {
  return (
    /* Anchored per case with a fixed id, so a screenshot run can crop to one
       card however the labels are reworded. */
    <section id={id} style={{ marginBottom: 28 }}>
      <p style={{ font: '12px/1.4 var(--font-body, system-ui)', color: 'var(--text-faint)', margin: '0 0 6px' }}>
        {label}
      </p>
      <div style={{ width: 640, maxWidth: '100%' }}>{render()}</div>
    </section>
  );
}

/* Same theme switch and scroll fix as the usage bar fixture: the app themes off
   body[data-theme], the page needs the themed ground behind it, and
   globals.css pins html/body to overflow:hidden for the app shell. */
document.body.dataset.theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light';
document.body.style.background = 'var(--bg)';
document.documentElement.style.overflow = 'auto';
document.body.style.overflow = 'auto';
document.body.style.height = 'auto';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <main style={{ padding: 32, display: 'flex', flexDirection: 'column' }}>
      {CASES.map((c) => <Case key={c.id} {...c} />)}
    </main>
  </StrictMode>,
);
