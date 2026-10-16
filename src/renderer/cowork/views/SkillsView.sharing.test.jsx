import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* The real skills store runs here, so a change goes through the same write
   and reload a person's click does. Only the HTTP layer is mocked. */
const api = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => []),
  fetchSkills: vi.fn(),
  saveSkill: vi.fn(),
  deleteSkill: vi.fn(),
  setSkillSharing: vi.fn(),
  uploadSkillFile: vi.fn(),
}));
const toast = vi.hoisted(() => ({ add: vi.fn() }));
const hostState = vi.hoisted(() => ({ isWeb: true }));

vi.mock('../api', () => api);
vi.mock('../components/ui/Toast', () => ({
  useToastManager: () => toast,
}));
vi.mock('../../platform/host', () => ({
  host: { get isWeb() { return hostState.isWeb; } },
}));

const OWNER = { canEdit: true, canDelete: true, canDisable: true };
const own = {
  label: 'weekly-report',
  description: 'Summarize the week.',
  declarative: 'Write the summary.',
  enabled: true,
  isBuiltin: false,
  shared: false,
  projects: [],
  capabilities: { ...OWNER, canShare: true },
  attribution: { createdBy: { userId: 'me', email: 'me@example.com' } },
};

/* The store keeps its list at module level, so each test imports a fresh one. */
async function renderPage(skills, { canShare = true } = {}) {
  vi.resetModules();
  api.fetchSkills.mockResolvedValue({ skills, canShare });
  const { default: SkillsView } = await import('./SkillsView');
  render(<SkillsView />);
  await screen.findByText(skills[0]?.label ?? 'No saved skills yet');
}

async function openSkill(user, label) {
  await user.click(screen.getByText(label));
  return screen.queryByRole('combobox', { name: 'Who can use it' });
}

async function choose(user, control, name) {
  await user.click(control);
  await user.click(await screen.findByRole('option', { name }));
}

const EVERYONE = /Everyone \(read-only\)/;
const ONLY_ME = /Only me/;

beforeEach(() => {
  vi.clearAllMocks();
  hostState.isWeb = true;
});

