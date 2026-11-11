import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AskUserCard from './AskUserCard';
import { MarkdownContent } from './markdown/MarkdownContent';

const submitAnswer = vi.fn(async () => ({ accepted: true }));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, submitAnswer: (...args) => submitAnswer(...args) };
});

const step = (over = {}) => ({
  id: 'question-ask:1',
  badge: 'AskUser',
  status: 'in_progress',
  data: {
    question_id: 'ask:1',
    prompt: 'Which database?',
    options: [
      { value: 'pg', label: 'postgres', detail: 'primary' },
      { value: 'my', label: 'mysql', detail: '' },
    ],
    select: 'one',
    allow_custom: true,
    timeout_s: 300,
    answer: null,
    ...over,
  },
});

// The answer line is split into a bold prefix and the text, so match the
// paragraph by its full text content.
const answerLine = (text) => screen.getByText(
  (_, el) => el?.tagName === 'P' && el.textContent === `Answered: ${text}`,
);

// A disabled control must not look live: no plain `hover:` and no pointer.
const expectInertWhenDisabled = (el) => {
  expect(el.className).not.toMatch(/(^|\s)hover:/);
  expect(el).toHaveClass('disabled:cursor-default');
};

const renderCard = (over = {}, props = {}) =>
  render(
    <AskUserCard
      step={step(over)}
      conversationId="conv-1"
      onAnswered={vi.fn()}
      {...props}
    />,
  );

beforeEach(() => submitAnswer.mockClear());

