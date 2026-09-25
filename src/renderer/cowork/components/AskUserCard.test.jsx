import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AskUserCard from './AskUserCard';

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
    // Body text, like a typed answer: this is the Accept / Cancel case of the
    // artifact brief.
    expect(answerLine('postgres')).toHaveClass('text-body');
  });

  it('shows a free-text answer verbatim', () => {
    renderCard({ answer: { status: 'answered', values: [], text: 'clickhouse' } });
    expect(screen.getByText(/clickhouse/)).toBeInTheDocument();
  });

  it('shows the answer as body text and keeps its line breaks', () => {
    // An answer typed in the composer is not echoed as a user message, so it
    // has to read as text, not as a faint status caption.
    renderCard({ answer: { status: 'answered', values: [], text: 'line one\nline two' } });
    const shown = answerLine('line one\nline two');
    expect(shown).toHaveClass('text-body', 'whitespace-pre-wrap');
    // The bold prefix is what tells the answer apart from the prompt, which
    // uses the same prose style.
    expect(shown.querySelector('span')).toHaveTextContent('Answered:');
    expect(shown.querySelector('span')).toHaveClass('font-semibold');
  });

  it('shows no hover effect or pointer cursor on the options of a settled card', () => {
    // `hover:` also matches a disabled button, so the options of an answered
    // card used to light up under the mouse.
    renderCard({ answer: { status: 'answered', values: [], text: 'something else' } });
    for (const name of [/postgres/i, /mysql/i]) {
      const option = screen.getByRole('button', { name });
      expect(option).toBeDisabled();
      expect(option.className).not.toMatch(/(^|\s)hover:/);
      expect(option.className).toContain('disabled:cursor-default');
    }
  });

  it('shows no hover effect or pointer cursor on a disabled Send', () => {
    // Multi-select: Send stays disabled until something is picked.
    renderCard({ select: 'many' });
    const send = screen.getByRole('button', { name: /^send$/i });
    expect(send).toBeDisabled();
    expect(send.className).not.toMatch(/(^|\s)hover:/);
    expect(send.className).toContain('disabled:cursor-default');
  });

  it('makes every control look disabled while a submission is in flight', async () => {
    let release;
    submitAnswer.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    renderCard();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /mysql/i })); });
    for (const name of [/postgres/i, /mysql/i]) {
      const option = screen.getByRole('button', { name });
      expect(option.className).not.toMatch(/(^|\s)hover:/);
      expect(option.className).toContain('disabled:cursor-default');
    }
    const skip = screen.getByRole('button', { name: /skip/i });
    expect(skip).toBeDisabled();
    expect(skip).toHaveClass('disabled:opacity-60', 'disabled:cursor-default');
    await act(async () => { release({ accepted: true }); });
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
    expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled();
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
});
