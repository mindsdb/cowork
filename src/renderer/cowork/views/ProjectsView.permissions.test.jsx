import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMocks = vi.hoisted(() => ({
  renameProject: vi.fn(),
}));

vi.mock('../api', () => ({
  createProject: vi.fn(),
  renameProject: (...args) => apiMocks.renameProject(...args),
  revealProjectInFinder: vi.fn(),
  fetchMemory: vi.fn(async () => ({ sections: [] })),
  fetchArtifacts: vi.fn(async () => []),
  countNonEmptyMemory: vi.fn(() => 0),
}));

vi.mock('../components/rail', () => ({
  WorkingFolderBox: () => null,
  ContextBox: ({ project }) => (
    <div data-testid="context-box">Context and instructions for {project.name}</div>
  ),
  ScheduledBox: () => null,
}));

vi.mock('../components/Composer', () => ({ default: () => null }));
vi.mock('../components/task', () => ({ TaskList: () => null }));
vi.mock('../components/project/NewProjectModal', () => ({ default: () => null }));
vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

import ProjectsView from './ProjectsView';

const setViewportWidth = (width) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
};

const lockedProject = {
  id: 'project-1',
  name: 'shared-project',
  path: '/projects/shared-project',
  capabilities: {
    canRename: false,
    canDelete: false,
    canEditInstructions: false,
  },
  attribution: {
    createdBy: { userId: 'creator-id', email: 'creator@example.com' },
    lastModifiedBy: { userId: 'creator-id', email: 'creator@example.com' },
    lastModifiedAt: '2026-08-29T10:00:00Z',
  },
};

// happy-dom ships no window.alert, so the failure messages ProjectsView raises
// are collected here instead of blowing up the render.
let alerts = [];
const originalAlert = window.alert;

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.renameProject.mockReset();
  localStorage.removeItem('anton:projects-view');
  localStorage.removeItem('anton:pinned-projects');
  setViewportWidth(1200);
  alerts = [];
  window.alert = (message) => alerts.push(message);
});

afterEach(() => {
  setViewportWidth(1200);
  window.alert = originalAlert;
});

