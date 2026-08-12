import { useState, useEffect } from 'react';
import { ArrowLeftRight, Server, Cloud, Sparkle, LogIn, LogOut } from 'lucide-react';
import { Alert, Button, Tooltip } from '../../components/ui';
import { ConfirmModal } from '../../components/ConfirmModal';
import { host, getAccessToken } from '../../../platform/host';
import { resetDeviceIdentity } from '../../lib/analytics';
import { accountUserFromToken } from '../../lib/accountUser';
import { MINDS_CONSOLE_URL } from '../../../lib/mindsUrls';
import { Section, SettingsSectionPanel } from './settingsLayout';

// The Account settings section: the signed-in user card, the MindsHub sign-in
// pitch when signed out, and sign-out. Owns the account identity (decoded from
// the access token) and the sign-out flow, including its confirm modal — the
// modal only opens from this section, so it lives here rather than at the
// SettingsView root.
export default function AccountSection({ isSsoConnected = false, ssoError = '', onSsoSignIn }) {
  // Decoded from the JWT, null until loaded.
  const [accountUser, setAccountUser] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  // Re-runs when the signed-in state flips (ENG-761): previously signing in
  // while this section was already open never re-read the token — the card
  // stayed on "Sign in". The cancelled guard means a stale resolution (from a
  // slow network refresh in getAccessToken) can't overwrite a newer run.
  useEffect(() => {
    let cancelled = false;
    getAccessToken().then((token) => {
      if (!cancelled) setAccountUser(accountUserFromToken(token));
    }).catch(() => { });
    return () => { cancelled = true; };
  }, [isSsoConnected]);

  const handleLogout = async () => {
    if (loggingOut) return; // Guard against double-fire (Enter / re-click).
    setLoggingOut(true);
    let ok = true;
    try {
      await host.logout();
    } catch {
      // logout() rejected. The main handler clears the refresh token + the
      // server-DB credentials early, before anything that can throw, so the
      // user IS signed out — main just threw before it could drive its own
      // reload. Fall through and reload from here (see below).
      ok = false;
    }
    // Rotate the analytics device identity so the next account on this machine
    // starts anonymous-fresh (ENG-537) — only on a confirmed sign-out, not on
    // a rejected attempt (which would otherwise re-rotate on every retry).
    if (ok) {
      resetDeviceIdentity();
    }
    // Exactly ONE reload must happen, or two compete and leave the page stuck
    // on this confirm modal (flaky in packaged builds). On Electron SUCCESS the
    // main process drives webContents.reload() after the IPC reply, so the
    // renderer must NOT also reload. We reload here only when nothing else
    // will: on web (no main process), and on an Electron REJECTION — main threw
    // before its own reload, and since the user is already signed out a
    // renderer reload is race-free and re-routes to onboarding (the correct end
    // state) rather than a misleading "sign-out didn't complete". (ENG-1206)
    if (host.isWeb || !ok) {
      window.location.reload();
    }
  };

  // Base card shell without colors — border-color/background differ per card
  // (Tailwind can't reliably "override" a same-property utility later in the
  // class string, so each card states its own colors exactly once).
  const CARD_BASE =
    'border border-solid rounded-card backdrop-blur-[var(--surface-glass-blur)] mb-[14px] overflow-hidden';
  const CARD = `${CARD_BASE} border-line bg-[var(--surface-glass)]`;

  // User info card — shown on both Electron and web if we have a token
  const userCard = accountUser && (
    <div className={CARD}>
      <div className="flex items-center gap-[14px] py-4 px-[18px]">
        {/* Avatar circle with initials */}
        <div
          className="w-[44px] h-[44px] rounded-full shrink-0 bg-[color-mix(in_srgb,var(--accent)_18%,var(--surface))] border border-solid border-[color-mix(in_srgb,var(--accent)_35%,transparent)] inline-flex items-center justify-center text-[16px] font-bold text-accent select-none"
          aria-hidden="true">
          {accountUser.name
            ? accountUser.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
            : accountUser.email
              ? accountUser.email[0].toUpperCase()
              : '?'}
        </div>
        <div className="flex-1 min-w-0">
          {accountUser.name && (
            <div className="text-md font-[650] text-ink leading-[1.25] overflow-hidden text-ellipsis whitespace-nowrap">
              {accountUser.name}
            </div>
          )}
          {accountUser.email && (
            <div className={`text-[13px] text-ink-3 overflow-hidden text-ellipsis whitespace-nowrap ${accountUser.name ? 'mt-0.5' : 'mt-0'}`}>
              {accountUser.email}
            </div>
          )}
          {!accountUser.name && !accountUser.email && accountUser.username && (
            <div className="text-base font-semibold text-ink">{accountUser.username}</div>
          )}
        </div>
        <a
          href={MINDS_CONSOLE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-[12px] font-medium text-accent no-underline py-[5px] px-2.5 rounded-md border border-solid border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
        >MindsHub ↗</a>
      </div>
      {/* Extra rows for username / org if present */}
      {(accountUser.username || accountUser.org) && (
        <div className="border-t border-x-0 border-b-0 border-solid border-line py-2.5 px-[18px] flex gap-5">
          {accountUser.username && (
            <div>
              <div className="text-[10px] font-semibold tracking-[0.07em] uppercase text-ink-4 mb-0.5">Username</div>
              <div className="text-[13px] text-ink-2 font-[family-name:var(--font-mono)]">{accountUser.username}</div>
            </div>
          )}
          {accountUser.org && (
            <div>
              <div className="text-[10px] font-semibold tracking-[0.07em] uppercase text-ink-4 mb-0.5">Organization</div>
              <div className="text-[13px] text-ink-2">{accountUser.org}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const signInCard = !accountUser && onSsoSignIn && (
    <div className={`${CARD_BASE} pt-8 px-7 pb-7 flex flex-col items-start gap-6 bg-[color-mix(in_srgb,var(--accent)_5%,var(--surface-glass))] border-[color-mix(in_srgb,var(--accent)_28%,transparent)]`}>
      {/* Header */}
      <div>
        <div className="text-[18px] font-bold text-ink leading-[1.25] mb-1.5">
          Enable cloud capabilities
        </div>
        <div className="text-[13.5px] text-ink-3 leading-[1.6] max-w-[440px]">
          Sign in with MindsHub to access every model, cloud execution, and publishing — all in one place.
        </div>
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-2 gap-y-2.5 gap-x-5 w-full">
        {[
          { icon: <ArrowLeftRight size={15} strokeWidth={1.5} aria-hidden="true" />, label: 'Seamless model router', desc: 'The simplest way to use all models in one place — Claude, GPT, DeepSeek, Kimi, and more.' },
          { icon: <Server size={15} strokeWidth={1.5} aria-hidden="true" />, label: 'Remote tasks', desc: 'Run code and long tasks on managed infrastructure, not your laptop.', soon: true },
          { icon: <Cloud size={16} strokeWidth={1.5} aria-hidden="true" />, label: 'Share & collaborate', desc: 'Share dashboards, reports, and artifacts — and work on them together.' },
          { icon: <Sparkle size={15} strokeWidth={1.5} aria-hidden="true" />, label: 'Unified account', desc: 'One login, one bill — no juggling API keys across providers.' },
        ].map(({ icon, label, desc, soon }) => (
          <div key={label} className="flex gap-2.5 items-start">
            <span className="text-[16px] leading-none text-accent mt-0.5 shrink-0 inline-flex items-center">{icon}</span>
            <div>
              <div className="text-[13px] font-[650] text-ink mb-0.5 flex items-center gap-1.5">
                {label}
                {soon && (
                  <span className="text-[9.5px] font-semibold tracking-[0.05em] uppercase py-px px-[5px] rounded-[99px] bg-[rgba(127,127,127,0.1)] border border-solid border-[rgba(127,127,127,0.2)] text-ink-3">coming soon</span>
                )}
              </div>
              <div className="text-[12px] text-ink-3 leading-[1.5]">{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Last sign-in failure (ENG-761) — without this, a failed
          browser flow left the card looking untouched and the user
          with no idea anything went wrong. */}
      {ssoError && (
        <Alert variant="danger" className="w-full">
          Sign-in didn't complete: {ssoError}
        </Alert>
      )}

      {/* CTA */}
      <Button variant="primary" onClick={onSsoSignIn}>
        <LogIn size={14} strokeWidth={1.5} aria-hidden="true" />
        Sign in / Sign up to MindsHub
      </Button>
    </div>
  );

  const logoutConfirm = (
    <ConfirmModal
      open={logoutConfirmOpen}
      title="Sign out of Cowork?"
      message="This clears your stored API keys and disconnects from MindsHub. You'll need to sign in again to keep using Cowork."
      confirmLabel="Sign out"
      cancelLabel="Cancel"
      destructive
      busy={loggingOut}
      busyLabel="Signing out…"
      onConfirm={handleLogout}
      onClose={() => setLogoutConfirmOpen(false)}
    />
  );

  if (!host.isElectron) {
    return (
      <>
        <SettingsSectionPanel>
          {userCard || (
            <div className="py-8 px-0 flex flex-col items-center justify-center gap-2.5 text-center text-ink-3 text-[13px]">
              <div className="font-semibold text-ink text-base">Managed via MindsHub</div>
              <div className="max-w-[320px]">Account management is handled through MindsHub for the web version.</div>
            </div>
          )}
        </SettingsSectionPanel>
        {logoutConfirm}
      </>
    );
  }

  return (
    <>
      <SettingsSectionPanel>
        {signInCard}
        {userCard}
        {accountUser && <div className={`${CARD} pt-0 px-[18px] pb-2`}>
          <Section title="Sign out" subtitle="Disconnect from MindsHub and remove every stored credential on this device. Cowork will return to the onboarding flow on the next launch.">
            <div className="flex justify-end">
              <Tooltip content="Sign out and clear stored credentials">
                <Button variant="danger" onClick={() => setLogoutConfirmOpen(true)} disabled={loggingOut}>
                  <LogOut size={13} strokeWidth={1.5} aria-hidden="true" />
                  {loggingOut ? 'Signing out…' : 'Sign out'}
                </Button>
              </Tooltip>
            </div>
          </Section>
        </div>}
      </SettingsSectionPanel>
      {logoutConfirm}
    </>
  );
}
