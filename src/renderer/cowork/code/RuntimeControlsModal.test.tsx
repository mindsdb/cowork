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
