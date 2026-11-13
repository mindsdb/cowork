import { describe, expect, it } from 'vitest';
import { answeredBrowserStep, browserStepAction, parseBrowserStepPrompt } from './browserStepPrompt';

/* anton's commit hold card (anton/core/browser/tool.py _card_prompt), copied
   here since anton is Python. */
const stepPrompt = (url, step, fence = '```') => (
  '**Approve this browser step?**\n\n'
  + 'This step may commit something for you, such as a purchase, a payment, a message, a deletion '
  + `or a form:\n\n${fence}\n${url}\n${step}\n${fence}\n\n`
  + 'It runs only if you approve. Cancel, Skip or no answer stops it.'
);

describe('a held browser step’s prompt', () => {
  it('names the site without its www, the full address, and the action', () => {
    expect(parseBrowserStepPrompt(stepPrompt('https://www.united.com/en/us', 'click "Booking"'))).toEqual({
      url: 'https://www.united.com/en/us',
      site: 'united.com',
      action: 'Click "Booking"',
    });
    expect(parseBrowserStepPrompt(stepPrompt('https://shop.example.test/cart', 'click button "Place order"', '~~~')))
      .toMatchObject({ site: 'shop.example.test', action: 'Click button "Place order"' });
  });

  it('is null for any other prompt, which the card shows as written', () => {
    expect(parseBrowserStepPrompt('Place the order on shop.example.test?')).toBeNull();
    expect(parseBrowserStepPrompt(stepPrompt('not a url', 'click "Booking"'))).toBeNull();
    expect(parseBrowserStepPrompt(stepPrompt('file:///etc/hosts', 'click "Booking"'))).toBeNull();
    expect(parseBrowserStepPrompt('**Approve clicks by position on this page?**\n\nThis step clicks:\n\n```\nhttps://a.com\nclick at (1, 2)\n```\n\nApprove covers…')).toBeNull();
    expect(parseBrowserStepPrompt(undefined)).toBeNull();
  });
});

describe('a held browser step’s action', () => {
  it('never shows the text a step types', () => {
    expect(browserStepAction('type "hunter2" into textbox "Password"')).toBe('Type into textbox "Password"');
    expect(browserStepAction('type "a \\"quoted\\" b" into "Search" and press Enter')).toBe('Type into "Search" and press Enter');
    expect(browserStepAction("type [12] 'hunter2'")).toBe('Type into [12]');
    expect(browserStepAction("type 'hunter2'")).toBe('Type');
  });

  it('capitalises the verb of any other step', () => {
    expect(browserStepAction('press Enter in textbox "Search"')).toBe('Press Enter in textbox "Search"');
    expect(browserStepAction('reload the page, which sends its form again')).toBe('Reload the page, which sends its form again');
  });
});

describe('an answered held step as a step of the turn', () => {
  const OPTIONS = [{ value: 'approve', label: 'Approve', detail: 'Take this step once' }, { value: 'cancel', label: 'Cancel' }];
  const card = (answer, options = OPTIONS) => ({
    id: 'question-x',
    badge: 'AskUser',
    data: { question_id: 'browser:approve:t-abc:p1', prompt: stepPrompt('https://www.united.com/en/us', 'click "Booking"'), options, answer },
  });

  it('is approved with its pills, or cancelled', () => {
    expect(answeredBrowserStep(card({ status: 'answered', values: ['approve'] }))).toMatchObject({
      badge: 'BrowserApproval',
      label: 'Browser action approved',
      data: { approved: true, sessionId: 't-abc', pills: { site: 'united.com', action: 'Click "Booking"' } },
    });
    expect(answeredBrowserStep(card({ status: 'answered', values: ['cancel'] }))).toMatchObject({ label: 'Browser action cancelled' });
  });

  it('is null for a waiting card, a click by position and any other question', () => {
    expect(answeredBrowserStep(card(null))).toBeNull();
    const position = [{ value: 'approve', label: 'Approve', detail: 'Allow clicks by position on this page' }];
    expect(answeredBrowserStep(card({ status: 'answered', values: ['approve'] }, position))).toBeNull();
    expect(answeredBrowserStep({ badge: 'AskUser', data: { question_id: 'ask:1', options: [{ value: 'yes' }], answer: { status: 'answered', values: ['yes'] } } })).toBeNull();
  });
});
