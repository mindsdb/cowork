import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

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

const askStep = (qid, answer) => ({
  id: `question-${qid}`,
  label: `Prompt ${qid}`,
  badge: 'AskUser',
  icon: 'question',
  status: 'completed',
  startedAt: 1,
  completedAt: 2,
  data: {
    question_id: qid,
    prompt: `Prompt ${qid}`,
    options: [{ value: 'pg', label: `pg-${qid}`, detail: '' }],
    select: 'one',
    allow_custom: true,
    timeout_s: 300,
    answer,
  },
  output: null,
  result: null,
  _questionKey: qid,
  _isScratchpad: false,
  _scratchpadTabId: null,
});

const taskWith = (messages) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'active',
  messages,
});

// Streaming text is split into one <span class="stream-word"> per word (for
// the fade-in animation), so a single node never contains the whole reply —
// getByText can't match it. container.textContent still concatenates in
// document order regardless of how the text is split across nodes, so
// index comparison is the reliable way to assert render order here.
const indexOf = (container, text) => container.textContent.indexOf(text);

describe('ask_user card renders above the text that follows the answer', () => {
  it('completed turn: the card comes before the reply text, not after', () => {
    const { container } = render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: 'Test passed — you picked Juice.',
            steps: [askStep('ask:1', { status: 'answered', values: ['pg'], text: '' })],
            startedAt: 1,
          },
        ])}
        onSend={vi.fn()}
      />,
    );

    const cardIdx = indexOf(container, 'Prompt ask:1');
    const replyIdx = indexOf(container, 'Juice');
    expect(cardIdx).toBeGreaterThan(-1);
    expect(replyIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeLessThan(replyIdx);
  });

  it('live streaming turn: the card comes before the text streamed after the answer', () => {
    const { container } = render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          {
            role: '_streaming',
            content: 'Test passed — you picked Juice.',
            steps: [askStep('ask:1', { status: 'answered', values: ['pg'], text: '' })],
            streamStatus: 'in_progress',
          },
        ])}
        onSend={vi.fn()}
      />,
    );

    const cardIdx = indexOf(container, 'Prompt ask:1');
    const replyIdx = indexOf(container, 'Juice');
    expect(cardIdx).toBeGreaterThan(-1);
    expect(replyIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeLessThan(replyIdx);
  });
});

// ─── ENG-2981: work after an answer renders below the answered card ────────

const row = (id, label, startedAt, completedAt, status = 'completed') => ({
  id,
  label,
  badge: 'ToolProgress',
  icon: 'code',
  status,
  startedAt,
  completedAt,
  data: null,
  output: null,
  result: null,
  _isScratchpad: false,
  _isToolCall: false,
  _scratchpadTabId: 'tc_1',
});

const toolStep = (status = 'completed') => ({
  id: 'step-1',
  label: 'generate_artifact',
  badge: 'Tool',
  icon: 'code',
  status,
  startedAt: 1000,
  completedAt: status === 'completed' ? 90000 : null,
  data: {},
  output: null,
  result: null,
  _isScratchpad: false,
  _isToolCall: true,
  _toolUseId: 'tc_1',
  _scratchpadTabId: 'tc_1',
});

const timedAsk = (qid, answer, startedAt, completedAt) => ({
  ...askStep(qid, answer),
  status: answer ? 'completed' : 'in_progress',
  startedAt,
  completedAt,
});

const ACCEPT = { status: 'answered', values: ['pg'], text: '' };
const headers = (container) => [...container.querySelectorAll('.answer-turn button[aria-expanded]')];
const expandAll = (container) => headers(container).forEach((h) => {
  if (h.getAttribute('aria-expanded') === 'false') fireEvent.click(h);
});
// Each text must appear after the previous one in document order.
const inOrder = (container, texts) => {
  const text = container.textContent;
  let from = 0;
  for (const t of texts) {
    const at = text.indexOf(t, from);
    if (at === -1) return false;
    from = at + t.length;
  }
  return true;
};

