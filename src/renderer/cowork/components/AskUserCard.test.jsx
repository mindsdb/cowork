import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('Skip sends a cancellation', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(submitAnswer).toHaveBeenCalledWith('conv-1', 'ask:1', { skipped: true });
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
    expect(onAnswered).toHaveBeenCalledWith({ status: 'not_found' });
  });
});
