import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { lockedSkill } = vi.hoisted(() => ({ lockedSkill: {
  label: 'locked-skill',
  description: 'A shared skill owned by another member.',
  declarative: 'Do the thing.',
  enabled: true,
  isBuiltin: false,
  projects: [],
  capabilities: { canEdit: false, canDelete: false, canDisable: false },
  attribution: {
    createdBy: { userId: 'creator-id', email: 'creator@example.com' },
    lastModifiedBy: { userId: 'editor-id', email: 'editor@example.com' },
    lastModifiedAt: '2026-08-29T10:00:00Z',
  },
} }));
const mocks = vi.hoisted(() => ({
  reload: vi.fn(),
  uploadSkillFile: vi.fn(),
  saveSkillAndSync: vi.fn(),
  deleteSkillAndSync: vi.fn(),
}));
const skillState = vi.hoisted(() => ({ skills: [] }));

vi.mock('../api', () => ({
  fetchProjects: vi.fn(async () => []),
  uploadSkillFile: (...args) => mocks.uploadSkillFile(...args),
}));

vi.mock('../lib/skillsStore', () => ({
  useSkills: () => ({ skills: skillState.skills, catalogueStatus: 'loaded', reload: mocks.reload }),
  useSkillNames: () => new Set(skillState.skills.map((skill) => skill.label)),
  saveSkillAndSync: (...args) => mocks.saveSkillAndSync(...args),
  deleteSkillAndSync: (...args) => mocks.deleteSkillAndSync(...args),
}));

vi.mock('../components/ui/Toast', () => ({
  useToastManager: () => ({ add: vi.fn() }),
}));

vi.mock('../../platform/host', () => ({
  host: { isWeb: true },
}));

import SkillsView from './SkillsView';

const setViewportWidth = (width) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
};

beforeEach(() => {
  vi.clearAllMocks();
  skillState.skills = [lockedSkill];
  mocks.reload.mockResolvedValue({ ok: true, skills: [lockedSkill] });
  mocks.uploadSkillFile.mockResolvedValue({
    label: 'uploaded-skill',
    capabilities: { canEdit: true, canDelete: true, canDisable: true },
  });
  localStorage.removeItem('anton:skills-view');
  setViewportWidth(1200);
});

afterEach(() => {
  setViewportWidth(1200);
  Reflect.deleteProperty(window, 'confirm');
});

