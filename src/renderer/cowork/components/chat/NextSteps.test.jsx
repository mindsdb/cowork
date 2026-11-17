import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const analytics = vi.hoisted(() => ({ trackNextStepsShown: vi.fn(), trackNextStepClicked: vi.fn() }));
vi.mock('../../lib/analytics', () => analytics);

import { NextSteps } from './NextSteps';
import { NEXT_STEP, NEXT_STEP_PROMPTS } from '../../lib/nextSteps';
import { markAnswerScheduled, resetScheduledAnswersForTests } from '../../lib/scheduledAnswers';

const setup = (steps, extra = {}) => {
  const onSend = vi.fn();
  const onSchedule = vi.fn();
  const view = render(
    <NextSteps answerKey="t1:m:a1" resultKind="research" steps={steps} onSend={onSend} onSchedule={onSchedule} {...extra} />,
  );
  return { onSend, onSchedule, ...view };
};

describe('NextSteps', () => {
  beforeEach(() => {
    resetScheduledAnswersForTests();
    analytics.trackNextStepsShown.mockClear();
    analytics.trackNextStepClicked.mockClear();
  });

  it('shows one button per step, in order', () => {
    setup([NEXT_STEP.MAKE_PAGE, NEXT_STEP.SCHEDULE]);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Turn it into a page', 'Run this on a schedule']);
  });

  it('renders nothing without steps', () => {
    const { container } = setup([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('sends a prompt step at once, with no files', () => {
    const { onSend } = setup([NEXT_STEP.MAKE_PAGE]);
    fireEvent.click(screen.getByRole('button', { name: 'Turn it into a page' }));
    expect(onSend).toHaveBeenCalledWith(NEXT_STEP_PROMPTS[NEXT_STEP.MAKE_PAGE], []);
  });

  it('opens the schedule form and sends nothing', () => {
    const { onSend, onSchedule } = setup([NEXT_STEP.MAKE_PAGE, NEXT_STEP.SCHEDULE]);
    fireEvent.click(screen.getByRole('button', { name: 'Run this on a schedule' }));
    expect(onSchedule).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('asks for files first, then sends them with the step', () => {
    const { onSend } = setup([NEXT_STEP.ANOTHER_FILE]);
    const input = screen.getByTestId('next-steps-file-input');
    const picker = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Do the same to another file' }));
    expect(picker).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();

    const file = new File(['a,b'], 'march.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSend).toHaveBeenCalledWith(NEXT_STEP_PROMPTS[NEXT_STEP.ANOTHER_FILE], [
      expect.objectContaining({ source: 'file', pendingFile: file, name: 'march.csv', mime: 'text/csv' }),
    ]);
  });

  it('sends nothing when the file picker closes empty', () => {
    const { onSend } = setup([NEXT_STEP.OWN_DATA]);
    fireEvent.click(screen.getByRole('button', { name: 'Do this with my own data' }));
    fireEvent.change(screen.getByTestId('next-steps-file-input'), { target: { files: [] } });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('records what was shown, and each click with its place in the row', () => {
    setup([NEXT_STEP.MAKE_PAGE, NEXT_STEP.SCHEDULE]);
    expect(analytics.trackNextStepsShown).toHaveBeenCalledWith('t1:m:a1', {
      resultKind: 'research', steps: [NEXT_STEP.MAKE_PAGE, NEXT_STEP.SCHEDULE],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run this on a schedule' }));
    expect(analytics.trackNextStepClicked).toHaveBeenCalledWith({ step: NEXT_STEP.SCHEDULE, resultKind: 'research', position: 1 });
  });

  it('shows the schedule step as done once a schedule is saved from this answer', () => {
    const { onSchedule } = setup([NEXT_STEP.MAKE_PAGE, NEXT_STEP.SCHEDULE]);
    act(() => markAnswerScheduled('t1:m:a1'));
    const done = screen.getByRole('button', { name: 'Scheduled ✓' });
    expect(done).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Run this on a schedule' })).toBeNull();
    fireEvent.click(done);
    expect(onSchedule).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Turn it into a page' })).toBeEnabled();
  });

  it('keeps offering the schedule step under other answers', () => {
    markAnswerScheduled('t1:m:other');
    setup([NEXT_STEP.SCHEDULE]);
    expect(screen.getByRole('button', { name: 'Run this on a schedule' })).toBeEnabled();
  });

  it('sends a step once, however fast the row is clicked again', () => {
    const onSend = vi.fn(() => new Promise(() => {}));
    setup([NEXT_STEP.MAKE_PAGE, NEXT_STEP.SCHEDULE], { onSend });
    const page = screen.getByRole('button', { name: 'Turn it into a page' });
    fireEvent.click(page);
    fireEvent.click(page);
    expect(onSend).toHaveBeenCalledTimes(1);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('sends once even when a second click lands before the row re-renders', () => {
    const onSend = vi.fn(() => new Promise(() => {}));
    setup([NEXT_STEP.MAKE_PAGE, NEXT_STEP.SCHEDULE], { onSend });
    const page = screen.getByRole('button', { name: 'Turn it into a page' });
    act(() => {
      page.click();
      page.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(analytics.trackNextStepClicked).toHaveBeenCalledTimes(1);
  });

  it('sends nothing from files picked after another step of the row already sent', () => {
    const onSend = vi.fn(() => new Promise(() => {}));
    setup([NEXT_STEP.ANOTHER_FILE, NEXT_STEP.MAKE_PAGE], { onSend });
    const input = screen.getByTestId('next-steps-file-input');
    fireEvent.click(screen.getByRole('button', { name: 'Do the same to another file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn it into a page' }));
    fireEvent.change(input, { target: { files: [new File(['a'], 'a.csv')] } });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(NEXT_STEP_PROMPTS[NEXT_STEP.MAKE_PAGE], []);
  });

  it('sends picked files once, and offers nothing more from the row after', () => {
    const onSend = vi.fn(() => new Promise(() => {}));
    setup([NEXT_STEP.ANOTHER_FILE], { onSend });
    const input = screen.getByTestId('next-steps-file-input');
    fireEvent.click(screen.getByRole('button', { name: 'Do the same to another file' }));
    fireEvent.change(input, { target: { files: [new File(['a'], 'a.csv')] } });
    fireEvent.change(input, { target: { files: [new File(['b'], 'b.csv')] } });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Do the same to another file' })).toBeDisabled();
  });

  it('leaves the row usable when the file picker closes with nothing picked', () => {
    const { onSend } = setup([NEXT_STEP.ANOTHER_FILE, NEXT_STEP.MAKE_PAGE]);
    const input = screen.getByTestId('next-steps-file-input');
    const picker = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Do the same to another file' }));
    fireEvent.change(input, { target: { files: [] } });
    for (const button of screen.getAllByRole('button')) expect(button).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Do the same to another file' }));
    expect(picker).toHaveBeenCalledTimes(2);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('leaves the row usable after the schedule form opens', () => {
    const { onSchedule } = setup([NEXT_STEP.MAKE_PAGE, NEXT_STEP.SCHEDULE]);
    fireEvent.click(screen.getByRole('button', { name: 'Run this on a schedule' }));
    expect(onSchedule).toHaveBeenCalledTimes(1);
    for (const button of screen.getAllByRole('button')) expect(button).toBeEnabled();
  });
});
