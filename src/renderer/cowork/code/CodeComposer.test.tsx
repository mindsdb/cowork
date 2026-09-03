import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { codingApi, type CodingSession, type EngineCommand, type InputReference } from './api';
import { CodeComposer } from './CodeComposer';
import { resetComposerDrafts } from './composerDrafts';
import { resetSkillLibraryCache } from './useSkillLibrary';
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

afterEach(() => {
  vi.restoreAllMocks();
  resetSkillLibraryCache();
  resetComposerDrafts();
});

function renderComposer(session: CodingSession = baseSession, history: string[] = [], referenceRequest: { id: number; item: InputReference } | null = null) {
  const onSend = vi.fn(async () => {});
  const onStop = vi.fn(async () => {});
  const onClientCommand = vi.fn();
  const onPermissionChange = vi.fn(async () => {});
  const onSteerQueued = vi.fn(async () => {});
  const onRemoveQueued = vi.fn(async () => {});
  const { unmount } = render(
    <CodeComposer
      session={session}
      busy={false}
      onSend={onSend}
      onStop={onStop}
      commands={commands}
      onClientCommand={onClientCommand}
      onPermissionChange={onPermissionChange}
      onSteerQueued={onSteerQueued}
      onRemoveQueued={onRemoveQueued}
      history={history}
      referenceRequest={referenceRequest}
    />,
  );
  return { onSend, onClientCommand, onPermissionChange, onSteerQueued, onRemoveQueued, unmount };
}