describe('SkillsView: who can use a skill', () => {
  it("shows the control on the caller's own skill when the server grants canShare", async () => {
    const user = userEvent.setup();
    await renderPage([own]);

    const control = await openSkill(user, own.label);

    expect(control).toHaveTextContent('Only me');
    expect(screen.getByRole('heading', { name: 'Who can use it' })).toBeInTheDocument();
  });

  it.each([
    ['a missing canShare on the desktop app', false, { ...own, capabilities: OWNER }],
    ['a missing canShare on the web', true, { ...own, capabilities: OWNER }],
    ['canShare false', true, { ...own, capabilities: { ...OWNER, canShare: false } }],
    ['a skill someone else shares', true, {
      ...own,
      shared: true,
      capabilities: { canEdit: false, canDelete: false, canDisable: false, canShare: false },
    }],
    ['a built-in skill', true, {
      ...own,
      isBuiltin: true,
      capabilities: { canEdit: false, canDelete: false, canDisable: false, canShare: false },
    }],
  ])('hides the control for %s', async (_, isWeb, skill) => {
    hostState.isWeb = isWeb;
    const user = userEvent.setup();
    await renderPage([skill]);

    const control = await openSkill(user, skill.label);

    expect(control).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Who can use it' })).not.toBeInTheDocument();
  });

  it('shares the skill with everyone, reloads the list and says so', async () => {
    const user = userEvent.setup();
    const shared = { ...own, shared: true };
    await renderPage([own]);
    api.setSkillSharing.mockResolvedValue(shared);
    api.fetchSkills.mockResolvedValue({ skills: [shared], canShare: true });
    const control = await openSkill(user, own.label);
    const loads = api.fetchSkills.mock.calls.length;

    await choose(user, control, EVERYONE);

    await waitFor(() => expect(api.setSkillSharing).toHaveBeenCalledWith('weekly-report', true));
    await waitFor(() => expect(toast.add).toHaveBeenCalledWith({
      title: 'Shared weekly-report with everyone.',
      type: 'success',
    }));
    expect(api.fetchSkills.mock.calls.length).toBe(loads + 1);
    expect(screen.getByRole('combobox', { name: 'Who can use it' })).toHaveTextContent('Everyone (read-only)');
    expect(screen.getByRole('note')).toHaveTextContent(
      "It's shared, so your changes reach everyone it's shared with at their next answer.",
    );
  });

  it('stops sharing the skill and says so', async () => {
    const user = userEvent.setup();
    const shared = { ...own, shared: true };
    await renderPage([shared]);
    api.setSkillSharing.mockResolvedValue(own);
    api.fetchSkills.mockResolvedValue({ skills: [own], canShare: true });
    const control = await openSkill(user, own.label);
    expect(control).toHaveTextContent('Everyone (read-only)');

    await choose(user, control, ONLY_ME);

    await waitFor(() => expect(api.setSkillSharing).toHaveBeenCalledWith('weekly-report', false));
    await waitFor(() => expect(toast.add).toHaveBeenCalledWith({
      title: 'Stopped sharing weekly-report.',
      type: 'success',
    }));
    expect(screen.getByRole('combobox', { name: 'Who can use it' })).toHaveTextContent('Only me');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it("moves the control back and shows the server's refusal", async () => {
    const user = userEvent.setup();
    const refusal = 'Someone else already shares a skill named weekly-report. Rename your skill before you share it.';
    await renderPage([own]);
    api.setSkillSharing.mockRejectedValue(Object.assign(new Error(refusal), { status: 409 }));
    const control = await openSkill(user, own.label);
    const loads = api.fetchSkills.mock.calls.length;

    await choose(user, control, EVERYONE);

    await waitFor(() => expect(toast.add).toHaveBeenCalledWith({ title: refusal, type: 'danger' }));
    const after = screen.getByRole('combobox', { name: 'Who can use it' });
    expect(after).toHaveTextContent('Only me');
    expect(after).not.toHaveAttribute('data-disabled');
    expect(api.fetchSkills.mock.calls.length).toBe(loads);
  });

  it('holds the control while the change is in flight', async () => {
    const user = userEvent.setup();
    let settle;
    await renderPage([own]);
    api.setSkillSharing.mockImplementation(() => new Promise((resolve) => {
      settle = resolve;
    }));
    const control = await openSkill(user, own.label);

    await choose(user, control, EVERYONE);

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Who can use it' }))
      .toHaveAttribute('data-disabled'));
    settle({ ...own, shared: true });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Who can use it' }))
      .not.toHaveAttribute('data-disabled'));
  });

  it('sends nothing when the person picks the current choice again', async () => {
    const user = userEvent.setup();
    await renderPage([own]);
    const control = await openSkill(user, own.label);

    await choose(user, control, ONLY_ME);

    expect(screen.getByRole('combobox', { name: 'Who can use it' })).toHaveTextContent('Only me');
    expect(api.setSkillSharing).not.toHaveBeenCalled();
    expect(toast.add).not.toHaveBeenCalled();
  });

  /* Two of the caller's own skills: a change starts on the first, then the
     person goes back and opens the second while it runs. */
  const other = { ...own, label: 'daily-digest', shared: true };

  async function changeThenOpenOther(user) {
    await renderPage([own, other]);
    await choose(user, await openSkill(user, own.label), EVERYONE);
    await user.click(screen.getByRole('button', { name: 'Skills' }));
    return openSkill(user, other.label);
  }

  it('a refused change leaves a skill opened meanwhile as it was', async () => {
    const user = userEvent.setup();
    let refuse;
    api.setSkillSharing.mockImplementationOnce(() => new Promise((_, reject) => {
      refuse = reject;
    }));

    const control = await changeThenOpenOther(user);
    expect(control).toHaveTextContent('Everyone (read-only)');
    refuse(new Error('Someone else already shares a skill named weekly-report.'));

    await waitFor(() => expect(toast.add).toHaveBeenCalledWith({
      title: 'Someone else already shares a skill named weekly-report.',
      type: 'danger',
    }));
    const after = screen.getByRole('combobox', { name: 'Who can use it' });
    expect(after).toHaveTextContent('Everyone (read-only)');
    expect(after).not.toHaveAttribute('data-disabled');
  });

  it('an earlier change ending does not free a skill whose own change is in flight', async () => {
    const user = userEvent.setup();
    let refuse;
    let settle;
    api.setSkillSharing
      .mockImplementationOnce(() => new Promise((_, reject) => { refuse = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));

    const control = await changeThenOpenOther(user);
    await choose(user, control, ONLY_ME);
    const held = () => screen.getByRole('combobox', { name: 'Who can use it' });
    await waitFor(() => expect(held()).toHaveAttribute('data-disabled'));

    refuse(new Error('Someone else already shares a skill named weekly-report.'));
    await waitFor(() => expect(toast.add).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'danger' }),
    ));
    expect(held()).toHaveAttribute('data-disabled');

    api.fetchSkills.mockResolvedValue({ skills: [own, { ...other, shared: false }], canShare: true });
    settle({ ...other, shared: false });
    await waitFor(() => expect(held()).not.toHaveAttribute('data-disabled'));
    expect(held()).toHaveTextContent('Only me');
  });

  it('a later change on another skill does not free a skill whose own change is in flight', async () => {
    const user = userEvent.setup();
    api.setSkillSharing.mockImplementation(() => new Promise(() => {}));

    await choose(user, await changeThenOpenOther(user), ONLY_ME);
    await user.click(screen.getByRole('button', { name: 'Skills' }));
    const reopened = await openSkill(user, own.label);

    expect(reopened).toHaveAttribute('data-disabled');
    // It shows the choice its own change asks for, not the list's older one.
    expect(reopened).toHaveTextContent('Everyone (read-only)');
    expect(api.setSkillSharing.mock.calls).toEqual([
      ['weekly-report', true],
      ['daily-digest', false],
    ]);
  });
});

