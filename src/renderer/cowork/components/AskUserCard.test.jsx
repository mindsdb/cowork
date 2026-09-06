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
    // Multi-select must show local choices before Send confirms them server-side.
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
    // Explain disabled free text before the user tries the composer, not only after rejection.
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
    // The chosen option must have visible styling, not only a data attribute.
    expect(screen.getByRole('button', { name: /postgres/i }).className)
      .not.toBe(screen.getByRole('button', { name: /mysql/i }).className);
  });

  it('names the choice for a card that was answered by clicking an option', () => {
    // Reloaded option answers must show the confirmed choices, not just disabled buttons.
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
    // Include conversation and question ids; listeners cannot assume this is the active chat's only
    // question.
    expect(onAnswered).toHaveBeenCalledWith({ status: 'not_found' }, 'conv-1', 'ask:1');
  });

  it('disables every control while a submission is in flight', async () => {
    // Assert the disabled DOM guard separately; it can account for the double-click result without
    // exercising the handler guard.
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
    // Keep controls busy after HTTP success until ask_user_answered confirms settlement, preventing
    // a second submission in the gap.
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
    // Announce an unexpected blocking question so screen-reader users know input is required.
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
    // Test observable duplicate prevention. The committed disabled attribute can satisfy this
    // without isolating send's own guard.
    renderCard();
    const button = screen.getByRole('button', { name: /mysql/i });
    act(() => { fireEvent.click(button); });
    act(() => { fireEvent.click(button); });
    await act(async () => { await Promise.resolve(); });
    expect(submitAnswer).toHaveBeenCalledTimes(1);
  });
});
