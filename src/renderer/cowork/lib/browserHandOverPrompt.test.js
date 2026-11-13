import { describe, expect, it } from 'vitest';
import { answeredHandOverStep, finishedHandOverStep, isHandOverCard, parseHandOverPrompt } from './browserHandOverPrompt';
import { isPersonsBrowserTurn } from './browserApproval';
import { splitTurnSegments } from './turnSegments';

/* anton's hand-over prompts (anton/core/browser/tool.py _hand_over), copied: anton is Python. */
const MANUAL = "Use the browser beside the chat, and click Done in the browser when you're finished.";
const WATCHING = "Use the browser beside the chat. I'll carry on by myself once that's done, or click Done in the browser.";
const REASON = "Check United's unaccompanied-minor policy box";

const handOverCard = ({ id = 'q1', watching = true, answer = null, host = 'www.united.com' } = {}) => ({
  id,
  badge: 'AskUser',
  label: 'Question for you',
  status: answer ? 'completed' : 'in_progress',
  data: {
    question_id: `browser:${id}0123456789abcdef`,
    prompt: `${host ? `Your turn on ${host}` : 'Your turn on a page with no web address'}: ${REASON}\n\n${watching ? WATCHING : MANUAL}`,
    options: [{ value: 'later', label: 'Finish later' }, { value: 'stop', label: 'Stop' }],
    select: 'one',
    allow_custom: false,
    answer,
  },
});

const done = { status: 'answered', values: ['done'] };
const later = { status: 'answered', values: ['later'] };

describe('parseHandOverPrompt', () => {
  it("reads the site, reason and whether it comes back by itself from anton's two shapes", () => {
    expect(parseHandOverPrompt(handOverCard().data.prompt)).toEqual({ site: 'united.com', reason: REASON, watching: true });
    expect(parseHandOverPrompt(handOverCard({ watching: false }).data.prompt)).toEqual({ site: 'united.com', reason: REASON, watching: false });
    expect(parseHandOverPrompt(handOverCard({ host: '' }).data.prompt)).toEqual({ site: '', reason: REASON, watching: true });
  });

  it('reads nothing from a prompt in any other shape', () => {
    for (const prompt of [null, '', `Your turn on united.com: ${REASON}`, `Your turn on united.com: ${REASON}\n\nSomething else.`, `Hello: x\n\n${WATCHING}`, `Your turn on united.com: \n\n${WATCHING}`]) {
      expect(parseHandOverPrompt(prompt)).toBeNull();
    }
  });

  it('knows a hand-over card from an approval card', () => {
    expect(isHandOverCard(handOverCard().data)).toBe(true);
    expect(isHandOverCard({ ...handOverCard().data, question_id: 'browser:approve:t-a:pa-1' })).toBe(false);
    expect(isHandOverCard({ ...handOverCard().data, question_id: 'ask:1' })).toBe(false);
  });

  it("is the person's turn in the browser, so Only show the browser when I'm needed opens the pane for it", () => {
    expect(isPersonsBrowserTurn(handOverCard())).toBe(true);
    expect(isPersonsBrowserTurn(handOverCard({ answer: done }))).toBe(false);
  });
});

describe('answeredHandOverStep', () => {
  it('folds a card handed back, by any path, into one step with its site and reason', () => {
    expect(answeredHandOverStep(handOverCard({ answer: done }))).toMatchObject({
      label: 'Handed back — continued', badge: 'BrowserHandOver', status: 'completed',
      data: { outcome: 'done', site: 'united.com', reason: REASON },
    });
    expect(answeredHandOverStep(handOverCard({ answer: { status: 'answered', values: ['stop'] } }))).toMatchObject({ label: 'Hand-over stopped' });
  });

  it('keeps a card left with the person while its turn is the latest, and folds it after', () => {
    expect(answeredHandOverStep(handOverCard({ answer: later }), { stillTheirs: true })).toBeNull();
    expect(answeredHandOverStep(handOverCard({ answer: later }))).toMatchObject({ label: 'Hand-over ended', data: { outcome: 'ended' } });
    expect(answeredHandOverStep(handOverCard({ answer: { status: 'timeout', values: [] } }), { stillTheirs: true })).toBeNull();
    expect(finishedHandOverStep(handOverCard({ answer: later }))).toBeNull();
    expect(finishedHandOverStep(handOverCard({ answer: done }))).not.toBeNull();
  });
});

describe('a hand-over in the turn', () => {
  it('shows a card while open, and one step line once handed back', () => {
    const open = splitTurnSegments([handOverCard()], { conversationLive: true });
    expect(open.map((s) => s.kind)).toEqual(['steps', 'question', 'steps']);
    const back = splitTurnSegments([handOverCard({ answer: done })], { conversationLive: true });
    expect(back.map((s) => s.kind)).toEqual(['steps']);
    expect(back[0].steps[0]).toMatchObject({ label: 'Handed back — continued' });
  });

  it('keeps a card left for later in the latest turn, and folds it in an older one', () => {
    expect(splitTurnSegments([handOverCard({ answer: later })], { reopenable: true }).map((s) => s.kind)).toEqual(['steps', 'question', 'steps']);
    expect(splitTurnSegments([handOverCard({ answer: later })], {}).map((s) => s.kind)).toEqual(['steps']);
  });
});
