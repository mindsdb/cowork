import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { codingApi, type CodingSession, type EngineCommand } from './api';
import { CodeComposer } from './CodeComposer';
import { host } from '../../platform/host';


const baseSession: CodingSession = {
  schema_version: 1,
  id: 'task-1',
  title: 'Build the feature',
  engine_id: 'codex',
  engine_adapter_version: '1',
  model: 'fable',
  permission_mode: 'workspace',
  status: 'running',
  source_path: '/work/repo',
  workspace_path: '/work/repo-task',
  workspace_kind: 'git_worktree',
  source_dirty: false,
  event_count: 1,
  created_at: '2026-08-22T10:00:00Z',
  updated_at: '2026-08-22T10:00:00Z',
};

const commands: EngineCommand[] = [
  { name: 'goal', label: 'Start a goal', description: 'Run persistently', argument_hint: '<objective>', action: 'goal' },
  { name: 'status', label: 'Task status', description: 'Show runtime status', action: 'status' },
  { name: 'permissions', label: 'Permissions', description: 'Change task access', action: 'client', client_action: 'controls' },
];

function renderComposer(session: CodingSession = baseSession, history: string[] = []) {
  const onSend = vi.fn(async () => {});
  const onStop = vi.fn(async () => {});
  const onClientCommand = vi.fn();
  const onRemoveQueued = vi.fn(async () => {});
  render(
    <CodeComposer
      session={session}
      busy={false}
      onSend={onSend}
      onStop={onStop}
      commands={commands}
      onClientCommand={onClientCommand}
      onRemoveQueued={onRemoveQueued}
      history={history}
    />,
  );
  return { onSend, onClientCommand, onRemoveQueued };
}


describe('CodeComposer', () => {
  it('supports keyboard slash discovery and preserves a command argument slot', () => {
    const { onSend } = renderComposer({ ...baseSession, status: 'completed' });
    const input = screen.getByRole('textbox', { name: 'Follow-up instruction' });

    fireEvent.change(input, { target: { value: '/go' } });
    expect(screen.getByRole('option', { name: /Start a goal/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue('/goal ');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('routes client commands to their native controls', () => {
    const { onClientCommand, onSend } = renderComposer();
    const input = screen.getByRole('textbox', { name: 'Follow-up instruction' });

    fireEvent.change(input, { target: { value: '/permissions' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onClientCommand).toHaveBeenCalledWith(commands[2]);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('restores an immediate slash command when submission fails', async () => {
    const onSend = vi.fn(async () => { throw new Error('temporarily unavailable'); });
    render(
      <CodeComposer
        session={{ ...baseSession, status: 'completed' }}
        busy={false}
        onSend={onSend}
        onStop={vi.fn(async () => {})}
        commands={commands}
        onClientCommand={vi.fn()}
        onRemoveQueued={vi.fn(async () => {})}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Follow-up instruction' });

    fireEvent.change(input, { target: { value: '/status' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(input).toHaveValue('/status'));
    expect(onSend).toHaveBeenCalledWith('/status', 'turn', []);
  });

  it('lets an engineer explicitly queue the next turn instead of steering', async () => {
    const { onSend } = renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'Queue next' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Follow-up instruction' }), {
      target: { value: 'Run the integration suite after this refactor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Queue instruction' }));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Run the integration suite after this refactor', 'queue', []));
  });

  it('shows persisted queued work and lets the user remove it', () => {
    const { onRemoveQueued } = renderComposer({
      ...baseSession,
      queued_instructions: [{ id: 'queued-1', prompt: 'Run Windows tests', created_at: '2026-08-22T10:01:00Z' }],
    });

    expect(screen.getByText('Run Windows tests')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove queued instruction 1' }));
    expect(onRemoveQueued).toHaveBeenCalledWith('queued-1');
  });

  it('resolves @ mentions to native workspace file references', async () => {
    vi.spyOn(codingApi, 'workspaceFiles').mockResolvedValue({
      items: [{ name: 'src/feature.ts', path: '/work/repo-task/src/feature.ts', kind: 'mention' }],
    });
    const { onSend } = renderComposer({ ...baseSession, status: 'completed' });
    const input = screen.getByRole('textbox', { name: 'Follow-up instruction' });

    fireEvent.change(input, { target: { value: 'Update @feat' } });
    const option = await screen.findByRole('option', { name: /src\/feature\.ts/ });
    fireEvent.click(option);
    expect(input).toHaveValue('Update @src/feature.ts ');
    fireEvent.change(input, { target: { value: 'Update @src/feature.ts safely' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      'Update @src/feature.ts safely',
      'turn',
      [{ name: 'src/feature.ts', path: '/work/repo-task/src/feature.ts', kind: 'mention' }],
    ));
  });

  it('recalls persisted prompt history without losing the current draft', () => {
    renderComposer(
      { ...baseSession, status: 'completed' },
      ['Most recent request', 'Earlier request'],
    );
    const input = screen.getByRole('textbox', { name: 'Follow-up instruction' });
    fireEvent.change(input, { target: { value: 'Current draft' } });

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveValue('Most recent request');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveValue('Earlier request');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveValue('Current draft');
  });

  it('attaches an image pasted into the follow-up composer', async () => {
    vi.spyOn(host, 'getPathForFile').mockReturnValue('/tmp/screenshot.png');
    const { onSend } = renderComposer({ ...baseSession, status: 'completed' });
    const input = screen.getByRole('textbox', { name: 'Follow-up instruction' });
    const image = new File(['image'], 'screenshot.png', { type: 'image/png' });

    fireEvent.paste(input, { clipboardData: { files: [image] } });
    expect(screen.getByText('screenshot.png')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Match this design' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      'Match this design',
      'turn',
      [{ name: 'screenshot.png', path: '/tmp/screenshot.png', kind: 'local_image' }],
    ));
  });
});
