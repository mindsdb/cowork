// `<WorkspaceSelector>` — the MindsHub workspace control, docked with the
// account row at the bottom of the sidebar.
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
// inside a menu that is about identity rather than scope.
//
// **It sits at the bottom rather than the top of the rail.** A workspace is a
// container inside the organization, not what a reader starts a task from, and
// the top of the rail is where the first task begins.
//
// **One workspace draws nothing.** There is nothing to move to, so the control
// would be a switch that switches nothing: a person opening the app for the
// first time gets `Default` and no explanation of what a workspace is. It
// appears once the organization has a second one, which is the first moment the
// question "which workspace am I in" has more than one answer.
//
// No create entry: workspaces are created in the console, and the last row deep
// links there rather than growing a second create flow that would have to open a
// browser anyway.

import { useCallback } from 'react';
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

export function WorkspaceSelector({ user, returnFocusRef }) {
  const { enabled, reachable, workspaces, activeWorkspaceId, switching, switchWorkspace } =
    useHubWorkspaces(user);
  const toastManager = useToastManager();
  const preserveFocusOnRemoval = useCallback((element) => {
    // React 19 calls this cleanup before removing the focused trigger. A delayed
    // switch can hide it after the menu has already restored focus here.
    return () => {
      if (element.contains(element.ownerDocument.activeElement)) {
        returnFocusRef?.current?.focus({ preventScroll: true });
      }
    };
  }, [returnFocusRef]);

  const pick = async (workspaceId) => {
    try {
      await switchWorkspace(workspaceId);
    } catch (err) {
      // A written sentence rather than the error's own message: a refusal
      // arrives as "API /hub/workspaces/active returned 403", which tells the
      // reader nothing and reads like a crash. Nothing is applied
      // optimistically, so without this a refused switch looks like a dead
      // menu item.
      //
      // 409 gets its own sentence because it is the one refusal retrying cannot
      // fix. The server distinguishes "archived" from every other failure on
      // purpose, so collapsing it into "try again" would send someone round a
      // loop that has no exit.
      toastManager.add({
        title:
          err?.status === 409
            ? 'That workspace has been archived. Pick another one.'
            : 'We could not switch workspace. Please try again.',
        type: 'danger',
      });
    }
  };

  const active =
    workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0] ?? null;

  // Nothing to show until the gate is on, the hub answered, and there is
  // somewhere to move to. Rendering a placeholder row would reserve space for a
  // control that may never appear, which reads as a layout bug on every launch.
  //
  // `reachable` is checked rather than inferred from an empty list. The server
  // does send both, and today an unreachable read also carries no rows, so
  // leaning on that would pass every test while resting on a coincidence: the
  // moment a partial answer arrives, the control would name a workspace nobody
  // confirmed.
  //
  // The count is checked on `workspaces` because that list is already what the
  // server offers as places to work: `selectable()` in cowork-server drops
  // archived workspaces, keeping one only while it is the active row so the
  // check can never sit on nothing. So a live workspace beside an archived one
  // counts as one and draws nothing, but a live workspace beside the archived
  // one you are currently in counts as two and does draw. That second case is
  // deliberate: the control is the only way out of a workspace that was
  // archived under you.
  if (!enabled || !reachable || !active || workspaces.length < 2) return null;

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
        // Long names truncate in the row, so hover carries the full one. Only
        // that: a title is the accessible DESCRIPTION, not the state, so it
        // cannot be what tells assistive tech which row you are on.
        title: name,
        // That job is `aria-current`. Without it the only cue on the active row
        // is `aria-disabled`, which announces as "dimmed" and reads as
        // unavailable rather than as "you are here". The tick is decorative and
        // the label is the accessible name, so this is the one place the state
        // can live where a screen reader will reach it.
        aria: isActive ? { 'aria-current': 'true' } : undefined,
        // The trigger already names the active workspace, but both reference
        // consoles mark it in the list too, and without it the only visible
        // signal is the row being disabled. lucide marks its own icons
        // `aria-hidden` when no other a11y prop is passed, so there is nothing
        // to add here.
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
    <div ref={preserveFocusOnRemoval} className="anton-sidebar__workspace-wrap px-2.5 py-1.5">
      <Menu
        trigger={trigger}
        items={items}
        // Opens upward, like the `UserMenu` directly below it: the trigger
        // sits against the footer, so there is no room beneath it.
        side="top"
        align="start"
        width={248}
        ariaLabel="Workspace"
      />
    </div>
  );
}

export default WorkspaceSelector;
