import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listSharedProjectFiles: vi.fn(), readSharedProjectFile: vi.fn(), downloadSharedProjectFile: vi.fn(),
  fetchMemory: vi.fn(async () => ({ sections: [] })),
}));
vi.mock('../api', () => ({
  ...api, createProject: vi.fn(), renameProject: vi.fn(), revealProjectInFinder: vi.fn(),
  fetchArtifacts: vi.fn(async () => []), countNonEmptyMemory: vi.fn(() => 0),
}));
vi.mock('../components/rail', () => ({
  WorkingFolderBox: () => <div>Private artifacts</div>, ContextBox: () => <div>Private instructions</div>, ScheduledBox: () => null,
}));
vi.mock('../components/Composer', () => ({ default: () => <div>Agent composer</div> }));
vi.mock('../components/task', () => ({ TaskList: () => null }));
vi.mock('../components/project/NewProjectModal', () => ({ default: () => null }));
vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

import ProjectsView from './ProjectsView';

const shared = {
  id: 'owner-project-id', name: 'planning', display_name: 'Planning', path: '', shared: true,
  capabilities: { canRun: false, canWriteFiles: false, canRename: false, canDelete: false, canEditInstructions: false },
};
const own = { id: 'my-project-id', name: 'planning', display_name: 'My planning', path: '/own/planning' };

beforeEach(() => {
  vi.clearAllMocks();
  api.listSharedProjectFiles.mockResolvedValue({ files: [{ path: 'report.html', name: 'report.html', size: 12 }] });
  api.readSharedProjectFile.mockResolvedValue({ content: '<script>privateCall()</script>' });
  localStorage.clear();
});

it('opens shared files by UUID without a composer, private context, or executable preview', async () => {
  const { container } = render(<ProjectsView projects={[own, shared]} selectedProject={shared} />);
  expect(screen.queryByText('Agent composer')).not.toBeInTheDocument();
  expect(screen.queryByText('Private instructions')).not.toBeInTheDocument();
  expect(screen.getByText('Shared with you · Read only')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'report.html' }));
  expect(await screen.findByText('<script>privateCall()</script>')).toBeInTheDocument();
  expect(container.querySelector('iframe')).toBeNull();
  expect(api.listSharedProjectFiles).toHaveBeenCalledWith(shared.id);
  expect(api.readSharedProjectFile).toHaveBeenCalledWith(shared.id, 'report.html');
  expect(api.fetchMemory).not.toHaveBeenCalled();
});

it('clears file content when the project grant disappears', async () => {
  const view = render(<ProjectsView projects={[own, shared]} selectedProject={shared} />);
  fireEvent.click(await screen.findByRole('button', { name: 'report.html' }));
  await screen.findByText('<script>privateCall()</script>');
  view.rerender(<ProjectsView projects={[own]} selectedProject={shared} />);
  await waitFor(() => expect(screen.queryByText('<script>privateCall()</script>')).not.toBeInTheDocument());
  expect(screen.queryByText('Agent composer')).not.toBeInTheDocument();
});

it('keeps the same-name owned project executable', () => {
  render(<ProjectsView projects={[own, shared]} selectedProject={own} />);
  expect(screen.getByText('Agent composer')).toBeInTheDocument();
  expect(api.listSharedProjectFiles).not.toHaveBeenCalled();
});

it('tracks the shared project owner rename by immutable id', async () => {
  const view = render(<ProjectsView projects={[shared]} selectedProject={shared} />);
  await screen.findByRole('button', { name: 'report.html' });
  const renamed = { ...shared, name: 'renamed', display_name: 'Renamed planning' };
  view.rerender(<ProjectsView projects={[renamed]} selectedProject={shared} />);
  expect(screen.getByRole('heading', { name: 'Renamed planning' })).toBeInTheDocument();
  expect(screen.queryByText('Agent composer')).not.toBeInTheDocument();
});

it('discards an in-flight file response after an access recheck fails', async () => {
  let finishRead;
  api.readSharedProjectFile.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
  render(<ProjectsView projects={[shared]} selectedProject={shared} />);
  fireEvent.click(await screen.findByRole('button', { name: 'report.html' }));
  api.listSharedProjectFiles.mockRejectedValueOnce(new Error('revoked'));
  fireEvent(window, new Event('focus'));
  await screen.findByText(/This shared project is unavailable/);
  await act(async () => { finishRead({ content: 'stale private content' }); });
  expect(screen.queryByText('stale private content')).not.toBeInTheDocument();
});
