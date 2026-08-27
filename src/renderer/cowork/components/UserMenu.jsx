// `<UserMenu>` — the signed-in sidebar footer row: avatar (or initials
// placeholder), display name, and org, opening a dropdown with the account
// destinations. Parity with the web console's user menu (ENG-1408).
//
// Curated to five destinations (ENG-1545): Settings, Billing & Usage, Members,
// Help & Feedback, Logout. The console pages (Billing & Usage / Members) and the
// support page open in the OS browser — each carries an ↗ hint so the jump out
// of the app is telegraphed before the click. Settings and logout act inside the
// app. Theme + 8-bit live as quick toggles in the sidebar footer, not here.

import { useState } from 'react';
import {
  ArrowUpRight,
  Check,
  CircleHelp,
  CreditCard,
  EllipsisVertical,
  LogOut,
  Settings,
  UsersRound,
} from 'lucide-react';
import Menu from './ui/Menu';
import { ConfirmModal } from './ConfirmModal';
import { useToastManager } from './ui/Toast';
import { useLogout, LOGOUT_CONFIRM_COPY } from '../hooks/useLogout';
import { useHubWorkspaces } from '../hooks/useHubWorkspaces';
import { accountInitials } from '../lib/accountUser';
import { tileLetter, tileStyle } from '../lib/letterTile';
import { trackBillingOpened } from '../lib/analytics';
import { openExternal } from '../../platform/host';
import {
  MINDS_BILLING_URL,
  MINDS_MEMBERS_URL,
  MINDS_SUPPORT_URL,
} from '../../lib/mindsUrls';

const icon = (I) => <I size={14} strokeWidth={1.5} aria-hidden="true" />;

// Right-aligned ↗ on items that leave the app for the OS browser.
const EXTERNAL_HINT = <ArrowUpRight size={12} strokeWidth={1.5} aria-hidden="true" />;
const OPENS_IN_BROWSER = 'Opens in your browser';

// `beforeOpen` runs just before the jump out, for the one destination that is
// measured (ENG-1533). Per-item rather than inside this helper: Members and
// Help & Feedback are not billing, and stamping them with a billing event to
// save a parameter is how an event stops meaning its name.
const externalItem = (Ico, label, url, beforeOpen) => ({
  icon: icon(Ico),
  label,
  hint: EXTERNAL_HINT,
  title: OPENS_IN_BROWSER,
  onClick: () => {
    beforeOpen?.();
    openExternal(url);
  },
});