describe('SkillsView shared-resource permissions', () => {
  it('keeps a shared skill readable while disabling forbidden mutations', () => {
    render(<SkillsView />);

    fireEvent.click(screen.getByText('locked-skill'));

    expect(screen.getByRole('switch', { name: 'Skill enabled' }))
      .toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/Created by creator@example.com/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: /Edit/ })).toHaveAttribute('data-disabled');
    expect(screen.getByRole('menuitem', { name: /Uninstall/ })).toHaveAttribute('data-disabled');
  });

  it('forces the grid on phone widths when the persisted preference is list', () => {
    localStorage.setItem('anton:skills-view', 'list');
    setViewportWidth(500);

    render(<SkillsView />);

    expect(screen.getByText('locked-skill')).toBeInTheDocument();
    expect(screen.queryByText('Author')).not.toBeInTheDocument();
    expect(screen.getByText(/Created by creator@example.com/)).toBeInTheDocument();
  });

  it('labels the stable creator as Author after another member edits the skill', () => {
    localStorage.setItem('anton:skills-view', 'list');

    render(<SkillsView />);

    const row = screen.getByRole('button', { name: /locked-skill/i });
    expect(within(row).getByText('creator@example.com')).toBeInTheDocument();
    expect(within(row).queryByText('editor@example.com')).not.toBeInTheDocument();
  });

  it('refreshes the shared catalogue after a successful skill upload', async () => {
    render(<SkillsView />);
    await waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Create skill/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Upload a skill/i }));

    const file = new File(['---\nname: uploaded-skill\n---'], 'SKILL.md', {
      type: 'text/markdown',
    });
    const input = document.querySelector('input[type="file"][accept=".md,.skill,.zip"]');
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(mocks.uploadSkillFile).toHaveBeenCalledWith(file));
    await waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(2));
    expect(mocks.reload.mock.calls[1]).toEqual([{ afterCurrent: true }]);
  });

  it('opens an uploaded skill from the reloaded catalogue, not the upload response', async () => {
    const user = userEvent.setup();
    const uploaded = {
      ...lockedSkill,
      label: 'uploaded-skill',
      capabilities: { canEdit: true, canDelete: true, canDisable: true },
    };
    skillState.skills = [uploaded];
    let settleReload;
    mocks.reload.mockImplementation(() => new Promise((resolve) => {
      settleReload = resolve;
    }));
    // The upload endpoint serializes a skill of its own, so treat its response
    // as one that carries no capabilities.
    mocks.uploadSkillFile.mockResolvedValue({ label: uploaded.label });

    render(<SkillsView />);
    fireEvent.click(screen.getByRole('button', { name: /Create skill/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Upload a skill/i }));

    const file = new File(['---\nname: uploaded-skill\n---'], 'SKILL.md', {
      type: 'text/markdown',
    });
    const input = document.querySelector('input[type="file"][accept=".md,.skill,.zip"]');
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(2));

    // The upload modal closes before its refresh lands, so the skill can be
    // opened while onSkillUploaded still waits on the catalogue.
    await user.click(await screen.findByText(uploaded.label));
    await act(async () => {
      settleReload({ ok: true, skills: [uploaded] });
    });

    expect(screen.getByRole('switch', { name: 'Skill enabled' }))
      .not.toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: /Edit/ }))
      .not.toHaveAttribute('data-disabled');
  });

  it('keeps the creator controls enabled when a save response omits capabilities', async () => {
    const user = userEvent.setup();
    const owned = {
      ...lockedSkill,
      label: 'owned-skill',
      capabilities: { canEdit: true, canDelete: true, canDisable: true },
    };
    skillState.skills = [owned];
    mocks.saveSkillAndSync.mockResolvedValue({ label: owned.label });

    render(<SkillsView />);
    await user.click(screen.getByText(owned.label));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: /Edit/ }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.saveSkillAndSync).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('switch', { name: 'Skill enabled' }))
      .not.toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: /Edit/ }))
      .not.toHaveAttribute('data-disabled');
  });

  it('does not clear a newer skill selection when an older delete settles', async () => {
    const user = userEvent.setup();
    let resolveDelete;
    const first = {
      ...lockedSkill,
      label: 'first-skill',
      capabilities: { canEdit: true, canDelete: true, canDisable: true },
    };
    const second = {
      ...lockedSkill,
      label: 'second-skill',
      capabilities: { canEdit: true, canDelete: true, canDisable: true },
    };
    skillState.skills = [first, second];
    mocks.deleteSkillAndSync.mockImplementation(() => new Promise((resolve) => {
      resolveDelete = resolve;
    }));
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: vi.fn(() => true),
    });

    render(<SkillsView />);
    await user.click(screen.getByText(first.label));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: /Uninstall/ }));
    await waitFor(() => expect(mocks.deleteSkillAndSync).toHaveBeenCalledWith(first.label));

    await user.click(screen.getByRole('button', { name: 'Skills' }));
    await user.click(screen.getByText(second.label));
    expect(screen.getByText(second.label)).toBeInTheDocument();

    await act(async () => resolveDelete({ status: 'deleted' }));
    expect(screen.getByText(second.label)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Skill enabled' })).toBeInTheDocument();
  });

  it.each(['success', 'failure'])(
    'does not apply a stale toggle %s to a newer skill selection',
    async (outcome) => {
      const user = userEvent.setup();
      let resolveToggle;
      let rejectToggle;
      const first = {
        ...lockedSkill,
        label: 'first-skill',
        enabled: true,
        capabilities: { canEdit: true, canDelete: true, canDisable: true },
      };
      const second = {
        ...lockedSkill,
        label: 'second-skill',
        enabled: true,
        capabilities: { canEdit: true, canDelete: true, canDisable: true },
      };
      skillState.skills = [first, second];
      mocks.saveSkillAndSync.mockImplementation(() => new Promise((resolve, reject) => {
        resolveToggle = resolve;
        rejectToggle = reject;
      }));

      render(<SkillsView />);
      await user.click(screen.getByText(first.label));
      await user.click(screen.getByRole('switch', { name: 'Skill enabled' }));
      await waitFor(() => expect(mocks.saveSkillAndSync).toHaveBeenCalled());
      await user.click(screen.getByRole('button', { name: 'Skills' }));
      await user.click(screen.getByText(second.label));

      await act(async () => {
        if (outcome === 'success') {
          resolveToggle({
            ...first,
            enabled: false,
          });
        } else {
          rejectToggle(new Error('denied'));
        }
        await Promise.resolve();
      });
      expect(screen.getByText(second.label)).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Skill enabled' }))
        .toHaveAttribute('aria-checked', 'true');
    },
  );
});