describe('SkillsView: asking who can use a new skill', () => {
  async function openWriteForm(user) {
    await user.click(screen.getByRole('button', { name: /Create skill/i }));
    await user.click(await screen.findByRole('menuitem', { name: /Write Skill Instructions/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'new-skill');
    await user.type(within(dialog).getByRole('textbox', { name: 'Instructions' }), 'Do it.');
    return dialog;
  }

  it('asks in the Write form with Only me preselected, and sends shared false', async () => {
    const user = userEvent.setup();
    await renderPage([own]);
    api.saveSkill.mockResolvedValue({ label: 'new-skill' });

    const dialog = await openWriteForm(user);
    const question = within(dialog).getByRole('combobox', { name: 'Who can use it' });
    expect(question).toHaveTextContent('Only me');
    expect(dialog).toHaveTextContent("You can change this later on the skill's page.");
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(api.saveSkill).toHaveBeenCalledTimes(1));
    const [payload, isEdit] = api.saveSkill.mock.calls[0];
    expect(isEdit).toBe(false);
    expect(payload).toMatchObject({ label: 'new-skill', declarative: 'Do it.', shared: false });
  });

  it('sends shared true when the person picks Everyone', async () => {
    const user = userEvent.setup();
    await renderPage([own]);
    api.saveSkill.mockResolvedValue({ label: 'new-skill', shared: true });

    const dialog = await openWriteForm(user);
    await choose(user, within(dialog).getByRole('combobox', { name: 'Who can use it' }), EVERYONE);
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(api.saveSkill).toHaveBeenCalledTimes(1));
    expect(api.saveSkill.mock.calls[0][0].shared).toBe(true);
  });

  it("shows the server's refusal and keeps the form open", async () => {
    const user = userEvent.setup();
    const refusal = "Sharing one skill at a time isn't available here: every skill is already shared with everyone.";
    await renderPage([own]);
    api.saveSkill.mockRejectedValue(new Error(refusal));

    const dialog = await openWriteForm(user);
    await choose(user, within(dialog).getByRole('combobox', { name: 'Who can use it' }), EVERYONE);
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(toast.add).toHaveBeenCalledWith({ title: `Error: ${refusal}.`, type: 'danger' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not ask, and sends no choice, where the list says nobody can share', async () => {
    const user = userEvent.setup();
    await renderPage([{ ...own, capabilities: OWNER }], { canShare: false });
    api.saveSkill.mockResolvedValue({ label: 'new-skill' });

    const dialog = await openWriteForm(user);
    expect(within(dialog).queryByRole('combobox', { name: 'Who can use it' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(api.saveSkill).toHaveBeenCalledTimes(1));
    expect(api.saveSkill.mock.calls[0][0]).not.toHaveProperty('shared');
  });

  it("never asks in the Edit form, which leaves sharing to the skill's page", async () => {
    const user = userEvent.setup();
    await renderPage([own]);
    api.saveSkill.mockResolvedValue(own);

    await openSkill(user, own.label);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: /Edit/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('combobox', { name: 'Who can use it' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveSkill).toHaveBeenCalledTimes(1));
    const [payload, isEdit] = api.saveSkill.mock.calls[0];
    expect(isEdit).toBe(true);
    expect(payload).not.toHaveProperty('shared');
  });

  async function cancel(user, dialog) {
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }

  it('opens the Write form at Only me again after Everyone then Cancel', async () => {
    const user = userEvent.setup();
    await renderPage([own]);
    api.saveSkill.mockResolvedValue({ label: 'new-skill' });

    const first = await openWriteForm(user);
    await choose(user, within(first).getByRole('combobox', { name: 'Who can use it' }), EVERYONE);
    await cancel(user, first);
    const dialog = await openWriteForm(user);

    expect(within(dialog).getByRole('combobox', { name: 'Who can use it' })).toHaveTextContent('Only me');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.saveSkill).toHaveBeenCalledTimes(1));
    expect(api.saveSkill.mock.calls[0][0].shared).toBe(false);
  });

  async function openUpload(user) {
    await user.click(screen.getByRole('button', { name: /Create skill/i }));
    await user.click(await screen.findByRole('menuitem', { name: /Upload a skill/i }));
    return screen.findByRole('dialog');
  }

  async function submitUpload(user, dialog, pick) {
    const file = new File(['---\nname: uploaded-skill\n---'], 'SKILL.md', { type: 'text/markdown' });
    await user.upload(dialog.querySelector('input[type="file"]'), file);
    if (pick) await choose(user, within(dialog).getByRole('combobox', { name: 'Who can use it' }), pick);
    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(api.uploadSkillFile).toHaveBeenCalledTimes(1));
    return file;
  }

  async function uploadWith(user, pick) {
    const dialog = await openUpload(user);
    const file = await submitUpload(user, dialog, pick);
    return { dialog, file };
  }

  it('opens the Upload modal at Only me again after Everyone then Cancel', async () => {
    const user = userEvent.setup();
    await renderPage([own]);
    api.uploadSkillFile.mockResolvedValue({ label: 'uploaded-skill' });

    const first = await openUpload(user);
    await choose(user, within(first).getByRole('combobox', { name: 'Who can use it' }), EVERYONE);
    await cancel(user, first);
    const dialog = await openUpload(user);

    expect(within(dialog).getByRole('combobox', { name: 'Who can use it' })).toHaveTextContent('Only me');
    const file = await submitUpload(user, dialog, null);
    expect(api.uploadSkillFile).toHaveBeenCalledWith(file, { shared: false });
  });

  it('holds the question while the upload is in flight', async () => {
    const user = userEvent.setup();
    let settle;
    await renderPage([own]);
    api.uploadSkillFile.mockImplementationOnce(() => new Promise((resolve) => {
      settle = resolve;
    }));

    const { dialog } = await uploadWith(user, null);

    expect(within(dialog).getByRole('combobox', { name: 'Who can use it' })).toHaveAttribute('data-disabled');
    settle({ label: 'uploaded-skill' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('asks in the Upload modal with Only me preselected', async () => {
    const user = userEvent.setup();
    await renderPage([own]);
    api.uploadSkillFile.mockResolvedValue({ label: 'uploaded-skill' });

    const dialog = await openUpload(user);

    expect(within(dialog).getByRole('combobox', { name: 'Who can use it' })).toHaveTextContent('Only me');
    expect(dialog).toHaveTextContent("You can change this later on the skill's page.");
  });

  it.each([
    ['Only me', null, { shared: false }],
    ['Everyone', EVERYONE, { shared: true }],
  ])('sends the upload with %s', async (_, pick, options) => {
    const user = userEvent.setup();
    await renderPage([own]);
    api.uploadSkillFile.mockResolvedValue({ label: 'uploaded-skill' });

    const { file } = await uploadWith(user, pick);

    expect(api.uploadSkillFile).toHaveBeenCalledWith(file, options);
  });

  it('sends no choice with an upload where the list says nobody can share', async () => {
    const user = userEvent.setup();
    await renderPage([{ ...own, capabilities: OWNER }], { canShare: false });
    api.uploadSkillFile.mockResolvedValue({ label: 'uploaded-skill' });

    const dialog = await openUpload(user);
    expect(within(dialog).queryByRole('combobox', { name: 'Who can use it' })).not.toBeInTheDocument();
    const file = await submitUpload(user, dialog, null);

    expect(api.uploadSkillFile).toHaveBeenCalledWith(file, {});
  });
});
