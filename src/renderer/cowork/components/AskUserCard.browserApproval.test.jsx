import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';

const submitAnswer = vi.fn(async () => ({ status: 'accepted' }));
const approveBrowserStep = vi.fn();
const declineBrowserStep = vi.fn();
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    submitAnswer: (...args) => submitAnswer(...args),
    approveBrowserStep: (...args) => approveBrowserStep(...args),
    declineBrowserStep: (...args) => declineBrowserStep(...args),
  };
});
const hostMock = vi.hoisted(() => ({ isWeb: true }));
vi.mock('../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, host: new Proxy(actual.host, { get: (target, key) => (key === 'isWeb' ? hostMock.isWeb : target[key]) }) };
});

import AskUserCard from './AskUserCard';
import { resetBrowserPrefsForTests, setBrowserSettingSaver, syncBrowserPrefs } from '../lib/browserPrefs';
import { isAutoApprovedCard } from '../lib/browserApproval';

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/* The options anton's commit-hold card carries: its Approve, and the Cancel
   anton's ask helper adds to every card. anton is Python, so they are copied
   here. */
const card = (questionId) => ({
  id: `question-${questionId}`,
  badge: 'AskUser',
  status: 'in_progress',
  data: {
    question_id: questionId,
    prompt: 'Place the order on shop.example.test?',
    options: [
      { value: 'approve', label: 'Approve', detail: 'Take this step once' },
      { value: 'cancel', label: 'Cancel', detail: 'Leave the page as it is' },
    ],
    select: 'one',
    allow_custom: false,
    timeout_s: 300,
    answer: null,
  },
});

const PENDING = 'pa-0123456789abcdef01234567';
const HOLD = `browser:approve:t-abc:${PENDING}`;
const APPROVED = { pending_id: PENDING, approved: true, expires_at: 1999999300 };

beforeEach(() => {
  // These cards show while the person approves browser steps, the default.
  resetBrowserPrefsForTests();
  submitAnswer.mockReset();
  submitAnswer.mockResolvedValue({ status: 'accepted' });
  approveBrowserStep.mockReset();
  declineBrowserStep.mockReset();
  declineBrowserStep.mockResolvedValue({});
  hostMock.isWeb = true;
});

