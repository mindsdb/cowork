import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalSkillModal } from './PersonalSkillModal';
import { personalSkillsApi, type PersonalSkill } from './personalSkillsApi';

vi.mock('./personalSkillsApi', () => ({ personalSkillsApi: {
  get: vi.fn(), create: vi.fn(), import: vi.fn(), update: vi.fn(), remove: vi.fn(),
} }));
const skill: PersonalSkill = { id: 'my-review', name: 'My review', description: 'Review changed code.', instructions: 'Read every changed file.', enabled: true, projects: [] };
const onClose = vi.fn();
const onSaved = vi.fn();
function open(skillId?: string) { return render(<PersonalSkillModal skillId={skillId} onClose={onClose} onSaved={onSaved} />); }
async function fill() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Name'), skill.name);
  await user.type(screen.getByLabelText('When to use it'), skill.description);
  await user.type(screen.getByLabelText('Instructions'), skill.instructions);
  return user;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(personalSkillsApi.get).mockResolvedValue(skill);
  vi.mocked(personalSkillsApi.create).mockResolvedValue(skill);
  vi.mocked(personalSkillsApi.update).mockResolvedValue(skill);
  vi.mocked(personalSkillsApi.import).mockResolvedValue(skill);
  vi.mocked(personalSkillsApi.remove).mockResolvedValue();
});

describe('Personal skills', () => {
  it('creates a skill without Git and does not submit incomplete instructions', async () => {
    open();
    expect(screen.getByRole('button', { name: 'Add skill' })).toBeDisabled();
    const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    expect(personalSkillsApi.create).toHaveBeenCalledWith({ name: skill.name, description: skill.description, instructions: skill.instructions, enabled: true });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('retains the draft after a failed save and allows retry', async () => {
    vi.mocked(personalSkillsApi.create).mockRejectedValueOnce(new Error('A skill with that name already exists.'));
    open();
    const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(screen.getByLabelText('Instructions')).toHaveValue(skill.instructions);
    expect(onSaved).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('blocks repeated writes and dismissal during a save', async () => {
    let resolve!: (value: PersonalSkill) => void;
    vi.mocked(personalSkillsApi.create).mockReturnValue(new Promise((done) => { resolve = done; }));
    open();
    const user = await fill();
    await user.dblClick(screen.getByRole('button', { name: 'Add skill' }));
    expect(personalSkillsApi.create).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    resolve(skill);
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it('confirms discard but closes an unchanged draft immediately', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    onClose.mockClear();
    await user.type(screen.getByLabelText('Name'), 'Unsaved');
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Unsaved');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('loads, edits and disables a personal skill while keeping its stable identity', async () => {
    const user = userEvent.setup();
    open(skill.id);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(skill.name));
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Better name');
    await user.click(screen.getByRole('switch', { name: 'Available to the agent' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(personalSkillsApi.update).toHaveBeenCalledWith(skill.id, { name: 'Better name', description: skill.description, instructions: skill.instructions, enabled: false });
  });

  it('explains existing project restrictions without replacing them', async () => {
    vi.mocked(personalSkillsApi.get).mockResolvedValue({ ...skill, projects: ['project-one'] });
    open(skill.id);
    expect(await screen.findByText('Existing project restrictions will be kept.')).toBeInTheDocument();
  });

  it('does not expose an editable empty form after a read failure', async () => {
    vi.mocked(personalSkillsApi.get).mockRejectedValueOnce(new Error('Could not load skill'));
    open(skill.id);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load skill');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(skill.name));
  });

  it('waits for delete confirmation and preserves the editor on failure', async () => {
    vi.mocked(personalSkillsApi.remove).mockRejectedValueOnce(new Error('Cannot delete skill'));
    const user = userEvent.setup();
    open(skill.id);
    await user.click(await screen.findByRole('button', { name: 'Delete skill' }));
    expect(personalSkillsApi.remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Delete personal skill?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete skill' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Cannot delete skill');
    expect(onSaved).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete skill' }));
    expect(personalSkillsApi.remove).toHaveBeenCalledWith(skill.id);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('previews an import without persisting it until Add skill is clicked', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('tab', { name: 'Import file' }));
    const content = '---\nname: my-review\ndescription: Review code.\n---\nRead it carefully.';
    await user.upload(screen.getByLabelText('Skill file'), new File([content], 'SKILL.md', { type: 'text/markdown' }));
    expect(await screen.findByText('SKILL.md', { exact: true })).toBeInTheDocument();
    expect(personalSkillsApi.import).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    expect(personalSkillsApi.import).toHaveBeenCalledWith(content);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it.each([
    ['too large', new File(['x'.repeat(120_001)], 'SKILL.md'), 'smaller than 120 KB'],
    ['binary', new File([new Uint8Array([0xff, 0xfe])], 'SKILL.md'), 'UTF-8'],
    ['unsupported', new File(['not a skill'], 'payload.exe'), 'SKILL.md or .skill'],
  ])('rejects %s files before a request', async (_, file, expected) => {
    const user = userEvent.setup({ applyAccept: false });
    open();
    await user.click(screen.getByRole('tab', { name: 'Import file' }));
    await user.upload(screen.getByLabelText('Skill file'), file);
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(personalSkillsApi.import).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add skill' })).toBeDisabled();
  });

  it.each([
    ['too large', new File(['x'.repeat(120_001)], 'replacement.md'), 'smaller than 120 KB'],
    ['binary', new File([new Uint8Array([0xff, 0xfe])], 'replacement.md'), 'UTF-8'],
    ['unsupported', new File(['not a skill'], 'payload.exe'), 'SKILL.md or .skill'],
    ['unreadable', new File(['unreadable'], 'replacement.md'), 'Could not read this file'],
  ])('keeps the previous preview and can import it after a %s replacement', async (kind, file, expected) => {
    if (kind === 'unreadable') vi.spyOn(file, 'arrayBuffer').mockRejectedValueOnce(new Error('Read failed'));
    const user = userEvent.setup({ applyAccept: false });
    open();
    await user.click(screen.getByRole('tab', { name: 'Import file' }));
    const content = '---\nname: original\ndescription: Review code.\n---\nKeep these instructions.';
    await user.upload(screen.getByLabelText('Skill file'), new File([content], 'original.md'));
    expect(await screen.findByText('original.md', { exact: true })).toBeInTheDocument();
    await user.upload(screen.getByLabelText('Skill file'), file);
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(screen.getByText('original.md', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Keep these instructions\./)).toBeInTheDocument();
    expect(screen.queryByText(file.name, { exact: true })).not.toBeInTheDocument();
    expect(personalSkillsApi.import).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add skill' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    expect(personalSkillsApi.import).toHaveBeenCalledWith(content);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('replaces a preview only after the new file has been read successfully', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('tab', { name: 'Import file' }));
    await user.upload(screen.getByLabelText('Skill file'), new File(['Original instructions.'], 'original.md'));
    expect(await screen.findByText('original.md', { exact: true })).toBeInTheDocument();
    let resolve!: (value: ArrayBuffer) => void;
    const replacement = new File(['Replacement instructions.'], 'replacement.md');
    vi.spyOn(replacement, 'arrayBuffer').mockReturnValue(new Promise((done) => { resolve = done; }));
    await user.upload(screen.getByLabelText('Skill file'), replacement);
    expect(screen.getByText('original.md', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(personalSkillsApi.import).not.toHaveBeenCalled();
    resolve(new TextEncoder().encode('Replacement instructions.').buffer);
    expect(await screen.findByText('replacement.md', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('original.md', { exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    expect(personalSkillsApi.import).toHaveBeenCalledWith('Replacement instructions.');
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
