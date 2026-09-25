import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../cowork/styles/globals.css';
import '../cowork/styles/skin-8bit.css';
import '../styles.css';
import '../cowork/styles/tailwind.css';
import ModelSelect from '../cowork/components/ModelSelect.jsx';
import { SettingsGroup, Section } from '../cowork/views/settings/settingsLayout';
import { MindsProbeNotice, UnavailableModelHint } from '../cowork/views/settings/SettingsView';
import { friendlyProviderError, mindsProbeNotice } from '../cowork/lib/providerStatus';
import { buildModelOptions } from '../cowork/lib/settingsTransform';

/* What Settings > Agent says after a failed MindsHub health probe, and how it
   shows a model an org admin restricted, on one page.

   Reaching these for real means draining a wallet, spending the free
   allowance, tripping the fleet-wide daily fuse, bursting past the org's rate
   limit, or having an admin write a model rule, so none of them is something a
   reviewer can produce on demand. Each probe case starts from the wire shape
   the sidecar sends (`providerStatusDetails` plus `providerStatusReasons`) and
   goes through the real `mindsProbeNotice` into the component SettingsView
   renders under each role row, so the copy here is the copy a user sees. The
   first case is the legacy path, a sidecar that sends no reasons map, which is
   how every MindsHub 429 read before the reason existed. Open with
   `npm run dev:renderer` at /settings-agent-fixture.html, and add ?theme=dark
   for the dark pass.

   Times are relative to now so the "with a time" cases keep a time: the
   allowance refills a few hours out on the hour, and the fuse lifts at the
   next UTC midnight. */

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
const FUSE_LIFTS = nextUtcMidnight();

const emptyWallet = (freeTokens) => ({
  reachable: true,
  isBillingOwner: true,
  freeTokens,
  balance: { usd: 0, canConsume: false, hasToppedUp: false, alert: 'depleted' },
  autoTopUp: { enabled: false, thresholdUsd: null, rechargeToUsd: null, status: 'ok' },
});
const SPENT = emptyWallet({ limit: 100, used: 100, remaining: 0, resetsAt: REFILL });
const NO_GRANT = emptyWallet({ limit: 0, used: 0, remaining: 0, resetsAt: null });

const reason = (code, resetAt = null) => ({ code, resetAt });

const PROBE_CASES = [
  {
    id: 'probe-legacy-429',
    label: 'Legacy: a sidecar that sends no reasons map. Any 402/429 reads as no credits, which is how a velocity, allowance or fuse 429 all read before. (A newer sidecar that names no reason gets no notice here.)',
    detail: 'HTTP 429: Too Many Requests',
    reason: undefined,
  },
  {
    id: 'probe-wallet-empty',
    label: 'wallet_empty (402): the org has paid before and the wallet is empty. Unchanged copy and trigger.',
    detail: 'HTTP 402',
    reason: reason('wallet_empty'),
  },
  {
    id: 'probe-allowance-time',
    label: 'included_allowance_exhausted (429): the free allowance is spent and there is no balance. Names the refill time.',
    detail: 'HTTP 429',
    reason: reason('included_allowance_exhausted', REFILL),
    usage: SPENT,
  },
  {
    id: 'probe-allowance-no-grant',
    label: 'The same refusal for an org with no free grant: the console\'s no-grant sentence, and no refill time.',
    detail: 'HTTP 429',
    reason: reason('included_allowance_exhausted', REFILL),
    usage: NO_GRANT,
  },
  {
    id: 'probe-paused-time',
    label: 'free_air_daily_spend_fuse_exceeded (429): free MindsHub Air is paused for everyone until the next UTC midnight.',
    detail: 'HTTP 429',
    reason: reason('free_air_daily_spend_fuse_exceeded', FUSE_LIFTS),
  },
  {
    id: 'probe-paused-no-time',
    label: 'The same pause with no usable time.',
    detail: 'HTTP 429',
    reason: reason('free_air_daily_spend_fuse_exceeded'),
  },
  {
    id: 'probe-rate-limited',
    label: 'rate_limited (429): a velocity limit. Muted, no billing action.',
    detail: 'HTTP 429',
    reason: reason('rate_limited'),
  },
  {
    id: 'probe-policy-unavailable',
    label: 'policy_unavailable (503): billing is down. Muted, no billing action, instead of "MindsHub failed its last test".',
    detail: 'HTTP 503',
    reason: reason('policy_unavailable'),
  },
];

/* The LLM Providers row's one-line error for the same refusals, before and
   after the reason reaches it. */
