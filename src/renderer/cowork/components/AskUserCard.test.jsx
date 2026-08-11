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
  });

  it('names the choice for a card that was answered by clicking an option', () => {
    // The reload / second-tab case. Only `answer.text` used to be rendered, so
    // an option-answered card showed the prompt, greyed buttons, and nothing
    // about what was chosen.
    renderCard({ answer: { status: 'answered', values: ['pg'], text: '' } });
    expect(screen.getByText(/answered: postgres/i)).toBeInTheDocument();
  });

  it('shows a free-text answer verbatim', () => {
    renderCard({ answer: { status: 'answered', values: [], text: 'clickhouse' } });
    expect(screen.getByText(/clickhouse/)).toBeInTheDocument();
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
    // that it is their turn without this.
    renderCard();
    expect(screen.getByRole('group')).toHaveAccessibleName('Which database?');
    expect(await screen.findByRole('status'))
      .toHaveTextContent(/asking a question: Which database\?/i);
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
});
