// ENG-1282: every turn-failure code the server can emit renders as a failure —
// a card with a next step where one exists, never a bubble that reads like a
// finished answer. The sweep at the bottom pins the renderer to the server's
// code vocabulary so a new code can't silently fall through again.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

import ChatView from './ChatView';
import { hydrateMessagesFromServerEvents } from '../lib/conversationHistory';
import { HubUsageContext } from '../lib/hubUsageContext';
import { formatResetTime, NO_FREE_GRANT_SENTENCE } from '../lib/usageWarnings';
import { MINDSHUB_AIR_MODEL_ID } from '../lib/modelCatalog';

const taskWith = (messages) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'active',
  messages,
});

const failedTurn = (code, content, extra = {}) => [
  { role: 'user', content: 'draw me a chart' },
  { role: 'error', content, code, ...extra },
];

const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

/* The `/hub/usage/` view App provides. A capped grant by default; `free`
   overrides it, `over` anything else. */
const hubUsage = (free, over = {}) => ({
  reachable: true,
  isBillingOwner: false,
  freeTokens: { limit: 100, used: 20, remaining: 80, resetsAt: inHours(3), ...free },
  balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
  autoTopUp: { enabled: false, thresholdUsd: null, rechargeToUsd: null, status: 'ok' },
  ...over,
});

const withUsage = (usage, ui) => (
  <HubUsageContext.Provider value={{ usage, providerType: 'minds-cloud', refresh: () => {} }}>
    {ui}
  </HubUsageContext.Provider>
);

const TODAYS_BALANCE_COPY = 'Your balance ran out before this task finished. Add funds before starting another task.';

/* The stopped-task card itself. Inside the provider the composer's usage bar
   renders too, with its own "Add funds" and refill time, so card assertions are
   scoped to the card rather than the whole screen. */
const stopCard = (title = 'Task stopped') => within(screen.getByText(title).parentElement);

