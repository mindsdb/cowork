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
