// Every server failure code must produce visible failure copy and its appropriate action.
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
import { hydrateMessagesFromServerEvents } from '../lib/conversationHistory';

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

  // Retain the legacy code for server/OTA version skew.
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

  // The in-process harness ignores modelOverride; it cannot support a real model switch.
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
    // Rate limiting must not prompt a credit top-up.
    expect(screen.queryByRole('button', { name: /top up/i })).toBeNull();
    expect(screen.queryByText(/out of credits/i)).toBeNull();
  });

  it('gates Retry while the server-supplied wait is still running', () => {
    // Use the server's absolute retry instant; error rows may lack createdAt.
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
    // Explicit Z and +00:00 offsets must resolve to the same retry instant; offset-less local
    // parsing can shift retry windows outside UTC.
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
    // Require an offset and a relative future fixture; fixed dates eventually expire.
    const naive = new Date(Date.now() + 30_000).toISOString().replace('Z', '');
    render(<ChatView task={taskWith(failedTurn('rate_limited', BODY, {
      retryAt: naive,   // exactly the shape created_at has
    }))} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('never gates Retry for longer than the clamp', () => {
    // Cap excessive retry hints so the button cannot stay disabled for hours.
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
    // Infrastructure incidents must not blame the user's prompt.
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
    // Hydrate the real row before copying its support ID.
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

// Keep this vocabulary aligned with cowork-server handlers/turn_errors.py and its tests.
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
  // ENG-2126 — the worker never answered, so the turn never ran.
  'worker_unresponsive',
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
