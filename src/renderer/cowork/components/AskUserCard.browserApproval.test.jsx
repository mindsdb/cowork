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
// When the server held the card, by its clock (the stream's `at_ms`).
const HELD_AT = 1_700_000_000_000;
const card = (questionId, heldAtMs = HELD_AT) => ({
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
    held_at_ms: heldAtMs,
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
  // Approvals went off before the card was held, by the server's clock.
  const offBefore = { browserApproveSteps: false, browserApproveStepsOffAt: String(HELD_AT - 1) };

  it('is kept out of sight while the app approves it', () => {
    syncBrowserPrefs(offBefore);
    const { container } = render(<AskUserCard step={card(HOLD)} conversationId="c1" />);
    expect(container).toBeEmptyDOMElement();
    resetBrowserPrefsForTests();
  });

  it('shows again as soon as the setting turns approvals back on', () => {
    syncBrowserPrefs(offBefore);
    const { container } = render(<AskUserCard step={card(HOLD)} conversationId="c1" />);
    expect(container).toBeEmptyDOMElement();
    act(() => { syncBrowserPrefs({ browserApproveSteps: true }); });
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
  });

  /* A fresh page, or another device: no click in this tab, only the
     person's settings. A card that was waiting when approvals went off,
     wherever they turned them off, stays theirs to answer. */
  it('shows a card that was waiting when approvals went off, after a reload or on another device', () => {
    syncBrowserPrefs({ browserApproveSteps: false, browserApproveStepsOffAt: String(HELD_AT + 5) });
    render(<AskUserCard step={card(HOLD)} conversationId="c1" />);
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
    expect(isAutoApprovedCard(card(HOLD).data)).toBe(false);
    expect(isAutoApprovedCard(card('browser:approve:t-abc:pa-later', HELD_AT + 6).data)).toBe(true);
    resetBrowserPrefsForTests();
  });

  // A card with no time, or a server that doesn't say when approvals went off, asks.
  it('shows a card with no held time, or with no time approvals went off', () => {
    syncBrowserPrefs(offBefore);
    expect(isAutoApprovedCard(card(HOLD, null).data)).toBe(false);
    syncBrowserPrefs({ browserApproveSteps: false });
    render(<AskUserCard step={card(HOLD)} conversationId="c1" />);
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
    resetBrowserPrefsForTests();
  });
});

