import { describe, expect, it } from 'vitest';
import {
  answeredBrowserStep, browserStepAction, browserStepTypedText, parseBrowserStepPrompt, typedTextHasMarks, typedTextShown,
} from './browserStepPrompt';

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
      typed: null,
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

describe('a held typing step’s text', () => {
  const send = (step) => parseBrowserStepPrompt(stepPrompt('https://mail.example.test/compose', step));

  it('is the text anton types, unescaped from its JSON string, line breaks and quotes kept', () => {
    expect(send('type "Pay the $4,800 invoice to IBAN DE89 3704\\nThanks, \\"Sam\\"" into textbox "Message" and press Enter')).toEqual({
      url: 'https://mail.example.test/compose',
      site: 'mail.example.test',
      // The action still says that it sends.
      action: 'Type into textbox "Message" and press Enter',
      typed: 'Pay the $4,800 invoice to IBAN DE89 3704\nThanks, "Sam"',
    });
    expect(send('type "ünïcödé ✓" into textbox "Search"').typed).toBe('ünïcödé ✓');
    expect(browserStepTypedText('type "" into textbox "Search"')).toBe('');
  });

  it('is null for any other step, and for a quote that is not a JSON string', () => {
    expect(send('click "Booking"').typed).toBeNull();
    expect(send("type [12] 'hunter2'").typed).toBeNull();
    expect(browserStepTypedText('type "bad \\x escape" into textbox "Search"')).toBeNull();
    expect(browserStepTypedText(undefined)).toBeNull();
  });
});

/* Each host can type a line break as the Enter key, which can send the text,
   and a tab or a lone carriage return as text: the waiting card marks each
   where it falls, so none hides in blank space. */
describe('a held typing step’s text as the card shows it', () => {
  it('marks each line break, still breaking the line, and each tab', () => {
    expect(typedTextShown('Pay the invoice\n')).toBe('Pay the invoice⏎\n');
    expect(typedTextShown('a\rb')).toBe('a⏎\nb');
    expect(typedTextShown('a\r\nb')).toBe('a⏎\nb');
    expect(typedTextShown('\n')).toBe('⏎\n');
    expect(typedTextShown('John\t ')).toBe('John⇥\t ');
    expect(typedTextShown('Ada Lovelace\nRoom 12')).toBe('Ada Lovelace⏎\nRoom 12');
  });

  it('leaves a text with nothing to mark as it is', () => {
    expect(typedTextShown('Thanks, "Sam"')).toBe('Thanks, "Sam"');
    expect(typedTextHasMarks('Thanks, "Sam"')).toBe(false);
  });

  it('says whether the text has anything to mark', () => {
    expect(['a\nb', 'a\rb', 'a\tb', 'a\u202eb', 'a\u200bb'].map(typedTextHasMarks)).toEqual([true, true, true, true, true]);
  });

  /* A bidi control or a zero-width character shows as nothing, or turns the
     text around it, so the card would read differently from what is typed. */
  it('names each invisible character by its code point', () => {
    expect(typedTextShown('a\u202eb')).toBe('a⟦U+202E⟧b');
    expect(typedTextShown('Pay to DE89 \u202e4321 8765\u202c')).toBe('Pay to DE89 ⟦U+202E⟧4321 8765⟦U+202C⟧');
    expect(typedTextShown('pa\u200by\u2060pal\ufeff\u00ad')).toBe('pa⟦U+200B⟧y⟦U+2060⟧pal⟦U+FEFF⟧⟦U+00AD⟧');
    expect(typedTextShown('a\u2066b\u2069\n')).toBe('a⟦U+2066⟧b⟦U+2069⟧⏎\n');
  });

  /* A tag character shows as nothing yet types, so a run of them spells a
     whole hidden text; a control character and the Hangul fillers show as
     nothing too. Each is named, a character past U+FFFF as one. */
  it('names a tag character, a control character and every other character that shows as nothing', () => {
    expect(typedTextShown('Hi' + String.fromCodePoint(0xE0049))).toBe('Hi⟦U+E0049⟧');
    expect(typedTextShown('a\u0008b\u001bc\u007fd\u0085e')).toBe('a⟦U+0008⟧b⟦U+001B⟧c⟦U+007F⟧d⟦U+0085⟧e');
    expect(typedTextShown('a\u3164b\u115fc\u034fd\u180ee\u2028f\uffa0')).toBe('a⟦U+3164⟧b⟦U+115F⟧c⟦U+034F⟧d⟦U+180E⟧e⟦U+2028⟧f⟦U+FFA0⟧');
    expect(typedTextShown('x' + String.fromCodePoint(0xE0100))).toBe('x⟦U+E0100⟧');
    // An emoji's variation selector stays as it is, and a tab and a line break are marked as before.
    expect(typedTextShown('\u2764\ufe0f\tok\n')).toBe('\u2764\ufe0f⇥\tok⏎\n');
  });

  it('names a hidden text a send spells in tag characters', () => {
    const tags = (text) => [...text].map((char) => String.fromCodePoint(0xE0000 + char.codePointAt(0))).join('');
    const typed = parseBrowserStepPrompt(stepPrompt(
      'https://mail.example.test/compose', `type "Thanks!${tags('IBAN')}" into textbox "Message" and press Enter`,
    )).typed;
    expect(typed).toBe(`Thanks!${tags('IBAN')}`);
    expect(typedTextHasMarks(typed)).toBe(true);
    expect(typedTextShown(typed)).toBe('Thanks!⟦U+E0049⟧⟦U+E0042⟧⟦U+E0041⟧⟦U+E004E⟧');
  });

  /* anton's fence splits `<!--`, `-->` and a run of tildes with a zero-width
     space; the step types the text without them, so they aren't marked. */
  it("leaves out the zero-width spaces anton's fence adds", () => {
    const send = (step, fence) => parseBrowserStepPrompt(stepPrompt('https://mail.example.test/compose', step, fence));
    expect(send('type "<\u200b!-- note --\u200b>" into textbox "Message"').typed).toBe('<!-- note -->');
    expect(send('type "```x``` ~\u200b~\u200b~" into textbox "Message"', '~~~').typed).toBe('```x``` ~~~');
    expect(typedTextHasMarks(send('type "<\u200b!-- note --\u200b>" into textbox "Message"').typed)).toBe(false);
    // A zero-width space the text itself types elsewhere is still named.
    expect(typedTextShown(send('type "pay\u200bpal" into textbox "Message"').typed)).toBe('pay⟦U+200B⟧pal');
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

  it('never carries the text a typing step types', () => {
    const typing = card({ status: 'answered', values: ['approve'] });
    typing.data.prompt = stepPrompt('https://mail.example.test/compose', 'type "Pay the invoice\\nThanks" into textbox "Message" and press Enter');
    const answered = answeredBrowserStep(typing);
    expect(answered.data.pills).toEqual({
      url: 'https://mail.example.test/compose', site: 'mail.example.test', action: 'Type into textbox "Message" and press Enter',
    });
    expect(JSON.stringify(answered.data)).not.toMatch(/Pay the invoice|Thanks/);
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
