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

  // Regression (ENG-1244): the native datetime-local control renders in
  // Chromium's locale (ambiguous DD/MM vs MM/DD); a spelled-out-month caption
  // disambiguates the chosen run time. Tests run with TZ=UTC.
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
    fireEvent.click(screen.getByRole('switch')); // toggle to Paused
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

    // Hydrated as Paused. The design-system Switch renders a role="switch"
    // element whose state lives in aria-checked, not a native `.checked`
    // property — read it via jest-dom's toBeChecked().
    expect(screen.getByRole('switch')).not.toBeChecked();
    // Project control resolved the stored id → shows the project name.
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent('Metrics');

    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [payload, id] = onSubmit.mock.calls[0];
    expect(id).toBe('s1');
    expect(payload.enabled).toBe(false);
    expect(payload.project_id).toBe('proj-metrics'); // id round-trips
  });

  // Regression (ENG-1246): the "No project" catch-all must display its label
  // (not the "Select…" placeholder) and must submit as no project. It's modeled
  // with a non-empty sentinel value because Base UI's Select renders the
  // placeholder for an empty-string value — see Select.test.jsx.
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

  // Regression (ENG-1245): the edit form no longer owns a destructive Delete,
  // so its footer can't show a second "Cancel" next to it. Delete moved to the
  // task overflow menu + a ConfirmModal.
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
