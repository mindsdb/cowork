import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuestionCard } from './QuestionCard';
import { PlanDecision } from './PlanDecision';
import type { PendingQuestion } from './api';

const pending: PendingQuestion = { id: 'question-1', questions: [{
  id: 'layout', header: 'Layout', question: 'Which layout should we build?', isOther: true, isSecret: false,
  options: [{ label: 'Compact', description: 'A single-screen timer.' }, { label: 'Detailed', description: 'Include statistics.' }],
}] };

describe('Task decisions', () => {
  it('requires an explicit answer and sends only after Continue', async () => {
    const answer = vi.fn(async () => {});
    render(<QuestionCard pending={pending} busy={false} onAnswer={answer} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Compact/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Compact/ }));
    expect(answer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(answer).toHaveBeenCalledWith({ layout: ['Compact'] }));
  });

  it('preserves a custom answer when the server rejects it', async () => {
    render(<QuestionCard pending={pending} busy={false} onAnswer={async () => { throw new Error('This question expired.'); }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Use a clock face instead' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This question expired.');
    expect(screen.getByRole('textbox')).toHaveValue('Use a clock face instead');
  });

  it('requires all answers, masks private input and disables duplicate submissions', () => {
    const questions = [...pending.questions, { id: 'secret', header: 'Private', question: 'Enter a private value', isOther: true, isSecret: true }];
    const view = render(<QuestionCard pending={{ ...pending, questions }} busy={false} onAnswer={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Compact/ }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByLabelText('Private answer')).toHaveAttribute('type', 'password');
    fireEvent.change(screen.getByLabelText('Private answer'), { target: { value: 'private' } });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    view.rerender(<QuestionCard pending={{ ...pending, questions }} busy onAnswer={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(screen.getByLabelText('Private answer')).toBeDisabled();
  });

  it('keeps revision distinct from permission to build', async () => {
    const build = vi.fn(async () => {}), revise = vi.fn(async () => {});
    render(<PlanDecision busy={false} onBuild={build} onRevise={revise} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revise plan' }));
    expect(screen.queryByRole('button', { name: 'Build from plan' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update plan' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Add keyboard controls' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update plan' }));
    await waitFor(() => expect(revise).toHaveBeenCalledWith('Add keyboard controls'));
    expect(build).not.toHaveBeenCalled();
  });

  it('retains the plan when starting execution fails', async () => {
    const build = vi.fn(async () => { throw new Error('Review the updated plan before building.'); });
    render(<PlanDecision busy={false} onBuild={build} onRevise={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Build from plan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Review the updated plan before building.');
    expect(screen.getByRole('button', { name: 'Build from plan' })).toBeEnabled();
  });
});
