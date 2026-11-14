import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const submitAnswer = vi.fn(async () => ({ status: 'accepted' }));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), submitAnswer: (...args) => submitAnswer(...args) }));
const handBack = vi.hoisted(() => ({ fn: null, handed: null, drop: null }));
vi.mock('../lib/browserHandBack', () => ({
  handBackBrowser: (...args) => handBack.fn(...args),
  handedBack: (...args) => handBack.handed(...args),
  dropHandBack: (...args) => handBack.drop(...args),
}));

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

function show({
  watching = true, ended = false, paneShown = true, continueTask = vi.fn(), openBrowser = vi.fn(), onAnswered = vi.fn(), stopTask = vi.fn(),
} = {}) {
  const card = (isEnded) => (
    <BrowserHandOverContext.Provider value={{ sessionId: 't-abc', paneShown, openBrowser, continueTask, stopTask, agentLabel: 'Anton' }}>
      <HandOverCard step={step(watching)} conversationId="c1" ended={isEnded} onAnswered={onAnswered} />
    </BrowserHandOverContext.Provider>
  );
  const view = render(card(ended));
  return {
    continueTask, openBrowser, onAnswered, stopTask, unmount: view.unmount,
    // The same card, its hand-over now ended (or not).
    setEnded: (isEnded) => view.rerender(card(isEnded)),
  };
}

const flush = () => act(async () => {});

beforeEach(() => {
  handBack.fn = vi.fn(async () => 'sent');
  handBack.handed = vi.fn(async () => 'sent');
  handBack.drop = vi.fn();
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

  /* On the web with the pane closed the hand-back waits for the viewer: a
     turn started first would meet the browser still the person's. */
  it('after its turn ended, carries the task on only once a waiting hand-back went', async () => {
    handBack.fn = vi.fn(async () => 'waiting');
    let went;
    handBack.handed = vi.fn(() => new Promise((resolve) => { went = resolve; }));
    const { continueTask, openBrowser } = show({ ended: true, paneShown: false });
    fireEvent.click(screen.getByRole('button', { name: 'Done, continue' }));
    await flush();
    expect(openBrowser).toHaveBeenCalled();
    expect(handBack.handed).toHaveBeenCalledWith('t-abc');
    expect(continueTask).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Done, continue' })).toBeDisabled();
    await act(async () => { went('sent'); });
    expect(continueTask).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Done, continue' })).not.toBeDisabled();
  });

  /* The pane couldn't open the viewer (no link, no browser free, the task
     cap, or no pane for this browser): the browser may still be the
     person's, so the card carries nothing on and takes Done, continue again. */
  it.each([true, false])('says so when the browser never opened for the hand-back (ended: %s)', async (ended) => {
    handBack.fn = vi.fn(async () => 'waiting');
    let ends;
    const order = [];
    handBack.handed = vi.fn(() => { order.push('heard'); return new Promise((resolve) => { ends = resolve; }); });
    const openBrowser = vi.fn(() => order.push('opened'));
    const { continueTask } = show({ ended, paneShown: false, openBrowser });
    fireEvent.click(screen.getByRole('button', { name: 'Done, continue' }));
    await flush();
    // Heard before the pane opens: a pane that can't open ends the wait at once.
    expect(order).toEqual(['heard', 'opened']);
    expect(screen.getByRole('button', { name: 'Done, continue' })).toBeDisabled();
    await act(async () => { ends('unreachable'); });
    expect(screen.getByRole('alert')).toHaveTextContent("The browser didn't open. Open it and try Done, continue again.");
    expect(screen.getByRole('button', { name: 'Done, continue' })).not.toBeDisabled();
    expect(continueTask).not.toHaveBeenCalled();
  });

  /* A card that goes while its hand-back waits ends that wait, so a viewer
     that comes later never runs this Done for a later hand-over. */
  it('ends a waiting hand-back when the card goes, and carries nothing on', async () => {
    handBack.fn = vi.fn(async () => 'waiting');
    let went;
    handBack.handed = vi.fn(() => new Promise((resolve) => { went = resolve; }));
    const { continueTask, unmount } = show({ ended: true, paneShown: false });
    fireEvent.click(screen.getByRole('button', { name: 'Done, continue' }));
    await flush();
    expect(handBack.drop).not.toHaveBeenCalled();
    unmount();
    expect(handBack.drop).toHaveBeenCalledWith('t-abc');
    // dropHandBack settles the wait as unreachable; the card is gone either way.
    await act(async () => { went('unreachable'); });
    expect(continueTask).not.toHaveBeenCalled();
  });

  it("ends a waiting hand-back when the card's hand-over ends meanwhile, and takes Done, continue again", async () => {
    handBack.fn = vi.fn(async () => 'waiting');
    let went;
    handBack.handed = vi.fn(() => new Promise((resolve) => { went = resolve; }));
    const { continueTask, setEnded } = show({ ended: false, paneShown: false });
    fireEvent.click(screen.getByRole('button', { name: 'Done, continue' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Done, continue' })).toBeDisabled();
    // The hand-over times out while the pane is still opening.
    setEnded(true);
    await flush();
    expect(handBack.drop).toHaveBeenCalledWith('t-abc');
    await act(async () => { went('unreachable'); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Done, continue' })).not.toBeDisabled();
    expect(continueTask).not.toHaveBeenCalled();
  });

  it('ends nothing when the card goes with no hand-back waiting', async () => {
    const { unmount } = show({ ended: true });
    fireEvent.click(screen.getByRole('button', { name: 'Done, continue' }));
    await flush();
    unmount();
    expect(handBack.drop).not.toHaveBeenCalled();
  });

  it("Stop tells the chat, so a later hand-back doesn't carry the stopped task on", async () => {
    const { stopTask } = show();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Stop' }));
    await flush();
    expect(stopTask).toHaveBeenCalledTimes(1);
    expect(submitAnswer).toHaveBeenCalledWith('c1', 'browser:0123456789abcdef', { values: ['stop'] });
  });

  it('shows a long site whole on the card, wrapping instead of cutting it', () => {
    show();
    const site = screen.getByText('united.com');
    expect(site.className).not.toContain('truncate');
    expect(site.parentElement.className).toContain('whitespace-normal');
    expect(site.parentElement.className).not.toMatch(/max-w-\[(45|60)%\]/);
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