describe("a held step's Skip approvals", () => {
  /* The server as the card's save reaches it: each write of approvals off
     stamps when, by its clock, after this card was held. */
  const server = () => {
    let stored = { browserApproveSteps: true };
    const save = vi.fn(async (patch) => {
      stored = { ...stored, ...patch, ...(patch.browserApproveSteps === false ? { browserApproveStepsOffAt: String(HELD_AT + 10) } : {}) };
      syncBrowserPrefs(stored);
    });
    return { save, stored: () => stored };
  };

  it('turns Approve browser steps off for later steps, and leaves this card to the person', async () => {
    const { save } = server();
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
    // Nor any other card held before the Skip; a step held after it is the app's.
    expect(isAutoApprovedCard(card('browser:approve:t-other:pa-1', HELD_AT - 60_000).data)).toBe(false);
    expect(isAutoApprovedCard(card('browser:approve:t-abc:pa-later', HELD_AT + 11).data)).toBe(true);
    expect(submitAnswer).not.toHaveBeenCalled();
    resetBrowserPrefsForTests();
  });

  it('turns approvals back on when switched off again', async () => {
    const { save, stored } = server();
    setBrowserSettingSaver(save);
    syncBrowserPrefs(stored());
    render(<AskUserCard step={card(HOLD)} conversationId="c1" />);
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Skip approvals for later steps' })); });
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Skip approvals for later steps' })); });
    expect(save).toHaveBeenLastCalledWith({ browserApproveSteps: true });
    expect(screen.getByRole('switch', { name: 'Skip approvals for later steps' })).not.toBeChecked();
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

describe("a held step's site and action", () => {
  const prompt = (url, step) => (
    '**Approve this browser step?**\n\nThis step may commit something for you, such as a purchase, a payment, a message, a deletion '
    + `or a form:\n\n\`\`\`\n${url}\n${step}\n\`\`\`\n\nIt runs only if you approve. Cancel, Skip or no answer stops it.`
  );
  const withPrompt = (text) => {
    const held = card(HOLD);
    return { ...held, data: { ...held.data, prompt: text } };
  };

  it('shows as pills under one short line, with the options and Skip approvals', () => {
    const { container } = render(<AskUserCard step={withPrompt(prompt('https://www.united.com/en/us', 'click button "Book"'))} conversationId="c1" />);
    expect(container.querySelector('pre, code')).toBeNull();
    expect(screen.getByText('Approve this browser step?')).toBeTruthy();
    expect(screen.getByText(/runs only if you approve/)).toBeTruthy();
    expect(screen.queryByText(/This step may commit/)).toBeNull();
    expect(screen.getByText('united.com').closest('[title]').getAttribute('title')).toBe('https://www.united.com/en/us');
    expect(screen.getByText('Click button "Book"')).toBeTruthy();
    // A step that types nothing has no typed text to show.
    expect(screen.queryByTestId('browser-step-typed')).toBeNull();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Skip approvals for later steps' })).toBeTruthy();
  });

  /* Nothing is typed before Approve, so the page can't show it: the card is
     the only place the person reads what a send or a payment types. */
  const SEND = 'type "Pay the $4,800 invoice to IBAN DE89 3704\\nThanks, Sam" into textbox "Message" and press Enter';

  it('shows the text a typing step types, whole and with its line breaks, and that it sends', () => {
    render(<AskUserCard step={withPrompt(prompt('https://mail.example.test/compose', SEND))} conversationId="c1" />);
    expect(screen.getByText('Type into textbox "Message" and press Enter')).toBeTruthy();
    // Its line break can go in as the Enter key: marked where it falls, and the caption says it can send.
    expect(screen.getByText('Text it types (⏎ marks a line break, which can send it; ⇥ marks a tab; ⟦U+…⟧ names an invisible character)')).toBeTruthy();
    const typed = screen.getByTestId('browser-step-typed');
    expect(typed.textContent).toBe('Pay the $4,800 invoice to IBAN DE89 3704⏎\nThanks, Sam');
    expect(typed.className).toContain('whitespace-pre-wrap');
    /* Whole, with no height cap: a line out of sight behind a scroll that
       phones and macOS don't draw would be approved unread. */
    expect(typed.className).not.toMatch(/max-h-|overflow-y-auto/);
  });

  it('says plainly when the text has nothing to mark', () => {
    render(<AskUserCard step={withPrompt(prompt('https://mail.example.test/compose', 'type "Thanks, Sam" into textbox "Message"'))} conversationId="c1" />);
    expect(screen.getByText('Text it types')).toBeTruthy();
    expect(screen.getByTestId('browser-step-typed').textContent).toBe('Thanks, Sam');
  });

  /* anton holds a step whose text holds a line break even without "and press
     Enter" (each host can type a "\n" as the Enter key), so the break is
     the only sign on the card that the step may send. A lone carriage return goes in
     as text, and is marked too, so it can't hide in blank space. */
  it('marks a line break at the end, and a lone carriage return', () => {
    const { unmount } = render(
      <AskUserCard step={withPrompt(prompt('https://mail.example.test/compose', 'type "Pay the invoice\\n" into textbox "Message"'))} conversationId="c1" />,
    );
    expect(screen.getByText('Type into textbox "Message"')).toBeTruthy();
    expect(screen.getByTestId('browser-step-typed').textContent).toBe('Pay the invoice⏎\n');
    expect(screen.getByText('Text it types (⏎ marks a line break, which can send it; ⇥ marks a tab; ⟦U+…⟧ names an invisible character)')).toBeTruthy();
    unmount();
    render(<AskUserCard step={withPrompt(prompt('https://mail.example.test/compose', 'type "a\\rb" into textbox "Message"'))} conversationId="c1" />);
    // The carriage return breaks the line too, so b starts its own.
    expect(screen.getByTestId('browser-step-typed').textContent).toBe('a⏎\nb');
  });

  /* A page could steer the agent into typing a bidi control, which turns the
     text around it on screen: the card names it where it falls. */
  it('names an invisible character where it falls, so the card reads as what is typed', () => {
    const step = 'type "Pay to DE89 \\u202e4321 8765\\u202c" into textbox "Message" and press Enter';
    render(<AskUserCard step={withPrompt(prompt('https://mail.example.test/compose', step))} conversationId="c1" />);
    expect(screen.getByTestId('browser-step-typed').textContent).toBe('Pay to DE89 ⟦U+202E⟧4321 8765⟦U+202C⟧');
    expect(screen.getByText(/⟦U\+…⟧ names an invisible character/)).toBeTruthy();
  });

  it('keeps the typed text off the card once it is answered', () => {
    const held = withPrompt(prompt('https://mail.example.test/compose', SEND));
    const { container } = render(
      <AskUserCard step={{ ...held, data: { ...held.data, answer: { status: 'answered', values: ['cancel'], text: '' } } }} conversationId="c1" />,
    );
    // It still names the step; the answered line in the turn's steps leaves the text out too (browserStepPrompt.test.js).
    expect(screen.getByText('Type into textbox "Message" and press Enter')).toBeTruthy();
    expect(screen.queryByTestId('browser-step-typed')).toBeNull();
    expect(container.textContent).not.toContain('IBAN');
  });

  it('shows a long site and action whole, wrapping instead of cutting either', () => {
    render(<AskUserCard step={withPrompt(prompt('https://www.examplebank.com.account-review.secure-pay.example/checkout', SEND))} conversationId="c1" />);
    const site = screen.getByText('examplebank.com.account-review.secure-pay.example');
    expect(site.className).not.toContain('truncate');
    expect(site.parentElement.className).not.toContain('max-w-[45%]');
    expect(site.parentElement.className).toContain('whitespace-normal');
    const action = screen.getByText('Type into textbox "Message" and press Enter');
    expect(action.className).not.toContain('truncate');
    expect(action.parentElement.className).toContain('whitespace-normal');
  });

  it('falls back to the prompt as written when it is in another shape', () => {
    const odd = '**Approve this browser step?**\n\nSomething else entirely:\n\n```\nnot an address\nclick "Booking"\n```';
    const { container } = render(<AskUserCard step={withPrompt(odd)} conversationId="c1" />);
    expect(container.querySelector('pre')).not.toBeNull();
    expect(container.textContent).toContain('not an address');
    expect(screen.queryByText('united.com')).toBeNull();
  });
});