describe('ProjectsView shared-resource permissions', () => {
  it('keeps a project readable while disabling forbidden rename and delete', () => {
    render(<ProjectsView projects={[lockedProject]} />);

    expect(screen.getByText(/Created by creator@example.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Project menu' }));

    expect(screen.getByRole('menuitem', { name: /Rename/ })).toHaveAttribute('data-disabled');
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toHaveAttribute('data-disabled');
  });

  it('uses server capabilities for a hosted project named default', () => {
    const hostedDefault = {
      ...lockedProject,
      id: 'project-default',
      name: 'default',
      path: '/projects/default',
      capabilities: {
        canRename: true,
        canDelete: true,
        canEditInstructions: true,
      },
    };
    render(<ProjectsView projects={[hostedDefault]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Project menu' }));

    expect(screen.getByRole('menuitem', { name: /Rename/ })).not.toHaveAttribute('data-disabled');
    expect(screen.getByRole('menuitem', { name: /Delete/ })).not.toHaveAttribute('data-disabled');
  });

  it('reveals list-view project actions when reached by keyboard', () => {
    localStorage.setItem('anton:projects-view', 'list');
    render(<ProjectsView projects={[lockedProject]} />);

    const menu = screen.getByRole('button', { name: 'Project menu' });
    expect(menu).toHaveClass('opacity-0');

    fireEvent.focus(menu);

    expect(menu).toHaveClass('opacity-100');
  });

  it('does not activate a grid card when keyboard activates its nested actions', async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();
    render(
      <ProjectsView
        projects={[lockedProject]}
        onSelectProject={onSelectProject}
      />,
    );

    screen.getByRole('button', { name: 'Pin project' }).focus();
    await user.keyboard(' ');
    expect(onSelectProject).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Unpin project' })).toBeInTheDocument();

    screen.getByRole('button', { name: 'Project menu' }).focus();
    await user.keyboard('{Enter}');
    expect(onSelectProject).not.toHaveBeenCalled();
    expect(await screen.findByRole('menu', { name: 'Project actions' })).toBeInTheDocument();
  });

  it('does not activate a list row when Enter opens its nested project menu', async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();
    localStorage.setItem('anton:projects-view', 'list');
    render(
      <ProjectsView
        projects={[lockedProject]}
        onSelectProject={onSelectProject}
      />,
    );

    screen.getByRole('button', { name: 'Project menu' }).focus();
    await user.keyboard('{Enter}');

    expect(onSelectProject).not.toHaveBeenCalled();
    expect(await screen.findByRole('menu', { name: 'Project actions' })).toBeInTheDocument();
  });

  it('keeps card actions visible on phones even when list view was persisted', () => {
    localStorage.setItem('anton:projects-view', 'list');
    setViewportWidth(500);
    render(<ProjectsView projects={[lockedProject]} />);

    expect(screen.getByRole('button', { name: 'Project menu' }))
      .toHaveStyle({ opacity: '1' });
    expect(screen.getByRole('button', { name: 'Pin project' }))
      .toHaveStyle({ opacity: '1' });
  });

  it('renders one mobile-reachable Context instructions surface in project detail', () => {
    setViewportWidth(500);
    render(
      <ProjectsView
        projects={[lockedProject]}
        selectedProject={lockedProject}
      />,
    );

    expect(screen.getAllByTestId('context-box')).toHaveLength(1);
    expect(screen.getByText(`Context and instructions for ${lockedProject.name}`))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Project menu' }))
      .toHaveClass('opacity-100', 'pointer-events-auto');
    expect(screen.queryByRole('button', { name: 'Collapse panel' }))
      .not.toBeInTheDocument();
  });

  it('does not replace a newly opened project when an older rename settles', async () => {
    const user = userEvent.setup();
    let resolveRename;
    const first = {
      ...lockedProject,
      capabilities: { ...lockedProject.capabilities, canRename: true },
    };
    const second = {
      ...lockedProject,
      id: 'project-2',
      name: 'second-project',
      path: '/projects/second-project',
      capabilities: { ...lockedProject.capabilities, canRename: true },
    };
    apiMocks.renameProject.mockImplementation(() => new Promise((resolve) => {
      resolveRename = resolve;
    }));

    render(
      <ProjectsView
        projects={[first, second]}
        selectedProject={first}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Project menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Rename/ }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'renamed-project{Enter}');
    expect(apiMocks.renameProject).toHaveBeenCalledWith(first, 'renamed-project');

    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await user.click(screen.getByText(second.name));
    expect(screen.getByText(`Context and instructions for ${second.name}`))
      .toBeInTheDocument();

    await act(async () => resolveRename({
      ...first,
      name: 'renamed-project',
      path: '/projects/renamed-project',
    }));
    expect(screen.getByText(`Context and instructions for ${second.name}`))
      .toBeInTheDocument();
  });

  it('keeps a completed rename when a stale list response lands after it', async () => {
    const user = userEvent.setup();
    const renameable = {
      ...lockedProject,
      capabilities: { ...lockedProject.capabilities, canRename: true },
    };
    apiMocks.renameProject.mockResolvedValue({
      ...renameable,
      name: 'renamed-project',
      path: '/projects/renamed-project',
    });

    const { rerender } = render(
      <ProjectsView projects={[renameable]} selectedProject={renameable} />,
    );

    await user.click(screen.getByRole('button', { name: 'Project menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Rename/ }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'renamed-project{Enter}');
    expect(await screen.findByText('Context and instructions for renamed-project'))
      .toBeInTheDocument();

    // The refetch that was already in flight when the rename landed still
    // carries the pre-rename name.
    await act(async () => {
      rerender(
        <ProjectsView projects={[{ ...renameable }]} selectedProject={renameable} />,
      );
    });

    expect(screen.getByText('Context and instructions for renamed-project'))
      .toBeInTheDocument();
    expect(screen.queryByText(`Context and instructions for ${renameable.name}`))
      .not.toBeInTheDocument();
  });

  it('drops a stale allow when the refreshed project omits capabilities', async () => {
    const user = userEvent.setup();
    const allowed = {
      ...lockedProject,
      capabilities: { canRename: true, canDelete: true, canEditInstructions: true },
    };
    // A later response that carries no capabilities block at all.
    const withoutCapabilities = { ...allowed };
    delete withoutCapabilities.capabilities;

    const { rerender } = render(
      <ProjectsView projects={[allowed]} selectedProject={allowed} />,
    );

    await user.click(screen.getByRole('button', { name: 'Project menu' }));
    expect(await screen.findByRole('menuitem', { name: /Rename/ }))
      .not.toHaveAttribute('data-disabled');

    await act(async () => {
      rerender(
        <ProjectsView projects={[withoutCapabilities]} selectedProject={allowed} />,
      );
    });

    expect(screen.getByRole('menuitem', { name: /Rename/ })).toHaveAttribute('data-disabled');
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toHaveAttribute('data-disabled');
  });

  it('clears the editor and renames again before the list refetch lands', async () => {
    const user = userEvent.setup();
    const renameable = {
      ...lockedProject,
      capabilities: { ...lockedProject.capabilities, canRename: true },
    };
    apiMocks.renameProject
      .mockResolvedValueOnce({ ...renameable, name: 'first-rename', path: '/projects/first-rename' })
      .mockResolvedValueOnce({ ...renameable, name: 'second-rename', path: '/projects/second-rename' });

    render(<ProjectsView projects={[renameable]} selectedProject={renameable} />);

    await user.click(screen.getByRole('button', { name: 'Project menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Rename/ }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'first-rename{Enter}');
    expect(await screen.findByText('Context and instructions for first-rename'))
      .toBeInTheDocument();

    // `projects` still carries the pre-rename name — the refetch has not landed.
    await user.click(screen.getByRole('button', { name: 'Project menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Rename/ }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'second-rename{Enter}');

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(apiMocks.renameProject).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: 'first-rename' }),
      'second-rename',
    );
    expect(await screen.findByText('Context and instructions for second-rename'))
      .toBeInTheDocument();
  });

  it('closes the editor and says why when rename permission is revoked mid-edit', async () => {
    const user = userEvent.setup();
    const allowed = {
      ...lockedProject,
      capabilities: { ...lockedProject.capabilities, canRename: true },
    };

    const { rerender } = render(
      <ProjectsView projects={[allowed]} selectedProject={allowed} />,
    );

    await user.click(screen.getByRole('button', { name: 'Project menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Rename/ }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();

    await act(async () => {
      rerender(
        <ProjectsView projects={[lockedProject]} selectedProject={allowed} />,
      );
    });

    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'renamed-project{Enter}');

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(apiMocks.renameProject).not.toHaveBeenCalled();
    expect(alerts).toEqual(['You do not have permission to rename this project.']);
  });

  it('never renders a detail kebab for the reserved General project', () => {
    const general = {
      ...lockedProject,
      id: 'project-general',
      name: 'general',
      path: '/projects/general',
    };

    const { rerender } = render(
      <ProjectsView projects={[general]} selectedProject={general} />,
    );
    expect(screen.queryByRole('button', { name: 'Project menu' })).not.toBeInTheDocument();

    // Coarse-pointer widths force the trigger visible via CSS, so the control
    // has to be absent from the DOM rather than merely transparent.
    setViewportWidth(500);
    rerender(<ProjectsView projects={[general]} selectedProject={general} />);
    expect(screen.queryByRole('button', { name: 'Project menu' })).not.toBeInTheDocument();
  });

  it('keeps a normal project detail kebab in the DOM for keyboard reach', () => {
    render(<ProjectsView projects={[lockedProject]} selectedProject={lockedProject} />);

    const kebab = screen.getByRole('button', { name: 'Project menu' });
    expect(kebab).toHaveClass('opacity-0', 'pointer-events-none');

    fireEvent.focus(kebab);
    expect(kebab).toHaveClass('opacity-100', 'pointer-events-auto');
  });

  it('shows a card as deleting and withholds its actions while the server works', () => {
    render(
      <ProjectsView
        projects={[lockedProject]}
        deletingProjectKeys={[lockedProject.id]}
      />,
    );

    expect(screen.getByText('Deleting…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Project menu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pin project' })).not.toBeInTheDocument();
  });

  it('shows a list row as deleting and withholds its menu while the server works', () => {
    localStorage.setItem('anton:projects-view', 'list');
    render(
      <ProjectsView
        projects={[lockedProject]}
        deletingProjectKeys={[lockedProject.id]}
      />,
    );

    expect(screen.getByText('Deleting…')).toBeInTheDocument();
    // Taken out of flow, the same way the row hides a reserved project's menu.
    expect(screen.getByRole('button', { name: 'Project menu' })).toHaveClass('hidden');
  });
});
