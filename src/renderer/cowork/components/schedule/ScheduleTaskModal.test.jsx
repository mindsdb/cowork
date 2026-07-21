import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScheduleTaskModal from './ScheduleTaskModal';
import { GENERAL_PROJECT_ID } from '../../lib/scheduleProject';

const METRICS_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PROJECTS = [{ id: METRICS_ID, name: 'Metrics', path: '/work/metrics' }];

// Reads the current value of a native <select> inside a Field labelled `label`.
function selectByLabel(label) {
  // Field wraps <span>{label}</span> + control in a <label>, so the control's
  // accessible name is the label text.
  return screen.getByLabelText(label);
}

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
    fireEvent.click(screen.getByRole('checkbox')); // toggle to Paused
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].enabled).toBe(false);
  });

  it('create mode: picking a project sends its id as project_id', async () => {
    const { onSubmit } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/Ask Anton/i), {
      target: { value: 'do the thing' },
    });
    setNextRun(isoLocal(60 * 60 * 1000));
    fireEvent.change(selectByLabel('Project'), { target: { value: METRICS_ID } });
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // The server keys the project by id, not name — this is the round-trip
    // the old `project: <name>` payload silently dropped.
    expect(onSubmit.mock.calls[0][0].project_id).toBe(METRICS_ID);
  });

  it('create mode: "No project" sends project_id: null', async () => {
    const { onSubmit } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/Ask Anton/i), {
      target: { value: 'do the thing' },
    });
    setNextRun(isoLocal(60 * 60 * 1000));
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].project_id).toBeNull();
  });

  it('create mode: a General default context is treated as "No project"', async () => {
    // The app's default selected project is General; it must not preselect a
    // value with no matching <option>, and must submit as project_id: null.
    const { onSubmit } = renderModal({ defaultProjectId: GENERAL_PROJECT_ID });
    expect(selectByLabel('Project').value).toBe('');
    fireEvent.change(screen.getByPlaceholderText(/Ask Anton/i), {
      target: { value: 'do the thing' },
    });
    setNextRun(isoLocal(60 * 60 * 1000));
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].project_id).toBeNull();
  });

  it('edit mode hydrates enabled + project from the task and re-sends project_id', async () => {
    const task = {
      id: 's1',
      title: 'Weekly',
      prompt: 'summarize',
      cadence: 'weekly',
      nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      projectId: METRICS_ID,
      enabled: false,
    };
    const { onSubmit } = renderModal({ task });

    // Hydrated as Paused, with the task's project preselected.
    expect(screen.getByRole('checkbox').checked).toBe(false);
    expect(selectByLabel('Project').value).toBe(METRICS_ID);

    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [payload, id] = onSubmit.mock.calls[0];
    expect(id).toBe('s1');
    expect(payload.enabled).toBe(false);
    expect(payload.project_id).toBe(METRICS_ID);
  });
});