describe('tool step lines render around ask_user cards in event order (ENG-2981)', () => {
  it('completed turn: lines before the question sit above its card, lines after it below', () => {
    const { container } = render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: 'Done.',
            startedAt: 1000,
            steps: [
              toolStep(),
              row('step-2', 'Gathering what the artifact needs', 1000, 5000),
              timedAsk('ask:1', ACCEPT, 5000, 20000),
              row('step-3', 'Writing the page (step 3 of 4)', 20000, 30000),
            ],
          },
        ])}
        onSend={vi.fn()}
      />,
    );
    expandAll(container);

    expect(inOrder(container, [
      'Gathering what the artifact needs',
      'Prompt ask:1',
      'Writing the page (step 3 of 4)',
      'Done.',
    ])).toBe(true);
  });

  it('completed turn with three briefs keeps every line between the right cards', () => {
    const { container } = render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: 'Done.',
            startedAt: 1000,
            steps: [
              toolStep(),
              row('step-2', 'Preparing a short brief for you', 1000, 5000),
              timedAsk('ask:1', { status: 'answered', values: [], text: 'bluer' }, 5000, 10000),
              row('step-3', 'Updating the brief with your changes', 10000, 12000),
              timedAsk('ask:2', { status: 'answered', values: [], text: 'bigger' }, 12000, 15000),
              row('step-4', 'Updating the brief with your changes', 15000, 17000),
              timedAsk('ask:3', ACCEPT, 17000, 20000),
              row('step-5', 'Writing down the agreed requirements (step 1 of 4)', 20000, 25000),
            ],
          },
        ])}
        onSend={vi.fn()}
      />,
    );
    expandAll(container);

    expect(inOrder(container, [
      'Preparing a short brief for you',
      'Prompt ask:1',
      'Updating the brief with your changes',
      'Prompt ask:2',
      'Updating the brief with your changes',
      'Prompt ask:3',
      'Writing down the agreed requirements (step 1 of 4)',
    ])).toBe(true);
  });

  it('completed turn: each block times only its own work, not the wait on the user', () => {
    const { container } = render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: 'Done.',
            startedAt: 1000,
            steps: [
              toolStep(),
              row('step-2', 'Preparing a short brief for you', 1000, 5000),
              timedAsk('ask:1', ACCEPT, 5000, 20000),
              row('step-3', 'Writing the page (step 3 of 4)', 20000, 30000),
            ],
          },
        ])}
        onSend={vi.fn()}
      />,
    );

    expect(headers(container).map((h) => h.textContent)).toEqual([
      expect.stringContaining('Worked for 4s'),
      expect.stringContaining('Worked for 10s'),
    ]);
  });

  it('streaming turn, question pending: the live header stays above the card and names the question', () => {
    const { container } = render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          {
            role: '_streaming',
            content: '',
            startedAt: 1000,
            streamStatus: 'in_progress',
            steps: [
              toolStep('in_progress'),
              row('step-2', 'Preparing a short brief for you', 1000, 5000),
              timedAsk('ask:1', null, 5000, null),
            ],
          },
        ])}
        onSend={vi.fn()}
      />,
    );

    const hs = headers(container);
    expect(hs).toHaveLength(1);
    // Expanded, the header text is time-dependent ("Working for …", counted
    // from startedAt=1000 to Date.now()); it is only used to locate the header.
    expect(container.textContent.indexOf(hs[0].textContent)).toBeLessThan(
      container.textContent.indexOf('Prompt ask:1'),
    );
    // Collapsed, the live header shows the current label.
    if (hs[0].getAttribute('aria-expanded') === 'true') fireEvent.click(hs[0]);
    expect(hs[0].textContent).toContain('Prompt ask:1');
  });

  it('streaming turn after the answer: the live header moves below the card and shows the current step', () => {
    const { container } = render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          {
            role: '_streaming',
            content: '',
            startedAt: 1000,
            streamStatus: 'in_progress',
            steps: [
              toolStep('in_progress'),
              row('step-2', 'Preparing a short brief for you', 1000, 5000),
              timedAsk('ask:1', ACCEPT, 5000, 20000),
              row('step-3', 'Writing the page (step 3 of 4)', 20000, null, 'in_progress'),
            ],
          },
        ])}
        onSend={vi.fn()}
      />,
    );

    const hs = headers(container);
    expect(hs).toHaveLength(2);
    // Exactly one live (shimmering) header, and it is the one below the card.
    const live = hs.filter((h) => h.querySelector('.thinking-shimmer'));
    expect(live).toHaveLength(1);
    expect(live[0]).toBe(hs[1]);
    // The row is visible without a click (the live block auto-expands) and
    // sits below the card.
    expect(inOrder(container, ['Prompt ask:1', 'Writing the page (step 3 of 4)'])).toBe(true);
    // Collapsed, the live header names the current pipeline step.
    fireEvent.click(hs[1]);
    expect(hs[1].textContent).toContain('Writing the page (step 3 of 4)');
  });
});
