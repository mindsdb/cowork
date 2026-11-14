import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../lib/deployment', () => ({ PLATFORM_UI: false }));

import ScheduleTaskModal from './ScheduleTaskModal';

const offered = { id: 'opus-5-5', name: 'Opus 5.5' };
const hidden = { id: 'gpt-luna-5-6', name: 'GPT Luna 5.6' };
const MODELS = [offered, hidden];
const META = { modelEnabled: { [offered.id]: true, [hidden.id]: false } };

function setPickerMode(mode) {
  const meta = document.createElement('meta');
  meta.name = 'cowork-model-picker';
  meta.content = mode;
  document.head.append(meta);
}

afterEach(() => {
  document.head.querySelectorAll('meta[name^="cowork-model-"]').forEach((node) => node.remove());
});

function renderModal(props = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <ScheduleTaskModal open onClose={vi.fn()} onSubmit={onSubmit} projects={[]} agentLabel="Anton" models={MODELS} modelMeta={META} {...props} />,
  );
  fireEvent.change(screen.getByPlaceholderText(/Ask Anton/i), { target: { value: 'check status' } });
  return onSubmit;
}

async function submitted(onSubmit, button = /^Schedule$/) {
  fireEvent.click(screen.getByRole('button', { name: button }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  return onSubmit.mock.calls[0][0];
}

describe('ScheduleTaskModal — model, without the platform UI', () => {
  it('shows no model field when the operator offers no picker, and sends the default', async () => {
    const onSubmit = renderModal();
    expect(screen.queryByRole('combobox', { name: 'Model' })).not.toBeInTheDocument();
    expect((await submitted(onSubmit)).model).toBe('default');
  });

  it('offers only the models the operator offers', async () => {
    setPickerMode('open');
    renderModal();
    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Model' }));
    expect(screen.getByRole('option', { name: /Opus 5\.5/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /GPT Luna 5\.6/ })).not.toBeInTheDocument();
  });

  it('sends the default for a pinned model the operator no longer offers', async () => {
    setPickerMode('open');
    const task = { id: 's1', prompt: 'check status', cadence: 'daily', model: hidden.id };
    const onSubmit = renderModal({ task });
    expect((await submitted(onSubmit, /Save changes/i)).model).toBe('default');
  });
});
