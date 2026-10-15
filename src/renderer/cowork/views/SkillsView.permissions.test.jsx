import { beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
  vi.clearAllMocks();
  skillState.skills = [lockedSkill];
  mocks.reload.mockResolvedValue({ ok: true, skills: [lockedSkill] });
  mocks.uploadSkillFile.mockResolvedValue({
    label: 'uploaded-skill',
    capabilities: { canEdit: true, canDelete: true, canDisable: true },
  });
  localStorage.removeItem('anton:skills-view');
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

  it('shows a built-in skill with every capability false as read-only built-in', () => {
    /* The shape cowork-server sends for a built-in or operator-provided skill
       on a stack where each person has their own space: no capability and no
       attribution actor. */
    const builtinSkill = {
      ...lockedSkill,
      label: 'operator-skill',
      description: 'A skill the operator provides.',
      isBuiltin: true,
      capabilities: { canEdit: false, canDelete: false, canDisable: false },
      attribution: { createdBy: null, lastModifiedBy: null, lastModifiedAt: null },
    };
    skillState.skills = [builtinSkill];
    render(<SkillsView />);

    const row = screen.getByRole('article', { name: 'operator-skill' });
    expect(within(row).getByText('Built-in')).toBeInTheDocument();
    expect(within(row).queryByText('Shared')).not.toBeInTheDocument();
    expect(within(row).queryByText('Another member')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('operator-skill'));

    expect(screen.getByRole('switch', { name: 'Skill enabled' }))
      .toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('note')).toHaveTextContent('Built-in skills are read only.');
    expect(screen.queryByText(/Created by/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const edit = screen.getByRole('menuitem', { name: /Edit/ });
    const uninstall = screen.getByRole('menuitem', { name: /Uninstall/ });
    expect(edit).toHaveAttribute('data-disabled');
    expect(edit).toHaveTextContent('Built-in');
    expect(uninstall).toHaveAttribute('data-disabled');
    expect(uninstall).toHaveTextContent('Built-in');
  });

  it('renders rows with no view toggle, even with a stored grid preference', () => {
    localStorage.setItem('anton:skills-view', 'grid');

    render(<SkillsView />);

    const row = screen.getByRole('article', { name: 'locked-skill' });
    expect(within(row).getByText('creator@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/Created by creator@example.com/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grid' })).not.toBeInTheDocument();
  });

  it('labels the stable creator as Author after another member edits the skill', () => {
    render(<SkillsView />);

    const row = screen.getByRole('article', { name: 'locked-skill' });
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

  it('asks before removing a skill, and Cancel keeps it', async () => {
    const user = userEvent.setup();
    skillState.skills = [{ ...lockedSkill, capabilities: { canEdit: true, canDelete: true, canDisable: true } }];

    render(<SkillsView />);
    await user.click(screen.getByText('locked-skill'));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: /Uninstall/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(mocks.deleteSkillAndSync).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Skill enabled' })).toBeInTheDocument();
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

    render(<SkillsView />);
    await user.click(screen.getByText(first.label));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: /Uninstall/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Remove skill "first-skill"?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
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

describe('SkillsView shared skills', () => {
  // The detail note and cowork-server's 403 message share this sentence.
  const SHARED_NOTE = "This skill is shared with you and can't be changed here.";
  const OWNER_CAPABILITIES = { canEdit: true, canDelete: true, canDisable: true };

  /* Reads which badges the skill's row shows, then opens its detail view and
     actions menu and returns the Edit and Uninstall menu items. The row leaves
     the page with the list, so its badges come back as booleans. */
  async function openActions(skill) {
    const user = userEvent.setup();
    skillState.skills = [skill];
    render(<SkillsView />);
    const row = screen.getByRole('article', { name: skill.label });
    const rowBadges = {
      shared: within(row).queryByText('Shared') !== null,
      builtin: within(row).queryByText('Built-in') !== null,
    };
    await user.click(screen.getByText(skill.label));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    return {
      rowBadges,
      edit: await screen.findByRole('menuitem', { name: /Edit/ }),
      uninstall: await screen.findByRole('menuitem', { name: /Uninstall/ }),
    };
  }

  it('shows a skill someone else shares read-only with a Shared badge', async () => {
    // How cowork-server sends a skill another person shares with the caller.
    const { rowBadges, edit, uninstall } = await openActions({ ...lockedSkill, shared: true });

    expect(rowBadges.shared).toBe(true);
    expect(rowBadges.builtin).toBe(false);
    expect(screen.getByRole('note')).toHaveTextContent(SHARED_NOTE);
    expect(screen.getByRole('switch', { name: 'Skill enabled' }))
      .toHaveAttribute('aria-disabled', 'true');
    expect(edit).toHaveAttribute('data-disabled');
    expect(edit).toHaveTextContent('Shared with you');
    expect(uninstall).toHaveAttribute('data-disabled');
    expect(uninstall).toHaveTextContent('Shared with you');
  });

  it('leaves the switch to the server on a skill someone else shares', async () => {
    /* Turning a shared skill off for oneself is the server's call through
       canDisable; Shared alone never locks the switch. */
    const { rowBadges, edit, uninstall } = await openActions({
      ...lockedSkill,
      shared: true,
      capabilities: { canEdit: false, canDelete: false, canDisable: true },
    });

    expect(rowBadges.shared).toBe(true);
    expect(screen.getByRole('note')).toHaveTextContent(SHARED_NOTE);
    expect(screen.getByRole('switch', { name: 'Skill enabled' }))
      .not.toHaveAttribute('aria-disabled', 'true');
    expect(edit).toHaveAttribute('data-disabled');
    expect(edit).toHaveTextContent('Shared with you');
    expect(uninstall).toHaveAttribute('data-disabled');
    expect(uninstall).toHaveTextContent('Shared with you');
  });

  it("keeps every action on the creator's own shared skill and badges it Shared", async () => {
    const own = { ...lockedSkill, shared: true, capabilities: OWNER_CAPABILITIES };
    const { rowBadges, edit, uninstall } = await openActions(own);

    expect(rowBadges.shared).toBe(true);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Skill enabled' }))
      .not.toHaveAttribute('aria-disabled', 'true');
    expect(edit).not.toHaveAttribute('data-disabled');
    expect(edit).not.toHaveTextContent('Shared with you');
    expect(uninstall).not.toHaveAttribute('data-disabled');
    expect(uninstall).not.toHaveTextContent('Shared with you');

    await userEvent.click(uninstall);
    expect(await screen.findByRole('dialog')).toHaveTextContent(`Remove skill "${own.label}"?`);
  });

  it.each([
    ['without the field', lockedSkill],
    ['with shared false', { ...lockedSkill, shared: false }],
    ['with a non-boolean shared value', { ...lockedSkill, shared: 'true' }],
  ])('keeps the plain read-only note and hint and no Shared badge for a skill %s', async (_, skill) => {
    const { rowBadges, edit, uninstall } = await openActions(skill);

    expect(rowBadges.shared).toBe(false);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Read only — only the creator or an organization admin can change this skill.',
    );
    expect(edit).toHaveAttribute('data-disabled');
    expect(edit).toHaveTextContent('Admin or creator');
    expect(uninstall).toHaveAttribute('data-disabled');
    expect(uninstall).toHaveTextContent('Admin or creator');
  });

  it('keeps every action and no badge for a plain skill the caller owns', async () => {
    const { rowBadges, edit, uninstall } = await openActions({
      ...lockedSkill,
      capabilities: OWNER_CAPABILITIES,
    });

    expect(rowBadges.shared).toBe(false);
    expect(rowBadges.builtin).toBe(false);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(edit).not.toHaveAttribute('data-disabled');
    expect(uninstall).not.toHaveAttribute('data-disabled');
  });
});
