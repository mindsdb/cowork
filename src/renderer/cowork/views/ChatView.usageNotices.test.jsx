import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// In-chat usage alerts live on `task.usageNotices` and render at the turn they
// happened in, which for a one-turn task is after the reply.

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

const task = (usageNotices, extraMessages = []) => ({
  id: 'conv-a',
  title: 'Weekly digest',
  status: 'idle',
  messages: [
    { role: 'user', content: 'Pull last week into a digest.' },
    { role: 'assistant', content: 'Done. Here is the digest.' },
    ...extraMessages,
  ],
  usageNotices,
});

describe('ChatView usage notices', () => {
  it('renders the free-tokens alert after the reply, with the refill time', () => {
    render(<ChatView task={task([{ kind: 'free_used', resetsAt: '2099-09-11T12:00:00Z', createdAt: '2099-08-28T10:00:00Z' }])} />);
    const card = screen.getByText('Free Air allowance used up');
    const reply = screen.getByText('Done. Here is the digest.');
    expect(reply.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/This task is now using your balance until your allowance refills at Sep 1[12], 12:00 PM\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View usage' })).toBeInTheDocument();
  });

  it('renders the low-allowance alert with the proportion, before the allowance is gone', () => {
    render(<ChatView task={task([{ kind: 'free_low', fractionLeft: 0.124, resetsAt: '2099-09-11T12:00:00Z', createdAt: '2099-08-28T10:00:00Z' }])} />);
    // The headline names the crossing, not the count. The composer bar a few
    // pixels above carries the live count, and the two drift apart on the
    // next poll, so one number must not appear twice under two headlines.
    const card = screen.getByText('Free Air allowance running low');
    const reply = screen.getByText('Done. Here is the digest.');
    expect(reply.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Anchored to the end of the sentence, so dropping resetsAt (which would
    // degrade the clause to nothing) fails here rather than passing on a
    // prefix match. Says what is true of the allowance, not of this turn: the
    // router resolves per turn and can land on a paid model.
    expect(screen.getByText(/^12% of your allowance is left\. When it is used up, MindsHub Air moves onto your balance until it refills at Sep 1[12], 12:00 PM\.$/)).toBeInTheDocument();
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

  // The cards used to be appended after every turn, so after a top-up a
  // "running low" card sat below the newer messages.
  it('leaves a notice at the turn it happened in when the conversation continues', () => {
    const notices = [{ kind: 'free_low', fractionLeft: 0.124, resetsAt: '2099-09-11T12:00:00Z', createdAt: '2099-08-28T10:00:00Z', turnIndex: 0 }];
    const later = [
      { role: 'user', content: 'Added credits — carry on.' },
      { role: 'assistant', content: 'Picking it back up.' },
    ];
    render(<ChatView task={task(notices, later)} />);
    const card = screen.getByText('Free Air allowance running low');
    const nextQuestion = screen.getByText('Added credits — carry on.');
    expect(card.compareDocumentPosition(nextQuestion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The anchor is the turn, not the row, so a card never splits a question from
  // its answer.
  it('keeps the reply next to its question', () => {
    const notices = [{ kind: 'free_low', fractionLeft: 0.124, createdAt: '2099-08-28T10:00:00Z', turnIndex: 0 }];
    render(<ChatView task={task(notices, [{ role: 'user', content: 'Added credits — carry on.' }])} />);
    const question = screen.getByText('Pull last week into a digest.');
    const reply = screen.getByText('Done. Here is the digest.');
    const card = screen.getByText('Free Air allowance running low');
    expect(question.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reply.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The streaming answer is a sibling of the transcript rows, so a trailing
  // card used to render above it, then move once the turn committed.
  it('keeps a live turn\'s notice below the answer still streaming', () => {
    const notices = [{ kind: 'free_low', fractionLeft: 0.124, createdAt: '2099-08-28T10:00:00Z', turnIndex: 1 }];
    const streaming = [
      { role: 'user', content: 'One more thing.' },
      { role: '_streaming', content: 'Working on it', streamStatus: 'in_progress' },
    ];
    // Streaming text is one <span> per word, so a single node never holds the
    // whole reply. textContent concatenates in document order regardless.
    const { container } = render(<ChatView task={task(notices, streaming)} />);
    const questionIdx = container.textContent.indexOf('One more thing.');
    const replyIdx = container.textContent.indexOf('Working on it');
    const cardIdx = container.textContent.indexOf('Free Air allowance running low');
    expect(replyIdx).toBeGreaterThan(questionIdx);
    expect(cardIdx).toBeGreaterThan(replyIdx);
  });

  it('renders nothing extra when there are no notices', () => {
    render(<ChatView task={task(undefined)} />);
    expect(screen.queryByText('Free monthly tokens used')).toBeNull();
  });
});