describe('model_not_found failure card', () => {
  it('names the offending model id and offers Open Settings (ENG-1358)', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(
      <ChatView
        task={taskWith(failedTurn(
          'model_not_found',
          "The model 'deepseek-v4-flash' isn't available. Switch models in Settings.",
          { failedModel: 'deepseek-v4-flash' },
        ))}
        onOpenSettings={onOpenSettings}
      />,
    );
    // The id the user actually has in settings must be on screen — recognising
    // it is what makes the mistake fixable. It appears in both title and body.
    expect(screen.getAllByText(/deepseek-v4-flash/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledWith('agent');
  });

  it('renders the raw id verbatim rather than a prettified label', () => {
    render(
      <ChatView
        task={taskWith(failedTurn('model_not_found', 'nope', { failedModel: 'deepseek-v4-flash' }))}
      />,
    );
    // modelLabel would render this as "Deepseek V4 Flash", which hides the
    // exact string sitting in the user's settings.
    expect(screen.queryByText(/Deepseek V4 Flash/)).not.toBeInTheDocument();
  });

  it('degrades to unnamed copy when an older server sends no model', () => {
    render(
      <ChatView task={taskWith(failedTurn('model_not_found', 'That model isn\'t available.'))} />,
    );
    expect(screen.getByText("That model isn't available")).toBeInTheDocument();
    // No empty quotes where the id would have been.
    expect(screen.queryByText(/""/)).not.toBeInTheDocument();
  });

  // The renderer updates OTA and can lead a pinned server, so the PRE-rename
  // code must keep its card — otherwise those users fall through to the
  // buttonless danger alert that ENG-1282 exists to remove.
  it('still renders the card for the pre-rename unknown_model code', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(
      <ChatView
        task={taskWith(failedTurn('unknown_model', "That model isn't available."))}
        onOpenSettings={onOpenSettings}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledWith('agent');
  });

  // The dead id lives in the planning_model setting. A per-turn switch would
  // move this one task and leave every new task failing on the same id, so
  // the card sends the user to Settings instead.
  it('offers no Switch to MindsHub Air button, only the setting that holds the id', () => {
    render(
      <ChatView
        task={taskWith(failedTurn('model_not_found', 'nope', { failedModel: 'bad-model' }))}
        onSwitchToAirAndResend={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Switch to MindsHub Air' })).not.toBeInTheDocument();
  });
});

describe('included_allowance_exhausted card (ENG-1537)', () => {
  const BODY = "You've used this month's free tokens.";

  it('says the task stopped and names both resources, never a bare "out of tokens"', () => {
    render(<ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY))} />);
    expect(screen.getByText('Task stopped')).toBeInTheDocument();
    expect(screen.getByText(/Your free MindsHub Air allowance is used up and your balance is empty\./)).toBeInTheDocument();
    expect(screen.queryByText(/out of tokens/i)).toBeNull();
    expect(screen.queryByText(/out of credits/i)).toBeNull();
  });

  it('keeps an actionable path to continue (ENG-1169 holds across the split)', () => {
    render(<ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY))} />);
    expect(screen.getByRole('button', { name: 'Add funds' })).toBeEnabled();
    // Nothing says auto top up is on, so offer it.
    expect(screen.getByRole('button', { name: 'Set up auto top up' })).toBeEnabled();
  });

  it('names the refill the gate supplied — the free way forward', () => {
    const inMarch = new Date(Date.now() + 40 * 24 * 3600 * 1000);
    render(<ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY, {
      resetAt: inMarch.toISOString(),
    }))} />);
    // Far enough out to carry its date; a refill later today names the time alone.
    const day = inMarch.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const time = inMarch.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    expect(screen.getByText(new RegExp(`wait for it to refill at ${day}, ${time}`))).toBeInTheDocument();
  });

  it('names the clock time alone for a refill later today', () => {
    const inTwoHours = new Date(Date.now() + 2 * 3600 * 1000);
    // After 10pm local it rolls into tomorrow, so assert whichever applies.
    const sameDay = inTwoHours.getDate() === new Date().getDate();
    render(<ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY, {
      resetAt: inTwoHours.toISOString(),
    }))} />);
    const time = inTwoHours.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const expected = sameDay
      ? `wait for it to refill at ${time}`
      : `wait for it to refill at ${inTwoHours.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
    expect(screen.getByText(new RegExp(expected))).toBeInTheDocument();
  });

  it.each([
    ['absent', undefined],
    ['malformed', 'not-a-date'],
    ['already past', new Date(Date.now() - 86_400_000).toISOString()],
  ])('offers funds alone, promising no refill, when the instant is %s', (_label, resetAt) => {
    /* Never "Invalid Date", and never a stale time on a reloaded conversation.
       The refill goes entirely rather than falling back to "next month": the
       allowance refills on a fixed-duration window, so a monthly promise is
       one the response never made, and with no time at all nothing says this
       org has a grant to refill. */
    render(<ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY, { resetAt }))} />);
    expect(stopCard().getByText('Your free MindsHub Air allowance is used up and your balance is empty. Add funds to keep working.')).toBeInTheDocument();
    expect(stopCard().queryByText(/refill/)).toBeNull();
    expect(screen.queryByText(/next month/)).toBeNull();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });
});

describe('included_allowance_exhausted refill time from hub usage', () => {
  const BODY = 'Free allowance used up.';

  it('names the hub usage refill time when the failure carries none, as a hosted turn from an older cowork-server does', () => {
    /* A cowork-server that predates reset_at on hosted failures sends a
       hosted turn's failure with none, so m.resetAt is null. The hub usage
       read knows the same refill. */
    const resetsAt = inHours(2);
    render(withUsage(
      hubUsage({ remaining: 0, used: 100, resetsAt }),
      <ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY))} />,
    ));
    expect(stopCard().getByText(new RegExp(`wait for it to refill at ${formatResetTime(resetsAt)}\\.`))).toBeInTheDocument();
  });

  it('prefers the time the gate sent over the hub usage read', () => {
    const fromGate = inHours(5);
    const fromHub = inHours(2);
    render(withUsage(
      hubUsage({ remaining: 0, used: 100, resetsAt: fromHub }),
      <ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY, { resetAt: fromGate }))} />,
    ));
    expect(stopCard().getByText(new RegExp(`refill at ${formatResetTime(fromGate)}\\.`))).toBeInTheDocument();
    expect(stopCard().queryByText(new RegExp(`refill at ${formatResetTime(fromHub)}\\.`))).toBeNull();
  });

  it('offers funds alone, promising no refill, when neither the gate nor a reachable hub read has a time', () => {
    render(withUsage(
      { reachable: false },
      <ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY))} />,
    ));
    expect(stopCard().getByText('Your free MindsHub Air allowance is used up and your balance is empty. Add funds to keep working.')).toBeInTheDocument();
    expect(stopCard().queryByText(/refill/)).toBeNull();
  });
});

describe('included_allowance_exhausted card for an org with no free grant', () => {
  const BODY = 'Free allowance used up.';
  // What cowork-server's /hub/usage/ sends when auth reports free_grant_eligible false.
  const NO_GRANT = { percentRemaining: 0, limit: 0, used: 0, remaining: 0, resetsAt: null };

  it("says the account has no free tokens, in the console's words, and names no refill", () => {
    /* The gate still sends a reset instant to an older auth's no-grant org.
       Nothing refills there, so the card must not repeat it. */
    const fromGate = inHours(2);
    render(withUsage(
      hubUsage(NO_GRANT),
      <ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY, { resetAt: fromGate }))} />,
    ));
    expect(stopCard().getByText(`${NO_FREE_GRANT_SENTENCE} Your balance is empty, so add funds to continue.`)).toBeInTheDocument();
    expect(stopCard().queryByText(/refill/i)).toBeNull();
    expect(stopCard().queryByText(new RegExp(formatResetTime(fromGate)))).toBeNull();
    // Title, buttons and the way forward are the same card as ever.
    expect(stopCard().getByRole('button', { name: 'Add funds' })).toBeEnabled();
  });

  it('keeps the refill copy for an org whose grant is spent', () => {
    const fromGate = inHours(2);
    render(withUsage(
      hubUsage({ limit: 100, used: 100, remaining: 0 }),
      <ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY, { resetAt: fromGate }))} />,
    ));
    expect(stopCard().getByText(new RegExp(`wait for it to refill at ${formatResetTime(fromGate)}\\.`))).toBeInTheDocument();
    expect(stopCard().queryByText(new RegExp(NO_FREE_GRANT_SENTENCE))).toBeNull();
  });
});

describe('model_restricted card', () => {
  const BODY = "An administrator in your organization has restricted the model 'claude-opus-4-8'. Choose another model.";

  it('names the model, says an admin restricted it, and offers Open Settings only', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(
      <ChatView
        task={taskWith(failedTurn('model_restricted', BODY, { failedModel: 'claude-opus-4-8' }))}
        onOpenSettings={onOpenSettings}
        onSwitchToAirAndResend={vi.fn()}
      />,
    );
    expect(screen.getByText('Claude Opus 4.8 is restricted')).toBeInTheDocument();
    expect(screen.getByText('An admin in your organization restricted this model. Choose another model in Settings.')).toBeInTheDocument();
    // Money cannot lift an admin rule, and Air may be restricted too.
    expect(screen.queryByRole('button', { name: /top up/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add funds' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch to MindsHub Air' })).toBeNull();
    // Not the credential copy the gateway's plain 403 used to produce.
    expect(screen.queryByText(/credentials/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledWith('agent');
  });

  it('survives a reload with the model named, from the persisted failure event', () => {
    const messages = hydrateMessagesFromServerEvents([
      {
        role: 'assistant', content: '', events: [{
          type: 'response.failed', code: 'model_restricted', error: BODY, model: 'claude-opus-4-8',
        }],
      },
    ]);
    render(<ChatView task={taskWith(messages)} />);
    expect(screen.getByText('Claude Opus 4.8 is restricted')).toBeInTheDocument();
  });

  it('falls back to the unnamed title when the server could not name the model, as on a hosted turn', () => {
    render(<ChatView task={taskWith(failedTurn('model_restricted', BODY))} />);
    expect(screen.getByText('This model is restricted')).toBeInTheDocument();
  });
});

describe('token_limit card names the limit that fired', () => {
  const PAID = { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' };
  const renderStop = (usage, props = {}) => render(withUsage(
    usage,
    <ChatView
      task={taskWith(failedTurn('token_limit', "You've run out of credits."))}
      model={PAID}
      onSwitchToAirAndResend={vi.fn()}
      {...props}
    />,
  ));

  it('free allowance has room: says the priced model is what stopped, and offers Air', async () => {
    const user = userEvent.setup();
    const onSwitchToAirAndResend = vi.fn();
    renderStop(hubUsage({ remaining: 80 }), { onSwitchToAirAndResend });
    expect(stopCard().getByText("Your balance is empty, so this model can't run. MindsHub Air still has free allowance left.")).toBeInTheDocument();
    expect(screen.queryByText(TODAYS_BALANCE_COPY)).toBeNull();
    expect(stopCard().getByRole('button', { name: 'Add funds' })).toBeEnabled();
    await user.click(stopCard().getByRole('button', { name: 'Switch to MindsHub Air' }));
    // Resends the message whose turn failed, on Air.
    expect(onSwitchToAirAndResend).toHaveBeenCalledWith('draw me a chart');
  });

  it('offers no switch when the task is already on MindsHub Air', () => {
    renderStop(hubUsage({ remaining: 80 }), { model: { id: MINDSHUB_AIR_MODEL_ID, name: 'MindsHub Air' } });
    expect(screen.queryByRole('button', { name: 'Switch to MindsHub Air' })).toBeNull();
    // Nothing to offer, so nothing to claim: the fixed copy stands.
    expect(stopCard().getByText(TODAYS_BALANCE_COPY)).toBeInTheDocument();
  });

  it('offers no switch, and claims no free allowance, when App has no Air switch to give', () => {
    renderStop(hubUsage({ remaining: 80 }), { onSwitchToAirAndResend: undefined });
    expect(screen.queryByRole('button', { name: 'Switch to MindsHub Air' })).toBeNull();
    expect(stopCard().getByText(TODAYS_BALANCE_COPY)).toBeInTheDocument();
  });

  it('offers no switch when there is no user message to resend', () => {
    render(withUsage(
      hubUsage({ remaining: 80 }),
      <ChatView
        task={taskWith([{ role: 'error', content: 'out', code: 'token_limit' }])}
        model={PAID}
        onSwitchToAirAndResend={vi.fn()}
      />,
    ));
    expect(screen.queryByRole('button', { name: 'Switch to MindsHub Air' })).toBeNull();
    expect(stopCard().getByText(TODAYS_BALANCE_COPY)).toBeInTheDocument();
  });

  it("free allowance spent: names both resources and the refill time, in the spent-allowance card's words", () => {
    const resetsAt = inHours(4);
    renderStop(hubUsage({ remaining: 0, used: 100, resetsAt }));
    expect(stopCard().getByText(
      `Your free MindsHub Air allowance is used up and your balance is empty. Add funds to keep working, or wait for it to refill at ${formatResetTime(resetsAt)}.`,
    )).toBeInTheDocument();
    // Air is spent too, so switching to it would be another dead end.
    expect(screen.queryByRole('button', { name: 'Switch to MindsHub Air' })).toBeNull();
    expect(stopCard().getByRole('button', { name: 'Add funds' })).toBeEnabled();
  });

  it.each([
    ['absent', null],
    ['already past', new Date(Date.now() - 3600 * 1000).toISOString()],
  ])('free allowance spent but the refill time is %s: the fixed copy, no half-sentence', (_label, resetsAt) => {
    renderStop(hubUsage({ remaining: 0, used: 100, resetsAt }));
    expect(stopCard().getByText(TODAYS_BALANCE_COPY)).toBeInTheDocument();
  });

  /* The card stays in the task after a top up, and the read it speaks from is
     today's. Once the wallet can pay, today's allowance is not why this task
     stopped, and resending its message on Air would only replay an old turn. */
  const FUNDED = { usd: 20, canConsume: true, hasToppedUp: true, alert: null };

  it('an old stop after a top up, with Air room: the fixed copy and no switch', () => {
    renderStop(hubUsage({ remaining: 80 }, { balance: FUNDED }));
    expect(stopCard().getByText(TODAYS_BALANCE_COPY)).toBeInTheDocument();
    expect(stopCard().queryByText(/this model can't run/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch to MindsHub Air' })).toBeNull();
    expect(stopCard().getByRole('button', { name: 'Add funds' })).toBeEnabled();
  });

  it('an old stop after a top up, with the allowance spent: the fixed copy and no refill time', () => {
    const resetsAt = inHours(4);
    renderStop(hubUsage({ remaining: 0, used: 100, resetsAt }, { balance: FUNDED }));
    expect(stopCard().getByText(TODAYS_BALANCE_COPY)).toBeInTheDocument();
    expect(stopCard().queryByText(/refill/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch to MindsHub Air' })).toBeNull();
  });

  /* A read with no balance is not a funded wallet: cowork-server sends none
     when its wallet read fails or the caller may not see the wallet, as in a
     starter-tier org, the free users the switch is most for. */
  it('a read with no balance still offers the switch while Air has room', () => {
    renderStop(hubUsage({ remaining: 80 }, { balance: null }));
    expect(stopCard().getByText("Your balance is empty, so this model can't run. MindsHub Air still has free allowance left.")).toBeInTheDocument();
    expect(stopCard().getByRole('button', { name: 'Switch to MindsHub Air' })).toBeEnabled();
  });

  it('a read with no balance still names both resources once the allowance is spent', () => {
    const resetsAt = inHours(4);
    renderStop(hubUsage({ remaining: 0, used: 100, resetsAt }, { balance: null }));
    expect(stopCard().getByText(
      `Your free MindsHub Air allowance is used up and your balance is empty. Add funds to keep working, or wait for it to refill at ${formatResetTime(resetsAt)}.`,
    )).toBeInTheDocument();
  });

  it.each([
    ['no hub usage provider', undefined],
    ['an unreachable read', { reachable: false }],
    ['an uncapped grant', hubUsage({ limit: -1, used: 30, remaining: undefined })],
    ['no grant at all', hubUsage(null, { freeTokens: null })],
  ])('keeps the fixed copy with %s', (_label, usage) => {
    if (usage === undefined) {
      render(<ChatView task={taskWith(failedTurn('token_limit', 'out'))} model={PAID} onSwitchToAirAndResend={vi.fn()} />);
    } else {
      renderStop(usage);
    }
    expect(stopCard().getByText(TODAYS_BALANCE_COPY)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to MindsHub Air' })).toBeNull();
  });
});

describe('free_serving_paused card', () => {
  const BODY = 'Free MindsHub Air is paused.';

  it('says free Air is paused for everyone until the time the gate sent', () => {
    const resetAt = inHours(6);
    render(<ChatView task={taskWith(failedTurn('free_serving_paused', BODY, { resetAt }))} />);
    expect(screen.getByText('Free MindsHub Air is paused')).toBeInTheDocument();
    expect(screen.getByText(
      `Free MindsHub Air is paused for everyone until ${formatResetTime(resetAt)}. This doesn't use your allowance. Add funds to keep working now.`,
    )).toBeInTheDocument();
    // "until", never refillClause's hard-coded "at".
    expect(screen.queryByText(/until at /)).toBeNull();
    expect(screen.getByRole('button', { name: 'Add funds' })).toBeEnabled();
  });

  it.each([
    ['absent', undefined],
    ['malformed', 'not-a-date'],
    ['already past', new Date(Date.now() - 3600 * 1000).toISOString()],
  ])('says it lifts when the daily budget resets when the time is %s', (_label, resetAt) => {
    render(<ChatView task={taskWith(failedTurn('free_serving_paused', BODY, { resetAt }))} />);
    expect(screen.getByText(
      "Free MindsHub Air is paused for everyone until the daily budget resets. This doesn't use your allowance. Add funds to keep working now.",
    )).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('names the time on a reloaded hosted turn whose failure carries reset_at', () => {
    /* The hosted failure frame as cowork-server persists it: the anton
       exception's code and message, the turn's request id, and the gate's
       reset instant. Spans the real hydrate, so a reload that dropped
       reset_at would fall back to the no-time sentence here. */
    const lifts = inHours(6);
    const messages = hydrateMessagesFromServerEvents([
      { role: 'user', content: 'draw me a chart' },
      {
        role: 'assistant', content: '', events: [{
          type: 'response.failed',
          code: 'free_serving_paused',
          error: BODY,
          request_id: 'corr-hosted',
          reset_at: lifts,
        }],
      },
    ]);
    render(<ChatView task={taskWith(messages)} />);
    expect(screen.getByText(
      `Free MindsHub Air is paused for everyone until ${formatResetTime(lifts)}. This doesn't use your allowance. Add funds to keep working now.`,
    )).toBeInTheDocument();
    expect(screen.queryByText(/until the daily budget resets/)).toBeNull();
  });

  it('is not the drained-wallet card and offers only funds', () => {
    render(<ChatView task={taskWith(failedTurn('free_serving_paused', BODY))} onSwitchToAirAndResend={vi.fn()} />);
    expect(screen.queryByText('Task stopped')).toBeNull();
    expect(screen.queryByText(TODAYS_BALANCE_COPY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch to MindsHub Air' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set up auto top up' })).toBeNull();
  });
});

