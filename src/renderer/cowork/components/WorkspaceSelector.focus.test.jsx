import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from './ui/Toast';

const api = vi.hoisted(() => ({ fetchHubWorkspaces: vi.fn(), setActiveHubWorkspace: vi.fn() }));
vi.mock('../api', () => api);

import WorkspaceSelector from './WorkspaceSelector';

const USER = { sub: 'user-1' };
const DEFAULT = { id: 'default', displayName: 'Default' };
const ARCHIVED = { id: 'old', displayName: 'Old client', archivedAt: '2026-08-01T00:00:00Z' };
const INITIAL = { enabled: true, reachable: true, workspaces: [ARCHIVED, DEFAULT], activeWorkspaceId: 'old' };
const SWITCHED = { ...INITIAL, workspaces: [DEFAULT], activeWorkspaceId: 'default' };

function SidebarControls() {
  const returnFocusRef = useRef(null);
  return (
    <ToastProvider>
      <WorkspaceSelector user={USER} returnFocusRef={returnFocusRef} />
      <button ref={returnFocusRef}>Settings</button>
      <input aria-label="Task" />
    </ToastProvider>
  );
}

beforeEach(() => {
  api.fetchHubWorkspaces.mockReset().mockResolvedValue(INITIAL);
  api.setActiveHubWorkspace.mockReset();
});

async function chooseDefault() {
  const user = userEvent.setup();
  render(<SidebarControls />);
  const trigger = await screen.findByRole('button', { name: 'Workspace: Old client' });
  trigger.focus();
  await user.keyboard('{Enter}');
  const destination = await screen.findByRole('menuitem', { name: 'Default' });
  await waitFor(() => expect(destination).toHaveFocus());
  await user.keyboard('{Enter}');
  expect(api.setActiveHubWorkspace).toHaveBeenCalledWith('default');
  return trigger;
}

describe('WorkspaceSelector — focus after leaving the last archived workspace', () => {
  it('moves the restored trigger focus to Settings when the delayed response hides it', async () => {
    let finishSwitch;
    api.setActiveHubWorkspace.mockImplementation(() => new Promise((resolve) => { finishSwitch = resolve; }));
    const trigger = await chooseDefault();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());

    await act(async () => { finishSwitch(SWITCHED); });

    expect(screen.queryByRole('button', { name: /^Workspace:/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
  });

  it('preserves focus moved elsewhere while the switch is pending', async () => {
    let finishSwitch;
    api.setActiveHubWorkspace.mockImplementation(() => new Promise((resolve) => { finishSwitch = resolve; }));
    const trigger = await chooseDefault();
    await waitFor(() => expect(trigger).toHaveFocus());
    const task = screen.getByRole('textbox', { name: 'Task' });
    task.focus();

    await act(async () => { finishSwitch(SWITCHED); });

    expect(screen.queryByRole('button', { name: /^Workspace:/ })).toBeNull();
    expect(task).toHaveFocus();
  });

  it('returns focus to Settings when the switch finishes immediately', async () => {
    api.setActiveHubWorkspace.mockResolvedValue(SWITCHED);
    await chooseDefault();

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Workspace:/ })).toBeNull());
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
  });
});
