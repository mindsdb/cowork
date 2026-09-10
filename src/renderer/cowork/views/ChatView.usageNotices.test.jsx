import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// In-chat usage alerts (ENG-1782) live on `task.usageNotices` and render after
// the transcript, so the reply stays next to its question.

const hostMock = vi.hoisted(() => ({
  host: {
    isElectron: true, isMac: () => false,
    getApiOrigin: () => 'http://localhost:1', isLocalApiOrigin: () => false,
    openPath: vi.fn(), openExternal: vi.fn(),
    mindshubFinalize: vi.fn(async () => ({ ok: true })),
    mindshubLogin: vi.fn(async () => ({ ok: true })),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: true, isWeb: false,
}));
vi.mock('../../platform/host', () => hostMock);
vi.mock('../lib/analytics', () => ({ trackBillingOpened: vi.fn(), trackKeyProvisioningRefused: vi.fn() }));

import ChatView from './ChatView';

const task = (usageNotices) => ({
  id: 'conv-a',
  title: 'Weekly digest',
  status: 'idle',
  messages: [
    { role: 'user', content: 'Pull last week into a digest.' },
    { role: 'assistant', content: 'Done. Here is the digest.' },
  ],
  usageNotices,
});

describe('ChatView usage notices', () => {
  it('renders the free-tokens alert after the reply, with the reset date', () => {
    render(<ChatView task={task([{ kind: 'free_used', resetsAt: '2099-09-11T12:00:00Z', createdAt: '2099-08-28T10:00:00Z' }])} />);
    const card = screen.getByText('Free monthly tokens used');
    const reply = screen.getByText('Done. Here is the digest.');
    expect(reply.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/This task is now using your balance\. Your free tokens reset on Sep 1[12]\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View usage' })).toBeInTheDocument();
  });

  it('renders the low-allowance alert with the count, before the tokens are gone', () => {
    render(<ChatView task={task([{ kind: 'free_low', remaining: 620_000, resetsAt: '2099-09-11T12:00:00Z', createdAt: '2099-08-28T10:00:00Z' }])} />);
    // The headline names the crossing, not the count. The composer bar a few
    // pixels above carries the live count, and the two drift apart on the
    // next poll, so one number must not appear twice under two headlines.
    const card = screen.getByText('Free monthly tokens running low');
    const reply = screen.getByText('Done. Here is the digest.');
    expect(reply.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Anchored to the end of the sentence, so dropping resetsAt (which would
    // degrade the date to "next month") fails here rather than passing on a
    // prefix match. Says what is true of the allowance, not of this turn: the
    // router resolves per turn and can land on a paid model.
    expect(screen.getByText(/^620K left of this month's free tokens\. When they are used up, MindsHub Air moves onto your balance, and they reset on Sep 1[12]\.$/)).toBeInTheDocument();
    // Not the exhaustion card: the tokens are low, not spent.
    expect(screen.queryByText('Free monthly tokens used')).toBeNull();
    expect(screen.getByRole('button', { name: 'View usage' })).toBeInTheDocument();
  });

  it('renders the auto top up failure with both actions', () => {
    render(<ChatView task={task([{ kind: 'auto_top_up_failed', createdAt: '2099-08-28T10:00:00Z' }])} />);
    expect(screen.getByText('Auto top up failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add funds' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update payment method' })).toBeInTheDocument();
  });

  it('renders nothing extra when there are no notices', () => {
    render(<ChatView task={task(undefined)} />);
    expect(screen.queryByText('Free monthly tokens used')).toBeNull();
  });
});
