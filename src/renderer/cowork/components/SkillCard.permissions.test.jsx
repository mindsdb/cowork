import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ skills: null, catalogueStatus: 'idle', isWeb: true }));
const store = vi.hoisted(() => ({
  reload: vi.fn(),
  saveSkillAndSync: vi.fn(),
}));

vi.mock('../lib/skillsStore', () => ({
  useSkills: () => ({
    skills: state.skills,
    catalogueStatus: state.catalogueStatus,
    reload: store.reload,
  }),
  saveSkillAndSync: store.saveSkillAndSync,
}));
vi.mock('../api', () => ({ deleteSkillDraft: vi.fn(async () => {}) }));
vi.mock('../../platform/host', () => ({
  host: { get isWeb() { return state.isWeb; } },
}));

import SkillCard from './SkillCard';

const draft = {
  name: 'Shared skill',
  slug: 'shared-skill',
  instructions: 'Do the thing.',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.skills = null;
  state.catalogueStatus = 'idle';
  state.isWeb = true;
});

describe('SkillCard shared-resource permissions', () => {
  it('keeps member-wide creation available while the hosted catalogue is loading', () => {
    render(<SkillCard skill={draft} projectName="billing" />);
    expect(screen.getByRole('button', { name: 'Save skill' })).toBeEnabled();
  });

  it('disables replacing a skill the caller cannot edit', () => {
    state.catalogueStatus = 'loaded';
    state.skills = [{
      label: 'shared-skill',
      declarative: 'An older revision.',
      capabilities: { canEdit: false },
    }];
    render(<SkillCard skill={draft} projectName="billing" />);
    expect(screen.getByRole('button', { name: 'Read only' })).toBeDisabled();
  });

  it('stays read only for a forbidden skill while a catalogue refresh is in flight', () => {
    // The status is module-global: any surface reloading the catalogue moves
    // every mounted card to 'loading' while the last settled list stays put.
    state.catalogueStatus = 'loading';
    state.skills = [{
      label: 'shared-skill',
      declarative: 'An older revision.',
      capabilities: { canEdit: false },
    }];
    render(<SkillCard skill={draft} projectName="billing" />);
    expect(screen.getByRole('button', { name: 'Read only' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save skill' })).not.toBeInTheDocument();
  });

  it('stays read only for a forbidden skill when a catalogue refresh fails', () => {
    state.catalogueStatus = 'error';
    state.skills = [{
      label: 'shared-skill',
      declarative: 'An older revision.',
      capabilities: { canEdit: false },
    }];
    render(<SkillCard skill={draft} projectName="billing" />);
    expect(screen.getByRole('button', { name: 'Read only' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save skill' })).not.toBeInTheDocument();
  });

  it('keeps member-wide creation available after the catalogue loads', () => {
    state.skills = [];
    state.catalogueStatus = 'loaded';
    render(<SkillCard skill={draft} projectName="billing" />);
    expect(screen.getByRole('button', { name: 'Save skill' })).toBeEnabled();
  });

  it('scopes a hosted generated skill to a user-created default project', async () => {
    state.skills = [];
    state.catalogueStatus = 'loaded';
    store.saveSkillAndSync.mockResolvedValueOnce({ label: 'shared-skill' });

    render(<SkillCard skill={draft} projectName="default" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

    await waitFor(() => expect(store.saveSkillAndSync).toHaveBeenCalledTimes(1));
    expect(store.saveSkillAndSync.mock.calls[0][0].projects).toEqual(['default']);
  });

  it('preserves desktop default as a global generated-skill scope', async () => {
    state.isWeb = false;
    state.skills = [];
    state.catalogueStatus = 'loaded';
    store.saveSkillAndSync.mockResolvedValueOnce({ label: 'shared-skill' });

    render(<SkillCard skill={draft} projectName="default" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

    await waitFor(() => expect(store.saveSkillAndSync).toHaveBeenCalledTimes(1));
    expect(store.saveSkillAndSync.mock.calls[0][0]).not.toHaveProperty('projects');
  });

  it('keeps member-wide creation available when the catalogue load failed', () => {
    state.skills = [];
    state.catalogueStatus = 'error';
    render(<SkillCard skill={draft} projectName="billing" />);
    expect(screen.getByRole('button', { name: 'Save skill' })).toBeEnabled();
  });

  it('uses POST instead of a stale cached update while a reload is unresolved', async () => {
    state.skills = [{
      label: 'shared-skill',
      declarative: 'An older revision.',
      capabilities: { canEdit: true },
    }];
    state.catalogueStatus = 'loading';
    store.saveSkillAndSync.mockResolvedValueOnce({ label: 'shared-skill' });

    render(<SkillCard skill={draft} projectName="billing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

    await waitFor(() => expect(store.saveSkillAndSync).toHaveBeenCalledTimes(1));
    expect(store.saveSkillAndSync.mock.calls[0][1]).toBe(false);
  });

  it('does not turn a create collision into an unauthorized hosted update', async () => {
    state.skills = [];
    state.catalogueStatus = 'loaded';
    store.saveSkillAndSync.mockRejectedValueOnce(new Error('Skill already exists'));
    store.reload.mockResolvedValueOnce({
      ok: true,
      skills: [{
        label: 'shared-skill',
        capabilities: { canEdit: false },
      }],
    });

    render(<SkillCard skill={draft} projectName="billing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

    expect(await screen.findByText('You do not have permission to replace this shared skill.'))
      .toBeInTheDocument();
    expect(store.reload).toHaveBeenCalledTimes(1);
    expect(store.reload).toHaveBeenCalledWith({ afterCurrent: true });
    expect(store.saveSkillAndSync).toHaveBeenCalledTimes(1);
  });

  it('retries a collision only after a fresh capability allows the update', async () => {
    state.skills = [];
    state.catalogueStatus = 'loaded';
    store.saveSkillAndSync
      .mockRejectedValueOnce(new Error('Skill already exists'))
      .mockResolvedValueOnce({ label: 'shared-skill' });
    store.reload.mockResolvedValueOnce({
      ok: true,
      skills: [{
        label: 'shared-skill',
        capabilities: { canEdit: true },
      }],
    });

    render(<SkillCard skill={draft} projectName="billing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

    await waitFor(() => expect(store.saveSkillAndSync).toHaveBeenCalledTimes(2));
    expect(store.reload).toHaveBeenCalledWith({ afterCurrent: true });
    expect(store.saveSkillAndSync.mock.calls[1][1]).toBe(true);
    expect(screen.getByText('Saved to your skills')).toBeInTheDocument();
  });

  it('retries a desktop collision when the local catalogue cannot refresh', async () => {
    state.isWeb = false;
    state.skills = [];
    state.catalogueStatus = 'error';
    store.saveSkillAndSync
      .mockRejectedValueOnce(new Error('Skill already exists'))
      .mockResolvedValueOnce({ label: 'shared-skill' });
    store.reload.mockResolvedValueOnce({ ok: false, skills: [] });

    render(<SkillCard skill={draft} projectName="billing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

    expect(await screen.findByText('Saved to your skills')).toBeInTheDocument();
    expect(store.saveSkillAndSync).toHaveBeenCalledTimes(2);
    expect(store.saveSkillAndSync.mock.calls[1][1]).toBe(true);
  });

  it('does not retry a hosted collision when the fresh catalogue is unavailable', async () => {
    state.skills = [];
    state.catalogueStatus = 'error';
    store.saveSkillAndSync.mockRejectedValueOnce(new Error('Skill already exists'));
    store.reload.mockResolvedValueOnce({ ok: false, skills: [] });

    render(<SkillCard skill={draft} projectName="billing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

    expect(await screen.findByText(/Could not verify permission to replace/i))
      .toBeInTheDocument();
    expect(store.saveSkillAndSync).toHaveBeenCalledTimes(1);
  });
});
