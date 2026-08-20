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
  CircleHelp,
  CreditCard,
  EllipsisVertical,
  LogOut,
  Settings,
  UsersRound,
} from 'lucide-react';
import Menu from './ui/Menu';
import { ConfirmModal } from './ConfirmModal';
import { useLogout, LOGOUT_CONFIRM_COPY } from '../hooks/useLogout';
import { accountInitials } from '../lib/accountUser';
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

const externalItem = (Ico, label, url) => ({
  icon: icon(Ico),
  label,
  hint: EXTERNAL_HINT,
  title: OPENS_IN_BROWSER,
  onClick: () => openExternal(url),
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

export function UserMenu({ user, onOpenSettings }) {
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const { loggingOut, logout } = useLogout();

  const displayName = user.name || user.username || user.email;

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
    { icon: icon(Settings), label: 'Settings', onClick: onOpenSettings },
    externalItem(CreditCard, 'Billing & Usage', MINDS_BILLING_URL),
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
