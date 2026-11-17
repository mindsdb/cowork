import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const analytics = vi.hoisted(() => ({ trackNextStepsShown: vi.fn(), trackNextStepClicked: vi.fn() }));
vi.mock('../../lib/analytics', () => analytics);

import { NextSteps } from './NextSteps';
import { NEXT_STEP, NEXT_STEP_PROMPTS } from '../../lib/nextSteps';

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
});
