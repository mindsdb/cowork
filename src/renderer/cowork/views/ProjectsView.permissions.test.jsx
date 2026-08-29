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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('anton:projects-view');
  localStorage.removeItem('anton:pinned-projects');
  setViewportWidth(1200);
});

afterEach(() => {
  setViewportWidth(1200);
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
});
