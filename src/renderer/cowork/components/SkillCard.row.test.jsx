import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ skills: [], catalogueStatus: 'loaded' }));
const store = vi.hoisted(() => ({ reload: vi.fn(), saveSkillAndSync: vi.fn() }));
const download = vi.hoisted(() => vi.fn());

vi.mock('../lib/skillsStore', () => ({
  useSkills: () => ({ skills: state.skills, catalogueStatus: state.catalogueStatus, reload: store.reload }),
  saveSkillAndSync: store.saveSkillAndSync,
  useSkillNames: () => [],
}));
vi.mock('../api', () => ({ deleteSkillDraft: vi.fn(async () => {}) }));
vi.mock('../lib/browserDownload', () => ({ downloadBlob: download }));
vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

import SkillCard from './SkillCard';

const draft = {
  name: 'Weekly digest',
  slug: 'weekly-digest',
  description: 'Write the weekly digest.',
  instructions: 'Do the thing.',
  skill_md: '---\nname: weekly-digest\n---\n\nDo the thing.',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.skills = [];
  state.catalogueStatus = 'loaded';
});

describe('SkillCard object row', () => {
  it('draws the artifact card row: tile, title, kind, and the description on the rail', () => {
    const { container } = render(<SkillCard skill={draft} projectName="billing" />);
    const card = container.querySelector('.chat-artifact-card');
    expect(card).toHaveClass('railed', 'chat-skill-card');
    expect(card.querySelector('.chat-artifact-card__tile')).not.toBeNull();
    expect(screen.getByText('Skill draft · not saved')).toBeInTheDocument();
    expect(card.querySelector('.chat-artifact-card__loc')).toHaveTextContent('Write the weekly digest.');
  });

  it('falls back to the file name on the rail when the skill has no description', () => {
    const { container } = render(<SkillCard skill={{ ...draft, description: '' }} projectName="billing" />);
    expect(container.querySelector('.chat-artifact-card__loc')).toHaveTextContent('weekly-digest.md');
  });

  it('opens the SKILL.md preview from the card and from its title', () => {
    const { container, unmount } = render(<SkillCard skill={draft} projectName="billing" />);
    fireEvent.click(container.querySelector('.chat-artifact-card'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    unmount();
    render(<SkillCard skill={draft} projectName="billing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Weekly digest' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('downloads from the rail without opening the preview', () => {
    const { container } = render(<SkillCard skill={draft} projectName="billing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][1]).toBe('weekly-digest.md');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('.chat-artifact-card__status')).toHaveTextContent('Downloaded');
  });

  it('saves without opening the preview, then drops the Save action', async () => {
    store.saveSkillAndSync.mockResolvedValueOnce({ label: 'weekly-digest' });
    render(<SkillCard skill={draft} projectName="billing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));
    expect(await screen.findByText('Saved to your skills')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /save skill|saved/i })).toBeNull();
    expect(screen.getByText('Skill · saved')).toBeInTheDocument();
  });

  it('says why a read-only skill cannot be saved, beside the disabled button', () => {
    state.skills = [{ label: 'weekly-digest', declarative: 'Older.', capabilities: { canEdit: false } }];
    render(<SkillCard skill={draft} projectName="billing" />);
    expect(screen.getByRole('button', { name: 'Read only' })).toBeDisabled();
    expect(screen.getByText('You do not have permission to replace this shared skill.')).toBeInTheDocument();
  });

  it('holds the Save button busy while the save is in flight', async () => {
    let release;
    store.saveSkillAndSync.mockReturnValueOnce(new Promise((r) => { release = r; }));
    render(<SkillCard skill={draft} projectName="billing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));
    const busy = await screen.findByRole('button', { name: 'Saving…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    release({ label: 'weekly-digest' });
    await waitFor(() => expect(screen.getByText('Saved to your skills')).toBeInTheDocument());
  });
});
