// `<UserMenu>` — the signed-in sidebar footer row: avatar (or initials
// placeholder), display name, and org, opening a dropdown with the account
// destinations. Parity with the web console's user menu (ENG-1408).
//
// Curated to five destinations (ENG-1545): Settings, Billing & Usage, Members,
// Help & Feedback, Logout. The console pages (Billing & Usage / Members) and the
// support page open in the OS browser — each carries an ↗ hint so the jump out
// of the app is telegraphed before the click. Settings and logout act inside the
// app. Theme + 8-bit live as quick toggles in the sidebar footer, not here.
//
// **The organization picker lives here rather than in the rail**, which is the
// opposite of where the workspace selector ended up, and the two decisions are
// the same decision. An organization is who is paying; a workspace is a
// container inside it. The account menu is about identity, so the organization
// belongs in it and the workspace does not, which is why the workspace picker
// moved out to its own control above the New task CTA. The console puts its
// organization selector in exactly this menu too.
//
// Switching costs more than a label: the API key the sidecar presents belongs
// to one organization, so main re-mints and hands over a new one. That is why
// the rows disable while a switch is in flight and why a refusal gets a
// sentence rather than a silently dead row.

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

export function UserMenu({ user, onOpenSettings }) {
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef(null);
  const { loggingOut, logout } = useLogout();
  const { orgs, activeOrg, switching, switchOrg } = useMindsOrgs(user);
  const toastManager = useToastManager();

  const displayName = user.name || user.username || user.email;
  // The listing wins over the token claim, because the claim carries no display
  // name: a personal organization's claim name is the raw `personal_<userId>`,
  // while Keycloak holds the label auth generated for it. `user.org` is the
  // fallback for the moments the listing has not arrived, and it is already
  // null rather than the raw slug.
  const activeOrgName = activeOrg?.displayName || user.org || null;

  const pick = async (organizationId) => {
    const result = await switchOrg(organizationId);
    if (result?.ok) return;
    // A written sentence, not the error's own text. Main answers a refusal
    // with something a person can act on and every branch of it already ends
    // in "Nothing changed", which is the part that matters here.
    toastManager.add({
      title: result?.error || 'We could not change organization. Please try again.',
      type: 'danger',
    });
  };

  const orgRows = orgs.length > 1 ? [
    {
      id: 'organization-group',
      heading: (
        <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-4">
          Organization
        </div>
      ),
    },
    ...orgs.map((org) => {
      const isActive = org.id === activeOrg?.id;
      return {
        id: `organization-${org.id}`,
        label: org.displayName,
        // Long names truncate in the row, so hover carries the whole one.
        title: org.displayName,
        // The trigger already names the active organization, and the console
        // marks it in the list too. Without the check the only signal is the
        // row being disabled, which reads as "unavailable" rather than "you
        // are here".
        hint: isActive ? <Check size={13} strokeWidth={2} className="text-accent" /> : undefined,
        // The active row is not a destination, and a second click during an
        // in-flight switch would race the first through the mint.
        disabled: isActive || switching,
        onClick: isActive ? undefined : () => pick(org.id),
      };
    }),
    { divider: true },
  ] : [];

  const items = [
    // Identity header — just the org name (accounts without an active
    // organization skip the header entirely). The email is intentionally not
    // shown here; the account row already carries the identity.
    activeOrgName && {
      heading: (
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-ink truncate">{activeOrgName}</div>
        </div>
      ),
    },
    // Only when there is somewhere to switch to. One organization is not a
    // choice, and the header above already names it.
    ...orgRows,
    { icon: icon(Settings), label: 'Settings', onClick: onOpenSettings },
    // `nav`, not a paywall trigger (ENG-1533): nothing blocked this user, they
    // went looking. It has to be recorded — it is a real route to the billing
    // page, and a capped user who dismisses the card and uses the menu instead
    // is otherwise invisible — but any upgrade-intent analysis must exclude it.
    externalItem(CreditCard, 'Billing & Usage', MINDS_BILLING_URL, () => trackBillingOpened('nav')),
    externalItem(UsersRound, 'Members', MINDS_MEMBERS_URL),
    externalItem(CircleHelp, 'Help & Feedback', MINDS_SUPPORT_URL),
    // Creating or leaving an organization is a full console flow, so the menu
    // deep-links out rather than growing a second one that would open a
    // browser anyway. Shown whenever there is an organization to manage.
    ...(activeOrgName ? [externalItem(Building2, 'Manage organization', MINDS_GENERAL_URL)] : []),
    // Logout on both shells: Electron clears the refresh token + stored keys via
    // the bridge; web ends the Keycloak browser session (host.logout()). Both
    // funnel through useLogout() and the ConfirmModal below.
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
        busyLabel="Signing out…"
        onConfirm={logout}
        onClose={() => setLogoutConfirmOpen(false)}
      />
    </>
  );
}

export default UserMenu;