describe('CodeComposer', () => {
  it('puts searchable MindsHub skills ahead of agent commands', async () => {
    vi.spyOn(codingApi, 'skillLibrary').mockResolvedValue({
      sources: [],
      items: [{ id: 'personal:verify-release', kind: 'skill', name: 'Verify release', description: 'Run the release verification workflow', origin: 'personal', source_name: 'Yours', path: 'verify-release', enabled: true, enabled_project_ids: [] }],
    });
    renderComposer({ ...baseSession, status: 'completed' });
    const input = screen.getByRole('textbox', { name: 'Follow-up instruction' });

    fireEvent.change(input, { target: { value: '/' } });
    expect(await screen.findByText('$verify-release')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search skills and commands' })).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('$verify-release');
    expect(screen.getByText('MindsHub skills')).toBeInTheDocument();
    expect(screen.getByText('Codex commands')).toBeInTheDocument();

    fireEvent.click(options[0]);
    expect(input).toHaveValue('$verify-release ');
  });

  it('only offers skills resolved for the task project', async () => {
    vi.spyOn(codingApi, 'skillLibrary').mockResolvedValue({
      sources: [],
      items: [
        { id: 'team:minds-release', kind: 'skill', name: 'Minds release', description: 'Release MindsHub', origin: 'team', source_id: 'team', source_name: 'Engineering', path: 'minds-release/SKILL.md', enabled: false, enabled_project_ids: ['minds'] },
        { id: 'personal:shared-review', kind: 'skill', name: 'Shared review', description: 'Review any project', origin: 'personal', source_name: 'Yours', path: 'shared-review', enabled: true, enabled_project_ids: [] },
      ],
    });
    renderComposer({ ...baseSession, status: 'completed', project_id: 'other', project_name: 'Other project' });
    const input = screen.getByRole('textbox', { name: 'Follow-up instruction' });

    fireEvent.change(input, { target: { value: '/' } });

    await screen.findByText('$shared-review');
    expect(screen.queryByText('$minds-release')).not.toBeInTheDocument();
    expect(screen.getByText('$shared-review')).toBeInTheDocument();
  });

  it('says which skill a project-scoped team skill replaces', async () => {
    const personal = { id: 'personal:review', kind: 'skill' as const, name: 'Review', description: 'Use the personal standard', origin: 'personal' as const, source_name: 'Yours', path: 'review', enabled: true, enabled_project_ids: [] };
    vi.spyOn(codingApi, 'skillLibrary').mockResolvedValue({
      sources: [],
      items: [{ id: 'team:review', kind: 'skill', name: 'Review', description: 'Use the team standard', origin: 'team', source_id: 'team', source_name: 'Engineering', path: 'skills/review/SKILL.md', enabled: true, enabled_project_ids: ['minds'], supersedes: [personal] }],
    });
    renderComposer({ ...baseSession, status: 'completed', project_id: 'minds', project_name: 'MindsHub' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Follow-up instruction' }), { target: { value: '/' } });

    expect(await screen.findByText('Engineering · replaces Yours/Review')).toBeInTheDocument();
  });

  it('shows one deterministic command when team and personal skills share a slug', async () => {
    vi.spyOn(codingApi, 'skillLibrary').mockResolvedValue({
      sources: [],
      items: [
        { id: 'team:review', kind: 'skill', name: 'Team review', description: 'Use the team standard', origin: 'team', source_id: 'team', source_name: 'Engineering', path: 'skills/review/SKILL.md', enabled: true, enabled_project_ids: ['minds'] },
        { id: 'personal:review', kind: 'skill', name: 'Review', description: 'Use the personal standard', origin: 'personal', source_name: 'Yours', path: 'review', enabled: true, enabled_project_ids: [] },
      ],
    });
    renderComposer({ ...baseSession, status: 'completed', project_id: 'minds', project_name: 'MindsHub' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Follow-up instruction' }), { target: { value: '/' } });

    expect(await screen.findAllByText('$review')).toHaveLength(1);
    expect(screen.getByText('Use the team standard')).toBeInTheDocument();
    expect(screen.queryByText('Use the personal standard')).not.toBeInTheDocument();
  });

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

  it('changes task permissions from the composer', async () => {
    const user = userEvent.setup();
    const { onPermissionChange } = renderComposer();
    const permissionPicker = screen.getByRole('combobox', { name: 'Coding permissions' });

    expect(permissionPicker).toHaveClass('meta-pill', 'code-composer-picker', 'code-permission-picker');

    await user.click(permissionPicker);
    await user.click(screen.getByRole('option', { name: 'Full access' }));

    expect(onPermissionChange).toHaveBeenCalledWith('full_access');
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
        onPermissionChange={vi.fn(async () => {})}
        onSteerQueued={vi.fn(async () => {})}
        onRemoveQueued={vi.fn(async () => {})}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Follow-up instruction' });

    fireEvent.change(input, { target: { value: '/status' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(input).toHaveValue('/status'));
    expect(onSend).toHaveBeenCalledWith('/status', 'turn', []);
  });

  it('queues messages by default while the agent is working', async () => {
    const { onSend } = renderComposer();
    fireEvent.change(screen.getByRole('textbox', { name: 'Follow-up instruction' }), {
      target: { value: 'Run the integration suite after this refactor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Queue instruction' }));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Run the integration suite after this refactor', 'queue', []));
    expect(screen.queryByText('Guide now')).not.toBeInTheDocument();
    expect(screen.queryByText('Queue next')).not.toBeInTheDocument();
  });

  it('swaps the primary action between Stop and Queue as a draft is entered', () => {
    renderComposer();
    const input = screen.getByRole('textbox', { name: 'Follow-up instruction' });

    expect(screen.getByRole('button', { name: 'Stop coding agent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Queue instruction' })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Check the Windows build next' } });
    expect(screen.queryByRole('button', { name: 'Stop coding agent' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Queue instruction' })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Stop coding agent' })).toBeInTheDocument();
  });

  it('shows persisted queued work and lets the user remove it', () => {
    const { onSteerQueued, onRemoveQueued } = renderComposer({
      ...baseSession,
      queued_instructions: [{ id: 'queued-1', prompt: 'Run Windows tests', created_at: '2026-08-22T10:01:00Z' }],
    });

    expect(screen.getByText('Run Windows tests')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Steer with queued instruction 1' }));
    expect(onSteerQueued).toHaveBeenCalledWith('queued-1');
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


describe('CodeComposer drafts', () => {
  const completed: CodingSession = { ...baseSession, status: 'completed' };
  const attachment: InputReference = { kind: 'mention', name: 'notes.md', path: '/work/repo/notes.md' };

  it('restores the unsent draft and attachments when the user returns to the task', () => {
    const first = renderComposer(completed, [], { id: 1, item: attachment });
    fireEvent.change(screen.getByRole('textbox', { name: 'Follow-up instruction' }), { target: { value: 'half-written instruction' } });
    expect(screen.getByText('notes.md')).toBeInTheDocument();
    first.unmount();

    const other = renderComposer({ ...completed, id: 'task-2' });
    expect(screen.getByRole('textbox', { name: 'Follow-up instruction' })).toHaveValue('');
    expect(screen.queryByText('notes.md')).not.toBeInTheDocument();
    other.unmount();

    renderComposer(completed);
    expect(screen.getByRole('textbox', { name: 'Follow-up instruction' })).toHaveValue('half-written instruction');
    expect(screen.getByText('notes.md')).toBeInTheDocument();
  });

  it('forgets the draft once it has been sent', async () => {
    const first = renderComposer(completed);
    fireEvent.change(screen.getByRole('textbox', { name: 'Follow-up instruction' }), { target: { value: 'ship it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send follow-up' }));
    await waitFor(() => expect(first.onSend).toHaveBeenCalledOnce());
    first.unmount();

    renderComposer(completed);
    expect(screen.getByRole('textbox', { name: 'Follow-up instruction' })).toHaveValue('');
  });
});
