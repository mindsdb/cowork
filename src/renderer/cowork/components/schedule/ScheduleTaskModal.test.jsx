import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScheduleTaskModal from './ScheduleTaskModal';

const PROJECTS = [{ name: 'Metrics', path: '/work/metrics' }];

function renderModal(props = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <ScheduleTaskModal
      open
      onClose={onClose}
      onSubmit={onSubmit}
      projects={PROJECTS}
      agentLabel="Anton"
      {...props}
    />,
  );
  return { onSubmit, onClose };
}

function setNextRun(value) {
  // The "Next run" datetime-local input.
  const input = document.querySelector('input[type="datetime-local"]');
  fireEvent.change(input, { target: { value } });
}

function isoLocal(offsetMs) {
  const d = new Date(Date.now() + offsetMs);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

describe('ScheduleTaskModal — S7 fixes', () => {
  it('rejects a next-run time in the past', async () => {
    const { onSubmit } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/Ask Anton/i), {
      target: { value: 'do the thing' },
    });
    setNextRun(isoLocal(-60 * 60 * 1000)); // one hour ago
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    expect(await screen.findByText(/must be in the future/i)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('accepts a future next-run time and submits', async () => {
    const { onSubmit } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/Ask Anton/i), {
      target: { value: 'do the thing' },
    });
    setNextRun(isoLocal(60 * 60 * 1000)); // one hour out
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [payload] = onSubmit.mock.calls[0];
    expect(payload.prompt).toBe('do the thing');
    expect(payload.enabled).toBe(true);
  });

  it('carries the enabled toggle into the payload', async () => {
    const { onSubmit } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/Ask Anton/i), {
      target: { value: 'pause me' },
    });
    setNextRun(isoLocal(60 * 60 * 1000));
    fireEvent.click(screen.getByRole('switch')); // toggle to Paused
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].enabled).toBe(false);
  });

  it('edit mode hydrates enabled from the task and resolves project name', async () => {
    const task = {
      id: 's1',
      title: 'Weekly',
      prompt: 'summarize',
      cadence: 'weekly',
      nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      project: 'Metrics',
      enabled: false,
    };
    const { onSubmit } = renderModal({ task });

    // Hydrated as Paused. The design-system Switch renders a role="switch"
    // element whose state lives in aria-checked, not a native `.checked`
    // property — read it via jest-dom's toBeChecked().
    expect(screen.getByRole('switch')).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [payload, id] = onSubmit.mock.calls[0];
    expect(id).toBe('s1');
    expect(payload.enabled).toBe(false);
    expect(payload.project).toBe('Metrics'); // path→name round-trip
  });
});
