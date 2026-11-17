import { afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import ScheduleTaskModal from './ScheduleTaskModal';

const projects = [];
const models = [{ id: 'paid', name: 'Paid model' }];
afterEach(() => vi.useRealTimers());

function setup(task) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ScheduleTaskModal open onClose={() => {}} onSubmit={onSubmit} projects={projects} task={task} models={models} />);
  return onSubmit;
}
function clock(at) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(at));
}
async function save(onSubmit) {
  fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  return onSubmit.mock.calls[0][0];
}

it.each(['daily', 'weekdays', 'weekly', 'hourly', 'every_15_minutes', 'every_30_minutes', 'once'])(
  'preserves a deferred %s start and its preview on an unrelated edit', async (cadence) => {
    clock('2026-11-09T12:00:00Z');
    const onSubmit = setup({ id: 's', title: 'test', prompt: 'report', cadence, nextRunAt: '2026-11-16T09:00:00Z' });
    fireEvent.change(screen.getByPlaceholderText('Named from the prompt'), { target: { value: 'Renamed' } });
    expect(screen.getByText(cadence === 'once' ? /^Once,/ : /^Next runs:/)).toHaveTextContent('Nov 16');
    expect((await save(onSubmit)).next_run_at).toBe('2026-11-16T09:00:00.000Z');
  },
);

it('uses a changed time instead of preserving the old deferred start', async () => {
  clock('2026-11-09T12:00:00Z');
  const onSubmit = setup({ id: 's', prompt: 'report', cadence: 'daily', nextRunAt: '2026-11-16T09:00:00Z' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '14:00' } });
  expect((await save(onSubmit)).next_run_at).toBe('2026-11-09T14:00:00.000Z');
});

it('rejects a one-off that expired while the form stayed open', () => {
  clock('2026-11-09T10:00:00Z');
  const onSubmit = setup({ id: 's', prompt: 'report', cadence: 'once', nextRunAt: '2026-11-09T10:01:00Z' });
  vi.setSystemTime(new Date('2026-11-09T10:02:00Z'));
  fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText(/Pick a time in the future/)).toBeInTheDocument();
});

it('advances an expired recurring preview when saving', async () => {
  clock('2026-11-09T10:00:00Z');
  const onSubmit = setup({ id: 's', prompt: 'report', cadence: 'daily', nextRunAt: '2026-11-09T10:01:00Z' });
  vi.setSystemTime(new Date('2026-11-09T10:02:00Z'));
  expect((await save(onSubmit)).next_run_at).toBe('2026-11-10T10:01:00.000Z');
});

it('unlocks a model after availability changes outside the app', async () => {
  function Harness() {
    const [enabled, setEnabled] = useState(false);
    return <ScheduleTaskModal open onClose={() => {}} onSubmit={vi.fn()} projects={projects}
      models={models} modelMeta={{ modelEnabled: { paid: enabled }, onRefresh: async () => setEnabled(true) }} />;
  }
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Model' }));
  await user.click(await screen.findByRole('option', { name: /Paid model/ }));
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Paid model');
});
