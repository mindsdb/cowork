import { useState, useEffect } from 'react';
import { Alert, Button } from '../../components/ui';
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

  // Shared card chrome. Static, so it lives as a className string; sections
  // that override background/border do it inline (a dynamic color-mix) and win
  // over the class by specificity.
  const CARD = 'overflow-hidden rounded-card border border-line bg-surface-glass [backdrop-filter:blur(var(--surface-glass-blur))] [-webkit-backdrop-filter:blur(var(--surface-glass-blur))] mb-[14px]';

  // User info card — shown on both Electron and web if we have a token
  const userCard = accountUser && (
    <div className={CARD}>
      <div className="flex items-center gap-[14px] px-[18px] py-4">
        {/* Avatar circle with initials */}
        <div className="w-[44px] h-[44px] rounded-full shrink-0 inline-flex items-center justify-center text-[16px] font-bold text-accent select-none" style={{
          background: 'color-mix(in srgb, var(--accent) 18%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
        }} aria-hidden="true">
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
            <div className="text-[13px] text-ink-3 overflow-hidden text-ellipsis whitespace-nowrap" style={{ marginTop: accountUser.name ? 2 : 0 }}>
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
          className="shrink-0 text-[12px] font-medium text-accent no-underline px-[10px] py-[5px] rounded-[6px]"
          style={{
            border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
          }}
        >MindsHub ↗</a>
      </div>
      {/* Extra rows for username / org if present */}
      {(accountUser.username || accountUser.org) && (
        <div className="border-t border-line px-[18px] py-[10px] flex gap-5">
          {accountUser.username && (
            <div>
              <div className="text-2xs font-semibold tracking-[0.07em] uppercase text-ink-4 mb-[2px]">Username</div>
              <div className="text-[13px] text-ink-2 font-mono">{accountUser.username}</div>
            </div>
          )}
          {accountUser.org && (
            <div>
              <div className="text-2xs font-semibold tracking-[0.07em] uppercase text-ink-4 mb-[2px]">Organization</div>
              <div className="text-[13px] text-ink-2">{accountUser.org}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const signInCard = !accountUser && onSsoSignIn && (
    <div className={`${CARD} pt-8 px-[28px] pb-[28px] flex flex-col items-start gap-6`} style={{
      background: 'color-mix(in srgb, var(--accent) 5%, var(--surface-glass))',
      borderColor: 'color-mix(in srgb, var(--accent) 28%, transparent)',
    }}>
      {/* Header */}
      <div>
        <div className="text-[18px] font-bold text-strong leading-[1.25] mb-[6px]">
          Enable cloud capabilities
        </div>
        <div className="text-[13.5px] text-muted leading-[1.6] max-w-[440px]">
          Sign in with MindsHub to access every model, cloud execution, and publishing — all in one place.
        </div>
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-[1fr_1fr] gap-y-[10px] gap-x-5 w-full">
        {[
          { icon: '⇌', label: 'Seamless model router', desc: 'The simplest way to use all models in one place — Claude, GPT, DeepSeek, Kimi, and more.' },
          { icon: '⟁', label: 'Remote tasks', desc: 'Run code and long tasks on managed infrastructure, not your laptop.', soon: true },
          { icon: <svg width="17" height="13" viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15.5 12H5a4 4 0 0 1-.5-7.97A5 5 0 0 1 14.5 6h1a3 3 0 0 1 0 6Z" /></svg>, label: 'Share & collaborate', desc: 'Share dashboards, reports, and artifacts — and work on them together.' },
          { icon: '⊹', label: 'Unified account', desc: 'One login, one bill — no juggling API keys across providers.' },
        ].map(({ icon, label, desc, soon }) => (
          <div key={label} className="flex gap-[10px] items-start">
            <span className="text-[16px] leading-none text-accent mt-[2px] shrink-0 inline-flex items-center">{icon}</span>
            <div>
              <div className="text-[13px] font-[650] text-strong mb-[2px] flex items-center gap-[6px]">
                {label}
                {soon && (
                  <span className="text-[9.5px] font-semibold tracking-[0.05em] uppercase px-[5px] py-[1px] rounded-[99px] bg-[rgba(127,127,127,0.1)] border border-[rgba(127,127,127,0.2)] text-muted">coming soon</span>
                )}
              </div>
              <div className="text-[12px] text-muted leading-[1.5]">{desc}</div>
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
          <polyline points="10 17 15 12 10 7" />
          <line x1="15" y1="12" x2="3" y2="12" />
        </svg>
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
            <div className="py-8 flex flex-col items-center justify-center gap-[10px] text-center text-muted text-[13px]">
              <div className="font-semibold text-strong text-base">Managed via MindsHub</div>
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
        {accountUser && <div className={`${CARD} px-[18px] pb-2`}>
          <Section title="Sign out" subtitle="Disconnect from MindsHub and remove every stored credential on this device. Cowork will return to the onboarding flow on the next launch.">
            <div className="flex justify-end">
              <Button variant="danger" onClick={() => setLogoutConfirmOpen(true)} disabled={loggingOut} title="Sign out and clear stored credentials">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                {loggingOut ? 'Signing out…' : 'Sign out'}
              </Button>
            </div>
          </Section>
        </div>}
      </SettingsSectionPanel>
      {logoutConfirm}
    </>
  );
}
