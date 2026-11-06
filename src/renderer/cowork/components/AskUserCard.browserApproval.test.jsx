import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const submitAnswer = vi.fn(async () => ({ status: 'accepted' }));
const approveBrowserStep = vi.fn();
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    submitAnswer: (...args) => submitAnswer(...args),
    approveBrowserStep: (...args) => approveBrowserStep(...args),
  };
});
const hostMock = vi.hoisted(() => ({ isWeb: true }));
vi.mock('../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, host: new Proxy(actual.host, { get: (target, key) => (key === 'isWeb' ? hostMock.isWeb : target[key]) }) };
});

import AskUserCard from './AskUserCard';

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const card = (questionId) => ({
  id: `question-${questionId}`,
  badge: 'AskUser',
  status: 'in_progress',
  data: {
    question_id: questionId,
    prompt: 'Place the order on shop.example.test?',
    options: [{ value: 'approve', label: 'Approve', detail: 'Take this step once' }],
    select: 'one',
    allow_custom: false,
    timeout_s: 300,
    answer: null,
  },
});

const HOLD = 'browser:approve:t-abc:pa-0123456789abcdef01234567';

beforeEach(() => {
  submitAnswer.mockClear();
  approveBrowserStep.mockReset();
  hostMock.isWeb = true;
});

describe('Approve on a commit-hold card', () => {
  it('records the approval in the browser first, then answers the card', async () => {
    approveBrowserStep.mockResolvedValue({ pending_id: 'pa-0123456789abcdef01234567', approved: true, expires_at: 1999999300 });
    render(<AskUserCard step={card(HOLD)} conversationId="conv-1" onAnswered={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await flush();
    expect(approveBrowserStep).toHaveBeenCalledWith('t-abc', 'pa-0123456789abcdef01234567');
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', HOLD, { values: ['approve'] });
    expect(approveBrowserStep.mock.invocationCallOrder[0]).toBeLessThan(submitAnswer.mock.invocationCallOrder[0]);
  });

  it('leaves the card open and says why when the browser refuses', async () => {
    approveBrowserStep.mockRejectedValue(Object.assign(new Error('API /browse/approve returned 424'), { status: 424, code: 'approval_lapsed' }));
    render(<AskUserCard step={card(HOLD)} conversationId="conv-1" onAnswered={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await flush();
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('This step is no longer waiting in the browser, so nothing ran.');
    expect(screen.getByRole('button', { name: /Approve/ })).toBeEnabled();
  });

  it('answers the card only on the desktop, whose browser holds nothing', async () => {
    hostMock.isWeb = false;
    render(<AskUserCard step={card(HOLD)} conversationId="conv-1" onAnswered={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await flush();
    expect(approveBrowserStep).not.toHaveBeenCalled();
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', HOLD, { values: ['approve'] });
  });

  it('answers any other card only', async () => {
    render(<AskUserCard step={card('write:held:pa-1:abc')} conversationId="conv-1" onAnswered={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await flush();
    expect(approveBrowserStep).not.toHaveBeenCalled();
    expect(submitAnswer).toHaveBeenCalledTimes(1);
  });
});
