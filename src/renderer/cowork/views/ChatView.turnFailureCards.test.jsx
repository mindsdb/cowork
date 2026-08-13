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

describe('unknown_model failure card', () => {
  it('offers Open Settings instead of a finished-looking answer', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(
      <ChatView
        task={taskWith(failedTurn('unknown_model', 'That model isn\'t available. Switch to another model in Settings.'))}
        onOpenSettings={onOpenSettings}
      />,
    );
    expect(screen.getByText("That model isn't available")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledWith('agent');
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

  it('gates Retry while the gateway-supplied wait is still running', () => {
    render(<ChatView task={taskWith(failedTurn('rate_limited', BODY, {
      retryAfter: 30,
      createdAt: new Date().toISOString(),
    }))} />);
    // An ungated Retry re-sends a large context into the limiter that just
    // refused it — the same amplification loop, user-initiated.
    const btn = screen.getByRole('button', { name: /Try again in \d+s/ });
    expect(btn).toBeDisabled();
  });

  it('offers an ungated Retry once the wait has elapsed', () => {
    render(<ChatView task={taskWith(failedTurn('rate_limited', BODY, {
      retryAfter: 30,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    }))} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
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
  'unknown_model',
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
