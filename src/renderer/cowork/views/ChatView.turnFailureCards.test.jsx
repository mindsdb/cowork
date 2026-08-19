// ENG-1282: every turn-failure code the server can emit renders as a failure —
// a card with a next step where one exists, never a bubble that reads like a
// finished answer. The sweep at the bottom pins the renderer to the server's
// code vocabulary so a new code can't silently fall through again.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  // handleSendInTask's `modelOverride` is ignored by the in-process harness
  // (stream_response takes no `model`), so the button would rerun the turn on
  // the same dead id while the composer chip claimed the switch happened.
  it('offers no Switch to MindsHub Air button, which could not take effect', () => {
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

  it('describes the free grant, not a drained wallet', () => {
    render(<ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY))} />);
    expect(screen.getByText("You've used this month's free tokens")).toBeInTheDocument();
    // This user has never topped up — "out of credits" misdescribes it.
    expect(screen.queryByText(/out of credits/i)).toBeNull();
  });

  it('keeps an actionable path to continue (ENG-1169 holds across the split)', () => {
    render(<ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY))} />);
    expect(screen.getByRole('button', { name: 'Add credits' })).toBeEnabled();
  });

  it('names the reset date the gate supplied — the free way forward', () => {
    const inMarch = new Date(Date.now() + 40 * 24 * 3600 * 1000);
    render(<ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY, {
      resetAt: inMarch.toISOString(),
    }))} />);
    const expected = inMarch.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
    expect(screen.getByText(new RegExp(`resets on ${expected}`))).toBeInTheDocument();
  });

  it('says what credits unlock', () => {
    render(<ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY))} />);
    expect(screen.getByText(/unlock Claude, GPT, Gemini, Kimi, DeepSeek and more/)).toBeInTheDocument();
  });

  it.each([
    ['absent', undefined],
    ['malformed', 'not-a-date'],
    ['already past', new Date(Date.now() - 86_400_000).toISOString()],
  ])('falls back to "next month" when the date is %s', (_label, resetAt) => {
    // Never "Invalid Date", and never a stale month on a reloaded conversation.
    render(<ChatView task={taskWith(failedTurn('included_allowance_exhausted', BODY, { resetAt }))} />);
    expect(screen.getByText(/resets on next month/)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
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

describe('anton_error / unmapped failure fallback', () => {
  it('renders as a danger alert, not answer prose', () => {
    render(
      <ChatView task={taskWith(failedTurn('anton_error', 'An unexpected error occurred.'))} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('An unexpected error occurred.');
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