describe('provider_required card', () => {
  it('pitches a free allowance on Air without calling it monthly', () => {
    render(<ChatView task={taskWith([{ role: 'provider_required' }])} />);
    expect(screen.getByText(/Start with MindsHub and get a free allowance on MindsHub Air, then pay as you go\./)).toBeInTheDocument();
    expect(screen.queryByText(/monthly/i)).toBeNull();
  });
});

describe('rate_limited failure card (ENG-1537)', () => {
  const BODY = "Too many requests too quickly. Wait a moment and continue — this isn't a credits problem.";

  it('never offers a top-up — this is a velocity limit, not out of credits', () => {
    render(<ChatView task={taskWith(failedTurn('rate_limited', BODY))} />);
    expect(screen.getByText('Too many requests too quickly')).toBeInTheDocument();
    // THE defect: this used to render the out-of-credits card with a
    // "Top up balance" button, sending the user to buy something that cannot
    // lift a per-minute ceiling.
    expect(screen.queryByRole('button', { name: /top up/i })).toBeNull();
    expect(screen.queryByText(/out of credits/i)).toBeNull();
  });

  it('gates Retry while the server-supplied wait is still running', () => {
    // Anchored on the server's ABSOLUTE instant. The previous version of this
    // test hand-injected `createdAt`, a field no error row in this app carries
    // — so it was green on dead code, and the ticket's "its Retry is
    // time-gated" was unmet on every real path (ENG-1537 review).
    render(<ChatView task={taskWith(failedTurn('rate_limited', BODY, {
      retryAt: new Date(Date.now() + 30_000).toISOString(),
    }))} />);
    const btn = screen.getByRole('button', { name: /Try again in \d+s/ });
    expect(btn).toBeDisabled();
  });

  it('offers an ungated Retry once the wait has elapsed', () => {
    render(<ChatView task={taskWith(failedTurn('rate_limited', BODY, {
      retryAt: new Date(Date.now() - 60_000).toISOString(),
    }))} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('gates identically outside UTC', () => {
    // The trap that made the naive fix wrong: the suite pins TZ=UTC, so a
    // local-time parse looks correct here and gates for ~7h in
    // America/Los_Angeles. An offset-bearing instant is timezone-proof, and
    // this asserts it rather than trusting it.
    const inThirty = new Date(Date.now() + 30_000);
    for (const iso of [inThirty.toISOString(), inThirty.toISOString().replace('Z', '+00:00')]) {
      const { unmount } = render(
        <ChatView task={taskWith(failedTurn('rate_limited', BODY, { retryAt: iso }))} />,
      );
      expect(screen.getByRole('button', { name: /Try again in \d+s/ })).toBeDisabled();
      unmount();
    }
  });

  it('refuses an offset-less anchor instead of parsing it as local time', () => {
    // The regression guard the TZ=UTC pin would otherwise hide. Someone
    // reintroducing `created_at + retryAfter` as the anchor would go green in
    // CI and gate for ~7h for every user west of UTC. Requiring an offset makes
    // that failure mode "no gate" — visible, and assertable in any zone.
    // RELATIVE, not a literal date. A hardcoded future date stops testing
    // anything once it passes: from 2026-12-02 the value is in the past, so the
    // clamp path returns null and the test goes green with the offset check
    // deleted — silently ceasing to guard the regression it exists for.
    const naive = new Date(Date.now() + 30_000).toISOString().replace('Z', '');
    render(<ChatView task={taskWith(failedTurn('rate_limited', BODY, {
      retryAt: naive,   // exactly the shape created_at has
    }))} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('never gates Retry for longer than the clamp', () => {
    // anton cards immediately above its 60s cap rather than sleeping, so a
    // large hint reaches the client as a real value. Ungated, retryAfter=30000
    // disabled the button for 8.3 hours — indistinguishable from a broken card.
    render(<ChatView task={taskWith(failedTurn('rate_limited', BODY, {
      retryAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
    }))} />);
    const btn = screen.getByRole('button', { name: /Try again in (\d+)s/ });
    const secs = Number(btn.textContent.match(/(\d+)s/)[1]);
    expect(secs).toBeLessThanOrEqual(600);
  });

  it('offers an ungated Retry when the gateway sent no hint', () => {
    // Older gateway / stripped header: an honest button beats an invented
    // countdown.
    render(<ChatView task={taskWith(failedTurn('rate_limited', BODY))} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('resends the previous user message on Retry, like provider_overloaded', () => {
    const onSend = vi.fn();
    render(
      <ChatView
        task={taskWith(failedTurn('rate_limited', BODY))}
        onSend={onSend}
      />,
    );
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(onSend).toHaveBeenCalledWith('draw me a chart');
  });
});

describe('image_format failure card', () => {
  it('names the fix (PNG/JPEG) with no dead-end buttons', () => {
    render(
      <ChatView task={taskWith(failedTurn('image_format', 'Sorry, I couldn\'t process that image.'))} />,
    );
    expect(screen.getByText(/PNG or JPEG/)).toBeInTheDocument();
    // Composer/nav buttons exist; the card itself offers no action row.
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /settings/i })).not.toBeInTheDocument();
  });
});

describe('content_recovery failure card', () => {
  it('says it already fixed the issue, not that the user should re-upload', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <ChatView
        task={taskWith(failedTurn(
          'content_recovery',
          "An image earlier in this conversation couldn't be sent to the model due to an internal formatting issue. I've fixed it automatically — you can keep going.",
        ))}
        onSend={onSend}
      />,
    );
    expect(screen.getByText(/removed automatically/i)).toBeInTheDocument();
    // Distinct from image_format's "convert to PNG or JPEG" — that advice is
    // wrong here, the failure isn't anything wrong with the image itself.
    expect(screen.queryByText(/PNG or JPEG/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onSend).toHaveBeenCalledWith('draw me a chart');
  });

  it('hides Try again when there is no user message to resend', () => {
    render(
      <ChatView
        task={taskWith([{ role: 'error', content: 'issue fixed', code: 'content_recovery' }])}
        onSend={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('content_too_large failure card (ENG-2689)', () => {
  const SERVER_COPY =
    'An image in this conversation is too large for the model to accept. The provider '
    + 'said: The image you provided requires 32400 patches after processing, exceeding '
    + 'the limit of 30000. Please resize the image and try again. That image will be '
    + 'removed automatically so the conversation can continue.';

  it("renders its own card carrying the provider's resize instruction", () => {
    render(<ChatView task={taskWith(failedTurn('content_too_large', SERVER_COPY))} />);
    // The TITLE is what distinguishes this from the generic `anton_error`
    // danger alert, which also renders `m.content` verbatim — asserting only
    // on the body text would pass with no card branch at all.
    expect(screen.getByText('That image is too large')).toBeInTheDocument();
    expect(screen.getByText(/resize the image/i)).toBeInTheDocument();
  });

  it('does not claim the problem is fixed and the user can keep going', () => {
    // The `content_recovery` card says exactly that, and it is the wrong
    // reading here: the conversation is unstuck, but what the user asked for
    // still has not happened.
    render(<ChatView task={taskWith(failedTurn('content_too_large', SERVER_COPY))} />);
    expect(screen.getByText('That image is too large')).toBeInTheDocument();
    expect(screen.queryByText(/you can keep going/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PNG or JPEG/)).not.toBeInTheDocument();
  });

  it('offers no Try again — the image is gone, so a resend answers blind', () => {
    render(
      <ChatView
        task={taskWith(failedTurn('content_too_large', SERVER_COPY))}
        onSend={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});

describe('policy_unavailable failure card', () => {
  it('names the outage and retries the failed message', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <ChatView
        task={taskWith(failedTurn('policy_unavailable', 'Billing is temporarily unavailable. Please retry in a moment.'))}
        onSend={onSend}
      />,
    );
    expect(screen.getByText(/Billing is temporarily unavailable/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onSend).toHaveBeenCalledWith('draw me a chart');
  });

  it('hides Try again when there is no user message to resend', () => {
    render(
      <ChatView
        task={taskWith([{ role: 'error', content: 'Billing is temporarily unavailable.', code: 'policy_unavailable' }])}
        onSend={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('worker_unresponsive failure card', () => {
  it('says the turn never ran and retries the failed message', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <ChatView
        task={taskWith(failedTurn(
          'worker_unresponsive',
          "The agent didn't start, so this turn never ran.",
        ))}
        onSend={onSend}
      />,
    );
    expect(screen.getByText(/never reached the agent/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onSend).toHaveBeenCalledWith('draw me a chart');
  });

  it('blames the infrastructure, not the request', () => {
    // The whole reason this code exists: during the 2026-08-31 outage every
    // turn read as an agent failure, so users retried their WORDING instead of
    // retrying the request. The copy has to point away from their input.
    render(
      <ChatView task={taskWith(failedTurn('worker_unresponsive', 'nothing ran'))} />,
    );
    expect(screen.getByText(/fault on our side/)).toBeInTheDocument();
    expect(screen.queryByText('An unexpected error occurred.')).not.toBeInTheDocument();
  });

  it('hides Try again when there is no user message to resend', () => {
    render(
      <ChatView
        task={taskWith([{ role: 'error', content: 'nothing ran', code: 'worker_unresponsive' }])}
        onSend={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('anton_error / unmapped failure fallback', () => {
  it('renders as a danger alert, not answer prose', () => {
    render(
      <ChatView task={taskWith(failedTurn('anton_error', 'An unexpected error occurred.'))} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('An unexpected error occurred.');
  });

  it('surfaces the request id when the failure carries one, so a report is traceable', () => {
    render(
      <ChatView task={taskWith(failedTurn(
        'anton_error', 'An unexpected error occurred.', { requestId: 'corr-abc' },
      ))} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('corr-abc');
  });

  it('omits the reference line when the failure carries no request id', () => {
    render(
      <ChatView task={taskWith(failedTurn('anton_error', 'An unexpected error occurred.'))} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).not.toHaveTextContent('Reference:');
  });

  it('survives a reload: a persisted response.failed carrying request_id still renders the Reference', () => {
    // The case that matters most: the user refreshes, THEN goes to copy the
    // id for support. Spans the real hydrate function, not a hand-built
    // message shape, so a drift between what conversationHistory.js extracts
    // and what ChatView reads would be caught here.
    const messages = hydrateMessagesFromServerEvents([
      {
        role: 'assistant', content: '', events: [{
          type: 'response.failed', code: 'anton_error',
          error: 'An unexpected error occurred.', request_id: 'corr-reload',
        }],
      },
    ]);
    render(<ChatView task={taskWith(messages)} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('corr-reload');
  });
});

// ── The D2 enforcement half (ENG-1282 step 3) ──────────────────────────────
// cowork-server's `cowork/handlers/turn_errors.py` owns the wire vocabulary of
// turn-failure codes; its `tests/test_turn_errors.py` pins the same list below.
// Adding a code there fails that test until this list — and a matching
// `m.code === '<code>'` branch in ChatView.jsx — exist here. Update both
// repos together.
const WIRE_CODES = [
  'token_limit',
  'policy_unavailable',
  'model_not_found',
  'provider_auth',
  'model_access_denied',
  'model_disabled',
  'provider_overloaded',
  'image_format',
  // ENG-1537 — the velocity 429, previously mislabelled as out-of-credits.
  'rate_limited',
  // ENG-1537 — the spent free allowance, split off the credits card.
  'included_allowance_exhausted',
  // ENG-1992 — a content-shaped rejection the server already repaired.
  'content_recovery',
  // ENG-2689 — an image the provider refused as too large; the user has to
  // attach a smaller one, so it gets different copy and no Retry.
  'content_too_large',
  // ENG-2126 — the worker never answered, so the turn never ran.
  'worker_unresponsive',
  // Free MindsHub Air paused for everyone by auth's daily spend fuse.
  'free_serving_paused',
  // An org admin's model rule refused the model; credits do not unlock it.
  'model_restricted',
  'anton_error',
];

// The designated generic bucket renders the danger-alert fallback, not a card
// branch (its treatment is ENG-1093's review).
const FALLBACK_CODE = 'anton_error';

describe('every wire failure code has a renderer branch (ENG-1282)', () => {
  it('ChatView.jsx branches on each non-fallback code', () => {
    const src = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'ChatView.jsx'),
      'utf8',
    );
    const missing = WIRE_CODES.filter(
      (code) => code !== FALLBACK_CODE && !src.includes(`m.code === '${code}'`),
    );
    expect(missing).toEqual([]);
  });
});
