import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const state = vi.hoisted(() => ({ skills: null, catalogueStatus: 'idle', isWeb: true, canShare: false }));
const store = vi.hoisted(() => ({
  reload: vi.fn(),
  saveSkillAndSync: vi.fn(),
}));

vi.mock('../lib/skillsStore', () => ({
  useSkills: () => ({
    skills: state.skills,
    catalogueStatus: state.catalogueStatus,
    reload: store.reload,
    canShare: state.canShare,
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
  state.canShare = false;
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

describe('SkillCard create-time sharing', () => {
  const question = () => screen.queryByRole('combobox', { name: 'Who can use it' });

  beforeEach(() => {
    state.skills = [];
    state.catalogueStatus = 'loaded';
    state.canShare = true;
  });

  it('asks who can use a new skill with Only me preselected and sends shared false', async () => {
    store.saveSkillAndSync.mockResolvedValueOnce({ label: 'shared-skill' });

    render(<SkillCard skill={draft} projectName="billing" />);
    expect(question()).toHaveTextContent('Only me');
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

    await waitFor(() => expect(store.saveSkillAndSync).toHaveBeenCalledTimes(1));
    const [payload, isEdit] = store.saveSkillAndSync.mock.calls[0];
    expect(isEdit).toBe(false);
    expect(payload).toMatchObject({ label: 'shared-skill', projects: ['billing'], shared: false });
    expect(await screen.findByText('Saved to your skills')).toBeInTheDocument();
    // Once saved, the choice belongs to the skill's page.
    expect(question()).not.toBeInTheDocument();
  });

  it('sends shared true for Everyone, without opening the card, and says it is shared', async () => {
    const user = userEvent.setup();
    store.saveSkillAndSync.mockResolvedValueOnce({ label: 'shared-skill', shared: true });

    render(<SkillCard skill={draft} projectName="billing" />);
    await user.click(question());
    await user.click(await screen.findByRole('option', { name: /Everyone \(read-only\)/ }));
    expect(question()).toHaveTextContent('Everyone (read-only)');
    // The card body opens the SKILL.md; picking a choice must not.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save skill' }));

    await waitFor(() => expect(store.saveSkillAndSync).toHaveBeenCalledTimes(1));
    const [payload, isEdit] = store.saveSkillAndSync.mock.calls[0];
    expect(isEdit).toBe(false);
    /* Shared with everyone, so created unscoped: the chat's project ('billing')
       never rides along, since a reader would apply the creator's scope. */
    expect(payload).toMatchObject({ label: 'shared-skill', shared: true });
    expect(payload).not.toHaveProperty('projects');
    expect(await screen.findByText('Saved and shared with everyone')).toBeInTheDocument();
  });

  it("shows the server's refusal and keeps the choice for another try", async () => {
    const user = userEvent.setup();
    const refusal = "Everyone's agent already has a skill named shared-skill, so sharing yours would reach nobody. Rename your skill before you share it.";
    store.saveSkillAndSync.mockRejectedValueOnce(new Error(refusal));

    render(<SkillCard skill={draft} projectName="billing" />);
    await user.click(question());
    await user.click(await screen.findByRole('option', { name: /Everyone \(read-only\)/ }));
    await user.click(screen.getByRole('button', { name: 'Save skill' }));

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(store.reload).not.toHaveBeenCalled();
    expect(question()).toHaveTextContent('Everyone (read-only)');
    expect(screen.getByRole('button', { name: 'Save skill' })).toBeEnabled();
  });

  it('does not ask where the server lets nobody share', async () => {
    state.canShare = false;
    store.saveSkillAndSync.mockResolvedValueOnce({ label: 'shared-skill' });

    render(<SkillCard skill={draft} projectName="billing" />);
    expect(question()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

    await waitFor(() => expect(store.saveSkillAndSync).toHaveBeenCalledTimes(1));
    expect(store.saveSkillAndSync.mock.calls[0][0]).not.toHaveProperty('shared');
  });

  it("does not ask on an update of the caller's own skill, and sends no choice", async () => {
    state.skills = [{
      label: 'shared-skill',
      declarative: 'An older revision.',
      capabilities: { canEdit: true, canShare: true },
    }];
    store.saveSkillAndSync.mockResolvedValueOnce({ label: 'shared-skill' });

    render(<SkillCard skill={draft} projectName="billing" />);
    expect(question()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

    await waitFor(() => expect(store.saveSkillAndSync).toHaveBeenCalledTimes(1));
    const [payload, isEdit] = store.saveSkillAndSync.mock.calls[0];
    expect(isEdit).toBe(true);
    expect(payload).not.toHaveProperty('shared');
  });

  it.each(['loading', 'error'])(
    "does not ask on an update of the caller's own skill while the list is %s",
    async (catalogueStatus) => {
      /* A refresh anywhere, or a failed one, leaves no verified catalogue, so
         the draft POSTs. The collision fallback then updates without the
         answer, so the remembered entry withholds the question. */
      state.catalogueStatus = catalogueStatus;
      state.skills = [{
        label: 'shared-skill',
        declarative: 'An older revision.',
        capabilities: { canEdit: true, canShare: true },
      }];

      render(<SkillCard skill={draft} projectName="billing" />);
      expect(question()).not.toBeInTheDocument();
      store.saveSkillAndSync.mockResolvedValueOnce({ label: 'shared-skill' });
      fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

      await waitFor(() => expect(store.saveSkillAndSync).toHaveBeenCalledTimes(1));
      expect(store.saveSkillAndSync.mock.calls[0][0]).not.toHaveProperty('shared');
    },
  );

  it('keeps Enter on the choice from opening the card', async () => {
    const user = userEvent.setup();

    render(<SkillCard skill={draft} projectName="billing" />);
    question().focus();
    await user.keyboard('{Enter}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('holds the choice while the save is in flight', async () => {
    let settle;
    store.saveSkillAndSync.mockImplementationOnce(() => new Promise((resolve) => {
      settle = resolve;
    }));

    render(<SkillCard skill={draft} projectName="billing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

    await waitFor(() => expect(question()).toHaveAttribute('data-disabled'));
    settle({ label: 'shared-skill' });
    expect(await screen.findByText('Saved to your skills')).toBeInTheDocument();
  });

  it('does not ask on a skill the caller cannot replace, even while the list refreshes', () => {
    /* A refresh leaves no verified catalogue, so the draft would POST; the
       remembered entry still withholds both the save and the question. */
    state.catalogueStatus = 'loading';
    state.skills = [{
      label: 'shared-skill',
      shared: true,
      capabilities: { canEdit: false, canShare: false },
    }];

    render(<SkillCard skill={draft} projectName="billing" />);
    expect(question()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read only' })).toBeDisabled();
  });

  it.each([
    ['Everyone', /Everyone \(read-only\)/, true],
    ['Only me', null, false],
  ])('never applies %s when a create collision turns into an update, and says so', async (_, pick, shared) => {
    const user = userEvent.setup();
    store.saveSkillAndSync
      .mockRejectedValueOnce(new Error('Skill already exists'))
      .mockResolvedValueOnce({ label: 'shared-skill' });
    store.reload.mockResolvedValueOnce({
      ok: true,
      skills: [{ label: 'shared-skill', capabilities: { canEdit: true } }],
    });

    render(<SkillCard skill={draft} projectName="billing" />);
    if (pick) {
      await user.click(question());
      await user.click(await screen.findByRole('option', { name: pick }));
    }
    await user.click(screen.getByRole('button', { name: 'Save skill' }));

    await waitFor(() => expect(store.saveSkillAndSync).toHaveBeenCalledTimes(2));
    expect(store.saveSkillAndSync.mock.calls[0][0].shared).toBe(shared);
    const [update, isEdit] = store.saveSkillAndSync.mock.calls[1];
    expect(isEdit).toBe(true);
    expect(update).not.toHaveProperty('shared');
    expect(await screen.findByText(
      "Saved over the existing skill. Who can use it didn't change: set it on the skill's page.",
    )).toBeInTheDocument();
    expect(screen.queryByText('Saved to your skills')).not.toBeInTheDocument();
  });
});