function Avatar({ user }) {
  // Falls back to initials when the account has no picture claim — and when
  // the picture URL fails to load (stale/blocked avatar hosts must not leave
  // a broken-image glyph in the footer).
  const [imgFailed, setImgFailed] = useState(false);
  if (user.picture && !imgFailed) {
    return (
      <img
        src={user.picture}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className="w-[22px] h-[22px] rounded-full shrink-0 object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="w-[22px] h-[22px] rounded-full shrink-0 inline-flex items-center justify-center text-[10px] font-bold text-accent select-none bg-[color-mix(in_srgb,var(--accent)_18%,var(--surface))] border border-solid border-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
    >
      {accountInitials(user)}
    </span>
  );
}

// The letter square on a workspace row. Colour is hashed from the id, not the
// name, so a rename keeps the tile people recognise (see lib/letterTile).
function WorkspaceTile({ id, name }) {
  return (
    <span
      aria-hidden="true"
      className="w-[18px] h-[18px] rounded-[5px] shrink-0 inline-flex items-center justify-center text-[9.5px] font-bold select-none"
      style={tileStyle(id)}
    >
      {tileLetter(name)}
    </span>
  );
}

export function UserMenu({ user, onOpenSettings }) {
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const { loggingOut, logout } = useLogout();
  const toastManager = useToastManager();
  const { enabled, workspaces, activeWorkspaceId, switching, switchWorkspace } =
    useHubWorkspaces(user);

  const displayName = user.name || user.username || user.email;

  // A group only earns its place when there is somewhere else to go. One
  // workspace means nothing to switch to, and Cowork has no create entry
  // (workspaces are created in the console), so a single row would be a menu
  // section that does nothing. This also covers the hub being unreachable: the
  // server answers `reachable: false` with no rows, and an account menu is the
  // wrong place to report an outage, so the group is simply absent.
  const showsWorkspaces = enabled && workspaces.length > 1;

  const pickWorkspace = async (workspaceId) => {
    try {
      await switchWorkspace(workspaceId);
    } catch {
      // A written sentence rather than the error's own message: a refusal
      // arrives as "API /hub/workspaces/active returned 403", which tells the
      // reader nothing and reads like a crash.
      toastManager.add({
        title: 'We could not switch workspace. Please try again.',
        type: 'danger',
      });
    }
  };

  const workspaceItems = showsWorkspaces
    ? [
        {
          id: 'workspace-group',
          heading: (
            <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-4">
              Workspace
            </div>
          ),
        },
        ...workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId;
          const name = workspace.displayName || 'Workspace';
          return {
            id: `workspace-${workspace.id}`,
            icon: <WorkspaceTile id={workspace.id} name={name} />,
            label: name,
            // Long names truncate in the row, so hover carries the full one.
            title: name,
            hint: isActive ? <Check size={13} strokeWidth={2} className="text-accent" /> : undefined,
            // The active row is not a destination, and a second click during an
            // in-flight switch would race the first.
            disabled: isActive || switching,
            onClick: isActive ? undefined : () => pickWorkspace(workspace.id),
          };
        }),
        { divider: true },
      ]
    : [];

  const items = [
    // Identity header — just the org name (accounts without an active
    // organization skip the header entirely). The email is intentionally not
    // shown here; the account row already carries the identity.
    user.org && {
      heading: (
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-ink truncate">{user.org}</div>
        </div>
      ),
    },
    // Under the org name, per the placement decided on the design pass.
    ...workspaceItems,
    { icon: icon(Settings), label: 'Settings', onClick: onOpenSettings },
    // `nav`, not a paywall trigger (ENG-1533): nothing blocked this user, they
    // went looking. It has to be recorded — it is a real route to the billing
    // page, and a capped user who dismisses the card and uses the menu instead
    // is otherwise invisible — but any upgrade-intent analysis must exclude it.
    externalItem(CreditCard, 'Billing & Usage', MINDS_BILLING_URL, () => trackBillingOpened('nav')),
    externalItem(UsersRound, 'Members', MINDS_MEMBERS_URL),
    externalItem(CircleHelp, 'Help & Feedback', MINDS_SUPPORT_URL),
    // Logout on both shells: Electron clears the refresh token + stored keys via
    // the bridge; web ends the Keycloak browser session (host.logout()). Both
    // funnel through useLogout() and the ConfirmModal below.
    { divider: true },
    { icon: icon(LogOut), label: 'Logout', danger: true, onClick: () => setLogoutConfirmOpen(true) },
  ];

  const trigger = (
    <button
      type="button"
      // Hover fill is a 6% ink mix (the .recent-item.is-selected treatment),
      // not a surface token — the light sidebar sits at ~#F4F4F4, which is
      // what --surface-2 and --stone-100 resolve to, so any absolute surface
      // fill disappears there. Mixing against --ink stays visible on any
      // background and brightens correctly in dark mode.
      className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded-lg border-0 bg-transparent cursor-pointer text-left font-[inherit] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] [-webkit-app-region:no-drag]"
    >
      {/* Keyed by the picture URL so a failed load doesn't stick to the
          initials fallback after the account picture changes. */}
      <Avatar key={user.picture || 'initials'} user={user} />
      <span className="min-w-0 flex-1 flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{displayName}</span>
        {user.org && (
          <>
            <span aria-hidden="true" className="text-ink-4">·</span>
            <span className="min-w-0 truncate text-[13px] text-ink-3">{user.org}</span>
          </>
        )}
      </span>
      <span className="inline-flex shrink-0 text-ink-3">
        <EllipsisVertical size={15} strokeWidth={1.5} aria-hidden="true" />
      </span>
    </button>
  );

  return (
    <>
      <Menu
        trigger={trigger}
        items={items}
        side="top"
        align="start"
        width={230}
        ariaLabel="Account"
      />
      <ConfirmModal
        open={logoutConfirmOpen}
        title={LOGOUT_CONFIRM_COPY.title}
        message={LOGOUT_CONFIRM_COPY.message}
        confirmLabel={LOGOUT_CONFIRM_COPY.confirmLabel}
        cancelLabel="Cancel"
        destructive
        busy={loggingOut}
        busyLabel="Signing out…"
        onConfirm={logout}
        onClose={() => setLogoutConfirmOpen(false)}
      />
    </>
  );
}

export default UserMenu;
