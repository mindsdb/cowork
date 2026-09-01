import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pickCodeFolder, getPathForFile } = vi.hoisted(() => ({
  pickCodeFolder: vi.fn(async () => ({ ok: true, path: 'C:\\Users\\Ian & Team\\plain folder' })),
  getPathForFile: vi.fn(() => 'C:\\Users\\Ian\\design.png'),
}));

vi.mock('../../platform/host', () => ({
  host: { pickCodeFolder, getPathForFile },
}));

vi.mock('./api', () => ({
  codingApi: {
    engines: vi.fn(async () => [{ id: 'codex', label: 'Codex', adapter_version: '1', available: true }]),
    inspect: vi.fn(async (path: string) => ({
      path,
      exists: true,
      is_directory: true,
      is_git: false,
      dirty: false,
      warning: 'This folder will be edited directly.',
    })),
  },
}));

import { NewTaskPanel } from './NewTaskPanel';

const models = [
  { id: 'mindshub_air', name: 'MindsHub Air' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  { id: 'fable', name: 'Claude Fable 5' },
  { id: 'sonnet', name: 'Claude Sonnet 5' },
  { id: 'gpt-codex', name: 'GPT 5.3 Codex' },
];

const modelMeta = {
  modelProviders: {
    mindshub_air: 'openai',
    'gpt-5.6-sol': 'openai',
    fable: 'anthropic',
    sonnet: 'anthropic',
    'gpt-codex': 'openai',
  },
  modelFamilies: {
    mindshub_air: 'mindshub_air',
    'gpt-5.6-sol': 'gpt-5.6-sol',
    fable: 'fable',
    sonnet: 'sonnet',
    'gpt-codex': 'gpt-codex',
  },
  modelEnabled: { mindshub_air: true, 'gpt-5.6-sol': true, fable: false, sonnet: false, 'gpt-codex': false },
};


describe('NewTaskPanel', () => {
  beforeEach(() => {
    pickCodeFolder.mockClear();
  });

  it('defaults to GPT-5.6 Sol without exposing secondary folder access in task creation', async () => {
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        onCreate={vi.fn(async () => {})}
      />,
    );

    expect(await screen.findByRole('combobox', { name: 'Choose model' })).toHaveTextContent('GPT-5.6 Sol');
    expect(screen.queryByRole('button', { name: 'Add folder' })).not.toBeInTheDocument();
    expect(screen.queryByText('Choose an available agent and model.')).not.toBeInTheDocument();
  });

  it('falls back to an available model when the configured default needs credits', async () => {
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="sonnet"
        models={models}
        modelMeta={modelMeta}
        onCreate={vi.fn(async () => {})}
      />,
    );

    expect(await screen.findByRole('combobox', { name: 'Choose model' })).toHaveTextContent('GPT-5.6 Sol');
  });

  it('uses the shared searchable catalog instead of a coding-only model list', async () => {
    const user = userEvent.setup();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        onCreate={vi.fn(async () => {})}
      />,
    );

    await user.click(await screen.findByRole('combobox', { name: 'Choose model' }));
    expect(screen.getByRole('combobox', { name: 'Search models' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Claude Fable 5/ })).toHaveTextContent('Needs credits');
    expect(screen.getByRole('option', { name: /GPT 5.3 Codex/ })).toBeInTheDocument();
  });

  it('starts directly in a normal local folder without an extra confirmation gate', async () => {
    const onCreate = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        onCreate={onCreate}
      />,
    );

    await user.click(screen.getByRole('button', { name: /choose folder/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /change folder, currently/i })).toBeInTheDocument());
    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Add a safe feature');

    const start = screen.getByRole('button', { name: /start task/i });
    await waitFor(() => expect(screen.getByText('Ready to start in this folder.')).toBeInTheDocument());
    expect(start).toBeEnabled();
    expect(screen.queryByText('This folder will be edited directly.')).not.toBeInTheDocument();

    await user.click(start);
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      path: 'C:\\Users\\Ian & Team\\plain folder',
      prompt: 'Add a safe feature',
      allowDirect: true,
      engineId: 'codex',
      model: 'gpt-5.6-sol',
      permissionMode: 'supervised',
      attachments: [],
    }));
  });

  it('starts from the composer with the platform keyboard shortcut', async () => {
    const onCreate = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        onCreate={onCreate}
      />,
    );

    await user.click(screen.getByRole('button', { name: /choose folder/i }));
    const input = screen.getByRole('textbox', { name: 'Coding task' });
    await user.type(input, 'Tighten the task composer');
    await waitFor(() => expect(screen.getByText('Ready to start in this folder.')).toBeInTheDocument());
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      path: 'C:\\Users\\Ian & Team\\plain folder',
      prompt: 'Tighten the task composer',
    })));
  });

  it('keeps Start actionable and explains the next missing step', async () => {
    const user = userEvent.setup();
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="gpt-5.6-sol"
        models={models}
        modelMeta={modelMeta}
        onCreate={vi.fn(async () => {})}
      />,
    );

    const start = await screen.findByRole('button', { name: /start task/i });
    await waitFor(() => expect(start).toBeEnabled());
    expect(screen.getByText('Describe the task and choose a local folder.')).toBeInTheDocument();

    await user.click(start);
    expect(screen.getByRole('textbox', { name: 'Coding task' })).toHaveFocus();
    expect(screen.getByText('Describe what you want changed.')).toBeInTheDocument();
    expect(pickCodeFolder).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox', { name: 'Coding task' }), 'Build a small app');
    expect(screen.getByText('Choose a local folder to continue.')).toBeInTheDocument();
    await user.click(start);
    expect(pickCodeFolder).toHaveBeenCalledOnce();
  });

  it('accepts files dropped onto the task composer', async () => {
    render(
      <NewTaskPanel
        busy={false}
        error=""
        defaultEngineId="codex"
        defaultModel="fable"
        models={models}
        modelMeta={modelMeta}
        onCreate={vi.fn(async () => {})}
      />,
    );
    const image = new File(['image'], 'design.png', { type: 'image/png' });
    const composer = screen.getByRole('region', { name: 'Create coding task' });
    fireEvent.drop(composer, {
      dataTransfer: { files: [image], types: ['Files'] },
    });
    expect(screen.getByText('design.png')).toBeInTheDocument();
  });
});
