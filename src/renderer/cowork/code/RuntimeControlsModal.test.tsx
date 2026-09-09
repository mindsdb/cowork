import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

const { pickCodeFolder } = vi.hoisted(() => ({
  pickCodeFolder: vi.fn(async () => ({ ok: true, path: 'C:\\work\\shared' })),
}));

vi.mock('../../platform/host', () => ({
  host: {
    getPlatform: () => 'darwin',
    pickCodeFolder,
  },
}));

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return {
    ...original,
    codingApi: {
      platformStatus: vi.fn(),
      setupWindowsSandbox: vi.fn(),
    },
  };
});

import { RuntimeControlsModal } from './RuntimeControlsModal';


it('reuses the shared model picker and applies additional local folders', async () => {
  const user = userEvent.setup();
  const onApply = vi.fn(async () => {});
  render(
    <RuntimeControlsModal
      open
      sessionId="task-1"
      value={{
        model: 'fable',
        permission_mode: 'supervised',
        reasoning_effort: 'high',
        service_tier: 'standard',
        personality: 'pragmatic',
        network_access: false,
        web_search: false,
        additional_dirs: [],
      }}
      models={[{ id: 'fable', name: 'Claude Fable 5' }, { id: 'codex', name: 'GPT Codex' }]}
      modelMeta={{
        modelProviders: { fable: 'anthropic', codex: 'openai' },
        modelFamilies: { fable: 'fable', codex: 'codex' },
        modelEnabled: { fable: true, codex: true },
      }}
      busy={false}
      onClose={vi.fn()}
      onApply={onApply}
    />,
  );

  expect(screen.getByRole('combobox', { name: 'Task model' })).toHaveTextContent('Claude Fable 5');
  await user.click(screen.getByRole('button', { name: 'Add folder' }));
  expect(await screen.findByText('C:\\work\\shared')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
    model: 'fable',
    additional_dirs: ['C:\\work\\shared'],
  })));
});


it('keeps a failed update actionable inside the modal', async () => {
  const user = userEvent.setup();
  render(
    <RuntimeControlsModal
      open
      sessionId="task-1"
      value={{
        model: 'fable', permission_mode: 'supervised', reasoning_effort: 'high',
        service_tier: 'standard', personality: 'pragmatic', network_access: false,
        web_search: false, additional_dirs: [],
      }}
      models={[{ id: 'fable', name: 'Claude Fable 5' }]}
      modelMeta={{ modelProviders: {}, modelFamilies: {}, modelEnabled: {} }}
      busy={false}
      onClose={vi.fn()}
      onApply={vi.fn(async () => { throw new Error('Runtime is still active'); })}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Apply' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Runtime is still active');
});


it('offers the effort levels of the model in hand and moves to the new default when the model lacks the current level', async () => {
  const user = userEvent.setup();
  const onApply = vi.fn(async () => {});
  render(
    <RuntimeControlsModal
      open
      sessionId="task-1"
      value={{
        model: 'fable', permission_mode: 'supervised', reasoning_effort: 'max',
        service_tier: 'standard', personality: 'pragmatic', network_access: false,
        web_search: false, additional_dirs: [],
      }}
      models={[{ id: 'fable', name: 'Claude Fable 5' }, { id: 'gemini', name: 'Gemini 3.1 Pro' }]}
      modelMeta={{
        modelProviders: { fable: 'anthropic', gemini: 'google' },
        modelEfforts: {
          fable: { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'high' },
          gemini: { efforts: ['low', 'medium', 'high'], default: 'high' },
        },
      }}
      busy={false}
      onClose={vi.fn()}
      onApply={onApply}
    />,
  );

  const effort = screen.getByRole('combobox', { name: 'Reasoning effort' });
  expect(effort).toHaveTextContent('Max');
  await user.click(effort);
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Low', 'Medium', 'HighModel default', 'Xhigh', 'Max']);
  await user.keyboard('{Escape}');

  await user.click(screen.getByRole('combobox', { name: 'Task model' }));
  await user.click(screen.getByRole('option', { name: /Gemini/ }));
  expect(effort).toHaveTextContent('High');

  await user.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini', reasoning_effort: 'high' })));
});


it('hides the effort field for a model that advertises no levels', () => {
  render(
    <RuntimeControlsModal
      open
      sessionId="task-1"
      value={{
        model: 'haiku', permission_mode: 'supervised', reasoning_effort: null,
        service_tier: 'standard', personality: 'pragmatic', network_access: false,
        web_search: false, additional_dirs: [],
      }}
      models={[{ id: 'haiku', name: 'Claude Haiku' }]}
      modelMeta={{ modelProviders: { haiku: 'anthropic' }, modelEfforts: {} }}
      busy={false}
      onClose={vi.fn()}
      onApply={vi.fn()}
    />,
  );

  expect(screen.getByRole('combobox', { name: 'Task model' })).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).toBeNull();
});
