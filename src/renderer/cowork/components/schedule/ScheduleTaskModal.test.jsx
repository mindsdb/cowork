import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScheduleTaskModal from './ScheduleTaskModal';

const PROJECTS = [{ id: 'proj-metrics', name: 'Metrics', path: '/work/metrics' }];

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

  // A spelled-out month disambiguates locale-dependent datetime-local input; these tests run in
  // UTC.
  it('shows an unambiguous named-month caption under the Next run input', () => {
    renderModal();
    setNextRun('2026-08-03T16:37');
    expect(screen.getByText(/Aug 3, 2026/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].enabled).toBe(false);
  });

  // ENG-1255: the server keys the project by id (a UUID). Edit hydrates the
  // Project control from `task.projectId` and submits `project_id`.
  it('edit mode hydrates the project from its id and submits project_id', async () => {
    const task = {
      id: 's1',
      title: 'Weekly',
      prompt: 'summarize',
      cadence: 'weekly',
      nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      projectId: 'proj-metrics',
      enabled: false,
    };
    const { onSubmit } = renderModal({ task });

    // Read the design-system switch via aria-checked/toBeChecked, not a native checked property.
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent('Metrics');

    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [payload, id] = onSubmit.mock.calls[0];
    expect(id).toBe('s1');
    expect(payload.enabled).toBe(false);
    expect(payload.project_id).toBe('proj-metrics');
  });

  // Use a nonempty No project sentinel: Base UI treats empty string as placeholder while submission
  // must mean no project.
  it('defaults to "No project" and submits it as no project', async () => {
    const { onSubmit } = renderModal();

    // The closed Project control shows the catch-all label, not a placeholder.
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent('No project');

    fireEvent.change(screen.getByPlaceholderText(/Ask Anton/i), {
      target: { value: 'no project task' },
    });
    setNextRun(isoLocal(60 * 60 * 1000));
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].project_id).toBeNull();
  });

  // Delete belongs to the task menu and confirmation modal, not the edit footer.
  it('edit-mode footer has no Delete and exactly one Cancel', () => {
    renderModal({ task: {
      id: 's1', title: 'Weekly', prompt: 'summarize', cadence: 'weekly',
      nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      project: 'Metrics', enabled: true,
    } });

    expect(screen.queryByRole('button', { name: /^Delete$/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Cancel$/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Save changes/i })).toBeInTheDocument();
  });
});
