// hubWorkspace means an auth-service resource scope within an organization, distinct from the
// working folder.
// Show a single workspace too: the trigger identifies current scope. Creation stays in the console.

import { ArrowUpRight, Check, ChevronDown, Settings2 } from 'lucide-react';
import Menu from './ui/Menu';
import { useToastManager } from './ui/Toast';
import { useHubWorkspaces } from '../hooks/useHubWorkspaces';
import { tileLetter, tileStyle } from '../lib/letterTile';
import { openExternal } from '../../platform/host';
import { MINDS_WORKSPACES_URL } from '../../lib/mindsUrls';

// Hash color by id so renaming preserves the tile.
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
  const { enabled, reachable, workspaces, activeWorkspaceId, switching, switchWorkspace } =
    useHubWorkspaces(user);
  const toastManager = useToastManager();

  const pick = async (workspaceId) => {
    try {
      await switchWorkspace(workspaceId);
    } catch (err) {
      // 409 means archived: retry cannot fix it. Other refusals get a readable retry message.
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

  // Require reachable explicitly; a partial workspace list does not confirm current scope.
  if (!enabled || !reachable || !active) return null;

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
        title: name,
        // aria-current announces active scope; title is only a description and disabled only means
        // unavailable.
        aria: isActive ? { 'aria-current': 'true' } : undefined,
        hint: isActive ? <Check size={13} strokeWidth={2} className="text-accent" /> : undefined,
        // Disable during switching to prevent competing scope transitions.
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
      // no-drag is required because the surrounding window is a drag region.
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
