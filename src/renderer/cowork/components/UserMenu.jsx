/**
 * Organizations determine the tenant and payer; workspaces select resource scope within that
 * organization.
 * Switching tenants refreshes the session (desktop) or Keycloak and the renderer (web).
 */

import { useRef, useState } from 'react';
import {
  ArrowUpRight,
  Building2,
  Check,
  CircleHelp,
  CreditCard,
  EllipsisVertical,
  LogOut,
  Settings,
  UsersRound,
} from 'lucide-react';
import Menu from './ui/Menu';
import { useToastManager } from './ui/Toast';
import { ConfirmModal } from './ConfirmModal';
import { useLogout, LOGOUT_CONFIRM_COPY } from '../hooks/useLogout';
import { useMindsOrgs } from '../hooks/useMindsOrgs';
import { organizationLabel } from '../../../shared/minds-orgs';
import { accountInitials } from '../lib/accountUser';
import { trackBillingOpened } from '../lib/analytics';
import { openExternal } from '../../platform/host';
import {
  MINDS_BILLING_URL,
  MINDS_GENERAL_URL,
  MINDS_MEMBERS_URL,
  MINDS_SUPPORT_URL,
} from '../../lib/mindsUrls';

const icon = (I) => <I size={14} strokeWidth={1.5} aria-hidden="true" />;

const EXTERNAL_HINT = <ArrowUpRight size={12} strokeWidth={1.5} aria-hidden="true" />;
const OPENS_IN_BROWSER = 'Opens in your browser';

// Keep beforeOpen per destination so non-billing links cannot emit billing events.
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
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef(null);
  const { loggingOut, waitNote, logout } = useLogout();
  const { orgs, activeOrg, switching, switchOrg } = useMindsOrgs(user);
  const toastManager = useToastManager();

  const displayName = user.name || user.username || user.email;
  // Prefer the listing's display label over the raw personal_<userId> claim.
  // Normalize both paths with organizationLabel so Personal does not change after loading.
  const activeOrgName = organizationLabel(activeOrg) || user.org || null;
  const identity = user.email || user.username || user.name || null;

  const pick = async (organizationId) => {
    const result = await switchOrg(organizationId);
    /** Do not show an error in the old tenant when a possibly committed web switch is reloading. */
    if (result?.ok || result?.reloadRequired) return;
    toastManager.add({
      title: result?.error || 'We could not change organization. Please try again.',
      type: 'danger',
    });
  };

  const sectionHeading = (text) => (
    <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-4">{text}</div>
  );

  const activeRowHint = <Check size={13} strokeWidth={2} className="text-accent" />;

  /**
   * Show even a single organization to identify the tenant; disable rows while switching to prevent
   * races.
   */
  const listedOrgRows = orgs.map((org) => {
    const isActive = org.id === activeOrg?.id;
    const label = organizationLabel(org);
    return {
      id: `organization-${org.id}`,
      label,
      title: label,
      hint: isActive ? activeRowHint : undefined,
      disabled: isActive || switching,
      onClick: isActive ? undefined : () => pick(org.id),
    };
  });

  /**
   * Fall back to the token label when the async listing fails or an older main process lacks these
   * channels.
   */
  const claimOnlyOrgRow = activeOrgName ? [{
    id: 'organization-active',
    label: activeOrgName,
    title: activeOrgName,
    hint: activeRowHint,
    disabled: true,
  }] : [];

  const organizationRows = listedOrgRows.length ? listedOrgRows : claimOnlyOrgRow;
  const orgRows = organizationRows.length ? [
    { id: 'organization-group', heading: sectionHeading('Organization') },
    ...organizationRows,
    { divider: true },
  ] : [];

  const items = [
    identity && {
      id: 'identity',
      heading: (
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-ink truncate" title={identity}>
            {identity}
          </div>
        </div>
      ),
    },
    identity && { divider: true },
    ...orgRows,
    { id: 'account-group', heading: sectionHeading('Account') },
    { icon: icon(Settings), label: 'Settings', onClick: onOpenSettings },
    // Record voluntary billing navigation as nav so upgrade-intent analysis can exclude it.
    externalItem(CreditCard, 'Billing & Usage', MINDS_BILLING_URL, () => trackBillingOpened('nav')),
    externalItem(UsersRound, 'Members', MINDS_MEMBERS_URL),
    externalItem(CircleHelp, 'Help & Feedback', MINDS_SUPPORT_URL),
    ...(activeOrgName ? [externalItem(Building2, 'Manage organization', MINDS_GENERAL_URL)] : []),
    { divider: true },
    { icon: icon(LogOut), label: 'Logout', danger: true, onClick: () => setLogoutConfirmOpen(true) },
  ];

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={() => setMenuOpen((current) => !current)}
      // Mix against ink: absolute surface tokens can equal the sidebar background and hide hover
      // state.
      className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded-lg border-0 bg-transparent cursor-pointer text-left font-[inherit] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] [-webkit-app-region:no-drag]"
    >
      {/* Reset failed-image state when the picture URL changes. */}
      <Avatar key={user.picture || 'initials'} user={user} />
      <span className="min-w-0 flex-1 flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{displayName}</span>
        {activeOrgName && (
          <>
            <span aria-hidden="true" className="text-ink-4">·</span>
            <span className="min-w-0 truncate text-[13px] text-ink-3">{activeOrgName}</span>
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
      {trigger}
      <Menu
        open={menuOpen}
        anchor={triggerRef.current}
        onClose={() => setMenuOpen(false)}
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
        dismissableWhileBusy
        note={waitNote}
        busyLabel="Signing out…"
        onConfirm={logout}
        onClose={() => setLogoutConfirmOpen(false)}
      />
    </>
  );
}

export default UserMenu;