const ROW_CASES = [
  { id: 'row-legacy-429', label: 'Providers row, no reason: every 429 reads "Rate limited".', detail: 'HTTP 429', reason: null },
  { id: 'row-allowance', label: 'Providers row, spent allowance.', detail: 'HTTP 429', reason: reason('included_allowance_exhausted', REFILL) },
  { id: 'row-paused', label: 'Providers row, daily fuse.', detail: 'HTTP 429', reason: reason('free_air_daily_spend_fuse_exceeded', FUSE_LIFTS) },
  { id: 'row-rate-limited', label: 'Providers row, velocity limit.', detail: 'HTTP 429', reason: reason('rate_limited') },
  { id: 'row-wallet-empty', label: 'Providers row, empty wallet.', detail: 'HTTP 402', reason: reason('wallet_empty') },
  { id: 'row-policy-unavailable', label: 'Providers row, billing outage.', detail: 'HTTP 503', reason: reason('policy_unavailable') },
];

/* The picker catalog: one model an admin restricted, one the wallet closes,
   and one that runs. */
const MODEL_LIST = ['mindshub_air', 'claude-opus-4-8', 'gpt-5.6-sol'];
const MODEL_LABELS = { mindshub_air: 'MindsHub Air', 'claude-opus-4-8': 'Claude Opus 4.8', 'gpt-5.6-sol': 'GPT-5.6 Sol' };
const MODEL_ENABLED = { mindshub_air: true, 'claude-opus-4-8': false, 'gpt-5.6-sol': false };
const MODEL_DISABLED_REASONS = { 'claude-opus-4-8': 'model_restricted', 'gpt-5.6-sol': 'wallet_empty' };
const PICKER_OPTIONS = buildModelOptions(
  'mindshub_air', MODEL_LIST, false, false, MODEL_ENABLED, MODEL_LABELS,
  { modelProviders: { mindshub_air: 'openai', 'claude-opus-4-8': 'anthropic', 'gpt-5.6-sol': 'openai' }, modelDisabledReasons: MODEL_DISABLED_REASONS },
);

const noop = () => {};

function Case({ id, label, children }) {
  return (
    /* Anchored per case with a fixed id, so a screenshot run can crop to one
       state however the labels are reworded. */
    <section id={id} style={{ marginBottom: 20 }}>
      <p style={{ font: '12px/1.4 var(--font-body, system-ui)', color: 'var(--text-faint)', margin: '0 0 6px' }}>
        {label}
      </p>
      <div style={{ width: 760, maxWidth: '100%' }}>{children}</div>
    </section>
  );
}

function ProbeCase({ id, label, detail, reason: probeReason, usage = null }) {
  const notice = mindsProbeNotice({ reason: probeReason, detail });
  return (
    <Case id={id} label={label}>
      <SettingsGroup title="Model Router">
        <Section
          title="Planning model"
          subtitle="Used for reasoning, orchestration, and responses."
          notice={notice ? <MindsProbeNotice notice={notice} usage={usage} isBillingOwner={!!usage?.isBillingOwner} /> : null}
        >
          <div className="text-[12px] text-ink-3">(model picker)</div>
        </Section>
      </SettingsGroup>
    </Case>
  );
}

function RowCase({ id, label, detail, reason: probeReason }) {
  return (
    <Case id={id} label={label}>
      <SettingsGroup title="LLM Providers">
        <div className="flex items-center py-[5px] px-0 gap-2.5 justify-end">
          <span className="text-[11.5px] text-danger">{friendlyProviderError(detail, probeReason)}</span>
        </div>
      </SettingsGroup>
    </Case>
  );
}

/* Same theme switch and scroll fix as the other fixtures: the app themes off
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
      {/* First on the page, with room below, because the open list is a
          popover that opens under its trigger only while the trigger sits in
          the viewport. Hover the restricted row for its tooltip. */}
      <Case id="picker-restricted-row" label="The model picker, open: the restricted row is tagged Restricted with no Add credits button; the wallet row keeps Needs credits and its button.">
        <div style={{ width: 320, paddingBottom: 260 }}>
          <ModelSelect value="mindshub_air" options={PICKER_OPTIONS} open onOpenChange={noop} onValueChange={noop} />
        </div>
      </Case>
      {PROBE_CASES.map((c) => <ProbeCase key={c.id} {...c} />)}
      {ROW_CASES.map((c) => <RowCase key={c.id} {...c} />)}
      <Case id="hint-restricted" label="The current model is one an admin restricted: no billing link.">
        <UnavailableModelHint label="Claude Opus 4.8" restricted />
      </Case>
      <Case id="hint-needs-credits" label="The current model is one the wallet closes: unchanged.">
        <UnavailableModelHint label="GPT-5.6 Sol" restricted={false} />
      </Case>
    </main>
  </StrictMode>,
);
