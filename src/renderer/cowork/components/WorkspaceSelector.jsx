// `<WorkspaceSelector>` — the MindsHub workspace control at the top of the
// sidebar, between the wordmark and the New task CTA.
//
// A **MindsHub Workspace** is an org-internal container that owns hub resources
// (API keys, artifacts, model entitlements) and lives in the auth service. It is
// not the working folder this app also calls a workspace, which is why
// everything here is named `hubWorkspace`.
//
// **Why it is its own control and not a group inside the account menu.** It was
// a group in there first, and two things were wrong with that. The current
// workspace was invisible until you opened the menu, which is the opposite of
// what a scope indicator is for. And the account menu is where the organization
// selector lands, so two levels of the same hierarchy would have been nested
// inside a menu that is about identity rather than scope. Both reference
// consoles put the scope picker at the top of the rail, above the primary
// action, and show the current value on the trigger.
//
// **It renders for a single workspace too.** There is nothing to switch to, but
// "which workspace am I in" is worth answering on its own, and that question was
// the reason this moved out of the account menu.
//
// No create entry: workspaces are created in the console, and the last row deep
// links there rather than growing a second create flow that would have to open a
// browser anyway.

import { ArrowUpRight, Check, ChevronDown, Settings2 } from 'lucide-react';
import Menu from './ui/Menu';
import { useToastManager } from './ui/Toast';
import { useHubWorkspaces } from '../hooks/useHubWorkspaces';
import { tileLetter, tileStyle } from '../lib/letterTile';
import { openExternal } from '../../platform/host';
import { MINDS_WORKSPACES_URL } from '../../lib/mindsUrls';

// The letter square. Colour is hashed from the id, not the name, so a rename
// keeps the tile people recognise (see lib/letterTile).
export function WorkspaceTile({ id, name, size = 18 }) {
  return (
    <span
      aria-hidden="true"
      className="rounded-[5px] shrink-0 inline-flex items-center justify-center font-bold select-none"
      style={{ ...tileStyle(id), width: size, height: size, fontSize: size * 0.53 }}
    >
      {tileLetter(name)}
    </span>
  );
}

const workspaceName = (workspace) => workspace?.displayName || 'Workspace';

export function WorkspaceSelector({ user }) {
  const { enabled, workspaces, activeWorkspaceId, switching, switchWorkspace } =
    useHubWorkspaces(user);
  const toastManager = useToastManager();

  const pick = async (workspaceId) => {
    try {
      await switchWorkspace(workspaceId);
    } catch {
      // A written sentence rather than the error's own message: a refusal
      // arrives as "API /hub/workspaces/active returned 403", which tells the
      // reader nothing and reads like a crash. Nothing is applied
      // optimistically, so without this a refused switch looks like a dead
      // menu item.
      toastManager.add({
        title: 'We could not switch workspace. Please try again.',
        type: 'danger',
      });
    }
  };

  const active =
    workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0] ?? null;

  // Nothing to show until the gate is on and the hub answered. Rendering a
  // placeholder row would reserve space in the rail for a control that may
  // never appear, which reads as a layout bug on every launch.
  if (!enabled || !active) return null;

  const activeName = workspaceName(active);

  const items = [
    {
      id: 'workspace-group',
      heading: (
        <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-4">
          Workspace
        </div>
      ),
    },
    ...workspaces.map((workspace) => {
      const isActive = workspace.id === active.id;
      const name = workspaceName(workspace);
      return {
        id: `workspace-${workspace.id}`,
        icon: <WorkspaceTile id={workspace.id} name={name} />,
        label: name,
        // Long names truncate in the row, so hover carries the full one.
        title: name,
        // The trigger already names the active workspace, but both reference
        // consoles mark it in the list too, and without it the only signal is
        // the row being disabled, which reads as "unavailable" rather than
        // "you are here".
        hint: isActive ? <Check size={13} strokeWidth={2} className="text-accent" /> : undefined,
        // The active row is not a destination, and a second click during an
        // in-flight switch would race the first.
        disabled: isActive || switching,
        onClick: isActive ? undefined : () => pick(workspace.id),
      };
    }),
    { divider: true },
    {
      id: 'manage-workspaces',
      icon: <Settings2 size={14} strokeWidth={1.5} aria-hidden="true" />,
      label: 'Manage workspaces',
      hint: <ArrowUpRight size={12} strokeWidth={1.5} aria-hidden="true" />,
      title: 'Opens in your browser',
      onClick: () => openExternal(MINDS_WORKSPACES_URL),
    },
  ];

  const trigger = (
    <button
      type="button"
      data-workspace-selector
      aria-label={`Workspace: ${activeName}`}
      // Bordered and surface-filled so it reads as a control rather than a
      // heading. `no-drag` because the whole window is a drag region.
      className="w-full flex items-center gap-2 h-9 px-2.5 rounded-lg border border-solid border-line bg-surface text-left cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] [-webkit-app-region:no-drag]"
    >
      <WorkspaceTile id={active.id} name={activeName} />
      <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-ink" title={activeName}>
        {activeName}
      </span>
      <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-ink-3" />
    </button>
  );

  return (
    <div className="anton-sidebar__workspace-wrap px-2.5 pb-1.5">
      <Menu
        trigger={trigger}
        items={items}
        side="bottom"
        align="start"
        width={248}
        ariaLabel="Workspace"
      />
    </div>
  );
}

export default WorkspaceSelector;
