import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

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