describe('AskUserCard', () => {
  it('shows the prompt, every option, and its detail line', () => {
    renderCard();
    expect(screen.getByText('Which database?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /postgres/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mysql/i })).toBeInTheDocument();
    expect(screen.getByText('primary')).toBeInTheDocument();
  });

  it('single-select submits immediately on click', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /mysql/i }));
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', 'ask:1', { values: ['my'] });
  });

  it('picks an option with its number key while focus is in the options', async () => {
    const user = userEvent.setup();
    renderCard();
    screen.getByRole('button', { name: /postgres/i }).focus();
    await user.keyboard('2');
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', 'ask:1', { values: ['my'] });
  });

  it('toggles multi-select options with number keys and still waits for Send', async () => {
    const user = userEvent.setup();
    renderCard({ select: 'many' });
    screen.getByRole('button', { name: /postgres/i }).focus();
    await user.keyboard('1');
    await user.keyboard('2');
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /mysql/i })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /^send$/i }));
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', 'ask:1', { values: ['pg', 'my'] });
  });

  it('ignores number keys typed outside the options and numbers with no option', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Reply" />
        <AskUserCard step={step()} conversationId="conv-1" onAnswered={vi.fn()} />
      </>,
    );
    await user.click(screen.getByRole('textbox', { name: 'Reply' }));
    await user.keyboard('1');
    screen.getByRole('button', { name: /postgres/i }).focus();
    await user.keyboard('9');
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it('keeps option names free of the key hint and check mark', () => {
    // Unanswered: every option carries a key hint.
    const { unmount } = renderCard();
    expect(screen.getByRole('button', { name: 'postgres primary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'mysql' })).toBeInTheDocument();
    unmount();
    // Answered: the chosen option carries the check mark.
    renderCard({ answer: { status: 'answered', values: ['my'] } });
    expect(screen.getByRole('button', { name: 'mysql' })).toBeInTheDocument();
  });

  it('marks the chosen option with a check and no outline', async () => {
    renderCard({ answer: { status: 'answered', values: ['my'] } });
    const chosen = screen.getByRole('button', { name: /mysql/i });
    expect(chosen.querySelector('svg')).not.toBeNull();
    expect(chosen.className).not.toMatch(/(^|\s)border-accent(\s|$)/);
  });

  it('multi-select accumulates and submits once', async () => {
    const user = userEvent.setup();
    renderCard({ select: 'many' });
    await user.click(screen.getByRole('button', { name: /postgres/i }));
    await user.click(screen.getByRole('button', { name: /mysql/i }));
    expect(submitAnswer).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^send$/i }));
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', 'ask:1', { values: ['pg', 'my'] });
  });

  it('multi-select marks a picked option as selected before Send, not just after', async () => {
    // Before this, `chosen` (derived from the server-confirmed answer, which
    // doesn't exist yet in multi-select until Send) drove both the styling
    // class and data-chosen — so clicking had no visible effect until the
    // round trip completed.
    const user = userEvent.setup();
    renderCard({ select: 'many' });
    const pg = screen.getByRole('button', { name: /postgres/i });
    const my = screen.getByRole('button', { name: /mysql/i });
    await user.click(pg);
    expect(pg).toHaveAttribute('data-chosen', 'true');
    expect(pg).toHaveAttribute('aria-pressed', 'true');
    expect(pg.className).not.toBe(my.className);
    expect(my).toHaveAttribute('data-chosen', 'false');
  });

  it('Skip sends a cancellation', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', 'ask:1', { skipped: true });
  });

  it('says typing is accepted when the question allows a custom answer', () => {
    renderCard({ allow_custom: true });
    expect(screen.getByText(/type your own answer below/i)).toBeInTheDocument();
  });

  it('says typing will not work when the question is select-only', () => {
    // Without this line the card shows nothing where the free-text hint would
    // be, so the user's only way to learn that the composer refuses their text
    // is to type it and be told no.
    renderCard({ allow_custom: false });
    expect(screen.queryByText(/type your own answer below/i)).toBeNull();
    const hint = screen.getByText(/won.t be accepted/i);
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toMatch(/skip/i);
  });

  it('hides Skip and the options once answered, and highlights the choice', () => {
    renderCard({ answer: { status: 'answered', values: ['pg'], text: '' } });
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
    expect(screen.getByRole('button', { name: /postgres/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /mysql/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /postgres/i })).toHaveAttribute(
      'data-chosen',
      'true',
    );
    // `data-chosen` had no styling anywhere, so "highlights the choice" was not
    // true on screen: the chosen option has to LOOK different from the others.
    expect(screen.getByRole('button', { name: /postgres/i }).className)
      .not.toBe(screen.getByRole('button', { name: /mysql/i }).className);
    // Only the options that were not picked dim; the chosen one is the answer.
    expect(screen.getByRole('button', { name: /postgres/i }).className)
      .not.toContain('disabled:opacity-60');
    expect(screen.getByRole('button', { name: /mysql/i }).className)
      .toContain('disabled:opacity-60');
  });

  it('names the choice for a card that was answered by clicking an option', () => {
    // The reload / second-tab case. Only `answer.text` used to be rendered, so
    // an option-answered card showed the prompt, greyed buttons, and nothing
    // about what was chosen.
    renderCard({ answer: { status: 'answered', values: ['pg'], text: '' } });
    expect(answerLine('postgres')).toHaveClass('text-body');
  });

  it('shows a free-text answer verbatim', () => {
    renderCard({ answer: { status: 'answered', values: [], text: 'clickhouse' } });
    expect(screen.getByText(/clickhouse/)).toBeInTheDocument();
  });

  it('shows the answer as body text with a bold prefix and keeps its line breaks', () => {
    renderCard({ answer: { status: 'answered', values: [], text: 'line one\nline two' } });
    const shown = answerLine('line one\nline two');
    expect(shown).toHaveClass('text-body', 'whitespace-pre-wrap');
    expect(shown.querySelector('strong')).toHaveTextContent('Answered:');
  });

  it('shows no hover effect or pointer cursor on disabled options, and holds Send until a pick', () => {
    const { unmount } = renderCard({ answer: { status: 'answered', values: [], text: 'other' } });
    for (const name of [/postgres/i, /mysql/i]) {
      const option = screen.getByRole('button', { name });
      expect(option).toBeDisabled();
      expectInertWhenDisabled(option);
    }
    unmount();
    // Multi-select, nothing picked yet: Send is disabled.
    renderCard({ select: 'many' });
    const send = screen.getByRole('button', { name: /^send$/i });
    expect(send).toBeDisabled();
    // Send is the card's one primary action: a pick enables it.
    fireEvent.click(screen.getByRole('button', { name: /postgres/i }));
    expect(send).toBeEnabled();
  });

  it('says so when the question was skipped', () => {
    renderCard({ answer: { status: 'cancelled', values: [], text: '' } });
    expect(screen.getByText(/skipped/i)).toBeInTheDocument();
  });

  it('renders expired and unclickable when there is no live run', () => {
    // Replay resurrects unanswered cards; without this a click would 404.
    renderCard({}, { expired: true });
    expect(screen.getByRole('button', { name: /postgres/i })).toBeDisabled();
    expect(screen.getByText(/no longer active/i)).toBeInTheDocument();
  });

  it('returns to a clickable state when the server says the question is gone', async () => {
    const user = userEvent.setup();
    submitAnswer.mockResolvedValueOnce({ status: 'not_found' });
    const onAnswered = vi.fn();
    renderCard({}, { onAnswered });
    await user.click(screen.getByRole('button', { name: /postgres/i }));
    expect(await screen.findByText(/no longer active/i)).toBeInTheDocument();
    // The card's own conversation id AND question id ride along, so the
    // listener never has to assume the card belongs to the currently-open
    // conversation, nor that it is the only question that conversation asked.
    expect(onAnswered).toHaveBeenCalledWith({ status: 'not_found' }, 'conv-1', 'ask:1');
  });

  it('disables every control while a submission is in flight', async () => {
    // This is the guard that actually decides the double-click case in a
    // browser (and in this DOM): `disabled={settled || busy}`. Asserted on its
    // own so the double-click test below is not silently proving this instead
    // of what its name says.
    let release;
    submitAnswer.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    renderCard();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /mysql/i })); });
    expect(screen.getByRole('button', { name: /mysql/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /postgres/i })).toBeDisabled();
    const skip = screen.getByRole('button', { name: /skip/i });
    expect(skip).toBeDisabled();
    // ...and so is every other button on the card.
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    await act(async () => { release({ accepted: true }); });
  });

  it('stays disabled between the 200 and the answered event', async () => {
    // `settled` needs step.data.answer, which only response.ask_user_answered
    // supplies. Clearing `busy` on success re-enabled every control in the gap
    // between the two, and a click in that window submits again and 409s —
    // which then retires the question.
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /mysql/i }));
    expect(submitAnswer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /mysql/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /postgres/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled();
  });

  it('re-enables after a retryable failure so the user can try again', async () => {
    const user = userEvent.setup();
    submitAnswer.mockResolvedValueOnce({ status: 'error' });
    renderCard();
    await user.click(screen.getByRole('button', { name: /mysql/i }));
    expect(screen.getByRole('button', { name: /mysql/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /skip/i })).toBeEnabled();
  });

  it('ties the options to the prompt and announces the card arriving', async () => {
    // The only interactive control in an otherwise static stream, appearing
    // unprompted and blocking the agent — a screen-reader user gets no signal
    // that it is their turn without this. The announcement is a fixed line:
    // the prompt can be a long markdown brief, and it is read through the
    // group's aria-labelledby instead.
    renderCard();
    expect(screen.getByRole('group')).toHaveAccessibleName('Which database?');
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('The agent is asking a question');
    expect(status).not.toHaveTextContent(/Which database/);
  });

  it('reports the chosen single-select option as pressed', async () => {
    renderCard({ answer: { status: 'answered', values: ['pg'], text: '' } });
    expect(screen.getByRole('button', { name: /postgres/i }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /mysql/i }))
      .toHaveAttribute('aria-pressed', 'false');
    // …and an answered card no longer announces itself.
    expect(await screen.findByRole('status')).toHaveTextContent('');
  });

  it('submits only once for a rapid double click', async () => {
    // End-to-end statement of the property, not of a specific mechanism: in
    // this DOM the deciding factor is the `disabled` attribute committed by
    // the first click (asserted above); the `if (settled || busy) return;`
    // check in send() is the belt-and-braces layer for callers that reach the
    // handler without going through the DOM. Both must hold for this to pass.
    renderCard();
    const button = screen.getByRole('button', { name: /mysql/i });
    act(() => { fireEvent.click(button); });
    act(() => { fireEvent.click(button); });
    await act(async () => { await Promise.resolve(); });
    expect(submitAnswer).toHaveBeenCalledTimes(1);
  });

  it('shows a single-line prompt verbatim, without markdown parsing', () => {
    // The ask_user tool asks for one short plain-text line; parsed as
    // markdown, "<div>" would vanish and "__init__" would turn bold.
    const prompt = 'Use <div> or edit __init__.py?';
    const { container } = renderCard({ prompt });
    expect(screen.getByText(prompt)).toBeInTheDocument();
    expect(container.querySelector('strong')).toBeNull();
    expect(screen.getByRole('group')).toHaveAccessibleName(prompt);
  });

  it('renders a markdown brief with headings, line breaks and lists', () => {
    // The shape of the artifact PRD brief anton sends: bold section lines
    // followed by a SINGLE newline and the body, and two closing lines
    // joined by a single newline.
    const brief = [
      'Here is what I plan to build.',
      '',
      '**Goal**',
      'A small page that shows a sparrow.',
      '',
      '**Requirements**',
      '- Keep it simple',
      '- Text in English',
      '',
      'If you continue, the proposals above are used as they are.',
      'Continue, or say what to change.',
    ].join('\n');
    const { container } = renderCard({ prompt: brief });
    const prompt = container.querySelector('.markdown-content');
    expect(prompt).not.toBeNull();
    const goal = prompt.querySelector('strong');
    expect(goal).toHaveTextContent('Goal');
    expect(goal.closest('p').querySelector('br')).not.toBeNull();
    expect(prompt.querySelectorAll('li')).toHaveLength(2);
    const closing = [...prompt.querySelectorAll('p')].at(-1);
    expect(closing.querySelector('br')).not.toBeNull();
    expect(prompt.textContent).not.toContain('**');
  });

  it('renders chart and form fences in the prompt as plain code blocks', () => {
    const prompt = [
      'Pick one:',
      '',
      '```chartjs',
      '{"type":"bar","data":{"labels":["a"],"datasets":[{"data":[1]}]}}',
      '```',
      '',
      '```data-vault-form',
      '{"title":"Connect"}',
      '```',
    ].join('\n');
    const { container } = renderCard({ prompt });
    expect(container.textContent).toContain('"type":"bar"');
    expect(container.textContent).toContain('"title":"Connect"');
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.queryByText(/side panel/i)).toBeNull();
    expect(screen.queryByText(/Form spec did not parse/i)).toBeNull();
  });

  describe('a code line wider than the card', () => {
    const CUE = 'Scroll sideways to see the rest of the line.';
    const prompt = [
      'Approve this change?',
      '',
      '```json',
      '{"plan":"Q4-main","site":"TOR-01","sku":"A-100234","qty_before":5,"note":"x","qty":1000000}',
      '```',
    ].join('\n');

    /* happy-dom does no layout, so a code block's widths come from here:
       `content` px of code in a `box` px block. */
    const widths = { content: 0, box: 0 };
    const isCode = (el) => el.classList.contains('anton-code-block-pre');
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
        .mockImplementation(function scrollWidth() { return isCode(this) ? widths.content : 0; });
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
        .mockImplementation(function clientWidth() { return isCode(this) ? widths.box : 0; });
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('fades the right edge and says the block scrolls', () => {
      Object.assign(widths, { content: 750, box: 500 });
      const { container } = renderCard({ prompt });
      expect(screen.getByText(CUE)).toBeInTheDocument();
      expect(container.querySelector('.anton-code-block-fade')).not.toBeNull();
    });

    it('shows no cue for a block that fits', () => {
      Object.assign(widths, { content: 500, box: 500 });
      const { container } = renderCard({ prompt });
      expect(container.querySelector('.anton-code-block-pre')).not.toBeNull();
      expect(screen.queryByText(CUE)).toBeNull();
      expect(container.querySelector('.anton-code-block-fade')).toBeNull();
    });

    it('checks again when the card is resized', () => {
      let resized = null;
      vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { resized = callback; }
        observe() {}
        disconnect() {}
      });
      Object.assign(widths, { content: 500, box: 500 });
      renderCard({ prompt });
      expect(screen.queryByText(CUE)).toBeNull();
      Object.assign(widths, { box: 300 });
      act(() => resized());
      expect(screen.getByText(CUE)).toBeInTheDocument();
    });

    it('leaves the code block of an answer without the cue', () => {
      Object.assign(widths, { content: 750, box: 500 });
      render(<MarkdownContent text={prompt} complete />);
      expect(screen.queryByText(CUE)).toBeNull();
    });
  });

  describe('reopened after its turn timed out', () => {
    const TIMEOUT = { status: 'timeout', values: [], text: '' };

    it('sends a pick as a message by its label, not to the answer broker', async () => {
      const user = userEvent.setup();
      const onAnswerAsMessage = vi.fn();
      renderCard({ answer: TIMEOUT }, { reopened: true, onAnswerAsMessage });
      expect(screen.queryByText(/timed out/i)).toBeNull();
      await user.click(screen.getByRole('button', { name: /postgres/i }));
      expect(onAnswerAsMessage).toHaveBeenCalledWith('postgres');
      expect(submitAnswer).not.toHaveBeenCalled();
      // Busy until the new turn closes the card, so a second click sends nothing.
      await user.click(screen.getByRole('button', { name: /mysql/i }));
      expect(onAnswerAsMessage).toHaveBeenCalledTimes(1);
    });

    it('sends a multi-select as one message of labels', async () => {
      const user = userEvent.setup();
      const onAnswerAsMessage = vi.fn();
      renderCard({ answer: TIMEOUT, select: 'many' }, { reopened: true, onAnswerAsMessage });
      await user.click(screen.getByRole('button', { name: /postgres/i }));
      await user.click(screen.getByRole('button', { name: /mysql/i }));
      await user.click(screen.getByRole('button', { name: /^send$/i }));
      expect(onAnswerAsMessage).toHaveBeenCalledWith('postgres, mysql');
    });

    it('offers no Skip and says typing works even for a select-only question', () => {
      renderCard({ answer: TIMEOUT, allow_custom: false }, { reopened: true, onAnswerAsMessage: vi.fn() });
      expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
      expect(screen.getByText(/type your own answer below/i)).toBeInTheDocument();
    });
  });
});

describe('AskUserCard position-click card', () => {
  const POSITION = {
    question_id: 'browser:approve:t-1:pa-1',
    prompt: '**Approve clicks by position on this page?**\n\nclick at (500, 400)',
    options: [{ value: 'approve', label: 'Approve', detail: 'Allow clicks by position on this page' }, { value: 'cancel', label: 'Cancel' }],
  };
  afterEach(() => vi.useRealTimers());

  it('stays hidden while the app approves it, and shows if that does not land', () => {
    vi.useFakeTimers();
    const { container } = renderCard(POSITION);
    expect(container).toBeEmptyDOMElement();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
  });

  it('never shows once answered', () => {
    const { container } = renderCard({ ...POSITION, answer: { status: 'answered', values: ['approve'], text: '' } });
    expect(container).toBeEmptyDOMElement();
  });
});
