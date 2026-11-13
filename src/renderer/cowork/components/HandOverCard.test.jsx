import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const submitAnswer = vi.fn(async () => ({ status: 'accepted' }));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), submitAnswer: (...args) => submitAnswer(...args) }));
const handBack = vi.hoisted(() => ({ fn: null }));
vi.mock('../lib/browserHandBack', () => ({ handBackBrowser: (...args) => handBack.fn(...args) }));

import HandOverCard from './HandOverCard';
import { BrowserHandOverContext } from '../lib/browserHandOverContext';

const WATCHING = "Use the browser beside the chat. I'll carry on by myself once that's done, or click Done in the browser.";
const MANUAL = "Use the browser beside the chat, and click Done in the browser when you're finished.";
const REASON = "Check United's unaccompanied-minor policy box";
const step = (watching = true) => ({
  id: 'q1',
  badge: 'AskUser',
  data: {
    question_id: 'browser:0123456789abcdef',
    prompt: `Your turn on www.united.com: ${REASON}\n\n${watching ? WATCHING : MANUAL}`,
    options: [{ value: 'later', label: 'Finish later' }, { value: 'stop', label: 'Stop' }],
    answer: null,
  },
});

function show({ watching = true, ended = false, paneShown = true, continueTask = vi.fn(), openBrowser = vi.fn(), onAnswered = vi.fn() } = {}) {
  render(
    <BrowserHandOverContext.Provider value={{ sessionId: 't-abc', paneShown, openBrowser, continueTask, agentLabel: 'Anton' }}>
      <HandOverCard step={step(watching)} conversationId="c1" ended={ended} onAnswered={onAnswered} />
    </BrowserHandOverContext.Provider>,
  );
  return { continueTask, openBrowser, onAnswered };
}

const flush = () => act(async () => {});

beforeEach(() => {
  handBack.fn = vi.fn(async () => 'sent');
  submitAnswer.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('HandOverCard', () => {
  it('shows the reason, the site, and that Anton carries on by itself', () => {
    show();
    expect(screen.getByText('Your turn in the browser')).toBeInTheDocument();
    expect(screen.getByText(REASON)).toBeInTheDocument();
    expect(screen.getByText('united.com')).toBeInTheDocument();
    expect(screen.getByText(/Anton carries on by itself a few seconds later — or click Done, continue\./)).toBeInTheDocument();
  });

  it('says to click Done, continue for a hand-over that waits for nothing', () => {
    show({ watching: false });
    expect(screen.getByText("When you're finished in the browser, click Done, continue.")).toBeInTheDocument();
  });

  it("Done, continue does the browser's Done and leaves the card for anton to retire", async () => {
    const { continueTask, onAnswered } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Done, continue' }));
    await flush();
    expect(handBack.fn).toHaveBeenCalledWith('t-abc');
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(onAnswered).not.toHaveBeenCalled();
    expect(continueTask).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Done, continue' })).toBeDisabled();
  });

  it("opens the pane when the web viewer isn't there yet, for the Done to go through it", async () => {
    handBack.fn = vi.fn(async () => 'waiting');
    const { openBrowser } = show({ paneShown: false });
    fireEvent.click(screen.getByRole('button', { name: 'Done, continue' }));
    await flush();
    expect(openBrowser).toHaveBeenCalled();
  });

  it('offers Open browser only while the pane is hidden', () => {
    const { openBrowser } = show({ paneShown: false });
    fireEvent.click(screen.getByRole('button', { name: 'Open browser' }));
    expect(openBrowser).toHaveBeenCalled();
  });

  it('has no Open browser while the pane shows', () => {
    show({ paneShown: true });
    expect(screen.queryByRole('button', { name: 'Open browser' })).toBeNull();
  });

  it('after its turn ended, Done, continue also carries the task on', async () => {
    const { continueTask } = show({ ended: true });
    expect(screen.getByText(/The browser is still yours/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done, continue' }));
    await flush();
    expect(handBack.fn).toHaveBeenCalledWith('t-abc');
    expect(continueTask).toHaveBeenCalledTimes(1);
  });

  it('says so when there is no browser to hand back', async () => {
    handBack.fn = vi.fn(async () => 'none');
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Done, continue' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent("There's no browser to hand back here.");
  });

  it('keeps Finish later and Stop as quiet options that answer the card', async () => {
    const { onAnswered } = show();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Finish later' }));
    await flush();
    expect(submitAnswer).toHaveBeenCalledWith('c1', 'browser:0123456789abcdef', { values: ['later'] });
    expect(onAnswered).toHaveBeenCalled();
  });
});