describe('Approve on a commit-hold card', () => {
  it('records the approval in the browser first, then answers the card', async () => {
    approveBrowserStep.mockResolvedValue(APPROVED);
    render(<AskUserCard step={card(HOLD)} conversationId="conv-1" onAnswered={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await flush();
    expect(approveBrowserStep).toHaveBeenCalledWith('t-abc', PENDING);
    expect(declineBrowserStep).not.toHaveBeenCalled();
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

  it("refuses a commit-hold card whose ids can't be read, and runs nothing", async () => {
    const unreadable = `browser:approve:t-abc:${PENDING}:extra`;
    render(<AskUserCard step={card(unreadable)} conversationId="conv-1" onAnswered={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await flush();
    expect(approveBrowserStep).not.toHaveBeenCalled();
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent("This approval request can't be checked, so nothing ran.");
    // Skip still answers it; there is no step to decline.
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await flush();
    expect(declineBrowserStep).not.toHaveBeenCalled();
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', unreadable, { skipped: true });
  });

  it('records the approval once when the card answer has to be sent again', async () => {
    approveBrowserStep.mockResolvedValue(APPROVED);
    submitAnswer.mockResolvedValueOnce({ status: 'error' }).mockResolvedValue({ status: 'accepted' });
    render(<AskUserCard step={card(HOLD)} conversationId="conv-1" onAnswered={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await flush();
    expect(approveBrowserStep).toHaveBeenCalledTimes(1);
    expect(submitAnswer).toHaveBeenCalledTimes(2);
    expect(submitAnswer).toHaveBeenLastCalledWith('conv-1', HOLD, { values: ['approve'] });
  });
});

describe('any other answer on a commit-hold card', () => {
  it.each([
    ['Cancel', /Cancel/, { values: ['cancel'] }],
    ['Skip', 'Skip', { skipped: true }],
  ])('%s records no approval, and declines the held step before it answers', async (_case, name, payload) => {
    render(<AskUserCard step={card(HOLD)} conversationId="conv-1" onAnswered={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name }));
    await flush();
    expect(approveBrowserStep).not.toHaveBeenCalled();
    expect(declineBrowserStep).toHaveBeenCalledWith('t-abc', PENDING);
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', HOLD, payload);
    expect(declineBrowserStep.mock.invocationCallOrder[0]).toBeLessThan(submitAnswer.mock.invocationCallOrder[0]);
  });

  it('answers the card only once the decline has settled', async () => {
    let settleDecline;
    declineBrowserStep.mockImplementation(() => new Promise((resolve) => { settleDecline = resolve; }));
    render(<AskUserCard step={card(HOLD)} conversationId="conv-1" onAnswered={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await flush();
    expect(declineBrowserStep).toHaveBeenCalledWith('t-abc', PENDING);
    expect(submitAnswer).not.toHaveBeenCalled();
    settleDecline({});
    await flush();
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', HOLD, { skipped: true });
  });

  it.each([
    ['a server with no decline route', () => Object.assign(new Error('API /browse/decline returned 404'), { status: 404 })],
    ['a step that is no longer held', () => Object.assign(new Error('API /browse/decline returned 424'), { status: 424, code: 'approval_lapsed' })],
    ['no network', () => new TypeError('Failed to fetch')],
  ])('still answers the card after %s', async (_case, failure) => {
    declineBrowserStep.mockRejectedValue(failure());
    render(<AskUserCard step={card(HOLD)} conversationId="conv-1" onAnswered={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await flush();
    expect(declineBrowserStep).toHaveBeenCalledTimes(1);
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', HOLD, { skipped: true });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('declines nothing on the desktop, whose browser holds nothing', async () => {
    hostMock.isWeb = false;
    render(<AskUserCard step={card(HOLD)} conversationId="conv-1" onAnswered={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await flush();
    expect(declineBrowserStep).not.toHaveBeenCalled();
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', HOLD, { skipped: true });
  });

  it('declines nothing for any other card', async () => {
    render(<AskUserCard step={card('ask:1')} conversationId="conv-1" onAnswered={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    await flush();
    expect(declineBrowserStep).not.toHaveBeenCalled();
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', 'ask:1', { values: ['cancel'] });
  });

  it('records the approval again on an Approve after a decline', async () => {
    approveBrowserStep.mockResolvedValue(APPROVED);
    submitAnswer.mockResolvedValue({ status: 'error' });
    render(<AskUserCard step={card(HOLD)} conversationId="conv-1" onAnswered={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await flush();
    expect(declineBrowserStep).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await flush();
    expect(approveBrowserStep).toHaveBeenCalledTimes(2);
  });
});

describe('a commit-hold card while the person turned approvals off', () => {
  it('is kept out of sight while the app approves it', () => {
    syncBrowserPrefs({ browserApproveSteps: false });
    const { container } = render(<AskUserCard step={card(HOLD)} conversationId="c1" />);
    expect(container).toBeEmptyDOMElement();
    resetBrowserPrefsForTests();
  });

  it('shows again as soon as the setting turns approvals back on', () => {
    syncBrowserPrefs({ browserApproveSteps: false });
    const { container } = render(<AskUserCard step={card(HOLD)} conversationId="c1" />);
    expect(container).toBeEmptyDOMElement();
    act(() => { syncBrowserPrefs({ browserApproveSteps: true }); });
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
  });
});

describe("a held step's Skip approvals", () => {
  it('turns Approve browser steps off for later steps, and leaves this card to the person', async () => {
    const save = vi.fn(async (patch) => { syncBrowserPrefs(patch); });
    setBrowserSettingSaver(save);
    render(<AskUserCard step={card(HOLD)} conversationId="c1" />);
    const skip = screen.getByRole('switch', { name: 'Skip approvals for later steps' });
    expect(skip).not.toBeChecked();
    await act(async () => { fireEvent.click(skip); });
    expect(save).toHaveBeenCalledWith({ browserApproveSteps: false });
    expect(screen.getByRole('switch', { name: 'Skip approvals for later steps' })).toBeChecked();
    // This card still needs its own answer: it shows, and the app doesn't approve it.
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
    expect(isAutoApprovedCard(card(HOLD).data)).toBe(false);
    expect(isAutoApprovedCard(card(`browser:approve:t-abc:pa-later`).data)).toBe(true);
    expect(submitAnswer).not.toHaveBeenCalled();
    resetBrowserPrefsForTests();
  });

  it('turns approvals back on when switched off again', async () => {
    const save = vi.fn(async (patch) => { syncBrowserPrefs(patch); });
    setBrowserSettingSaver(save);
    syncBrowserPrefs({ browserApproveSteps: true });
    render(<AskUserCard step={card(HOLD)} conversationId="c1" />);
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Skip approvals for later steps' })); });
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Skip approvals for later steps' })); });
    expect(save).toHaveBeenLastCalledWith({ browserApproveSteps: true });
    resetBrowserPrefsForTests();
  });

  it('is not on an answered card, nor on a question that is not a held step', () => {
    const held = card(HOLD);
    const { unmount } = render(<AskUserCard step={{ ...held, data: { ...held.data, answer: { status: 'answered', values: ['approve'], text: '' } } }} conversationId="c1" />);
    expect(screen.queryByRole('switch')).toBeNull();
    unmount();
    const other = card('ask:q1');
    render(<AskUserCard step={{ ...other, data: { ...other.data, options: [{ value: 'yes', label: 'Yes' }] } }} conversationId="c1" />);
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
