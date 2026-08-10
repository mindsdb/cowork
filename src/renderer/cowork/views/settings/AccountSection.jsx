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

  const CARD = {
    border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius)',
    background: 'var(--surface-glass)',
    WebkitBackdropFilter: 'blur(var(--surface-glass-blur))',
    backdropFilter: 'blur(var(--surface-glass-blur))',
    marginBottom: 14, overflow: 'hidden',
  };

  // User info card — shown on both Electron and web if we have a token
  const userCard = accountUser && (
    <div style={{ ...CARD }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '16px 18px',
      }}>
        {/* Avatar circle with initials */}
        <div style={{
          width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
          background: 'color-mix(in srgb, var(--accent) 18%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, color: 'var(--accent)',
          userSelect: 'none',
        }} aria-hidden="true">
          {accountUser.name
            ? accountUser.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
            : accountUser.email
              ? accountUser.email[0].toUpperCase()
              : '?'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {accountUser.name && (
            <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--ink)', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {accountUser.name}
            </div>
          )}
          {accountUser.email && (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: accountUser.name ? 2 : 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {accountUser.email}
            </div>
          )}
          {!accountUser.name && !accountUser.email && accountUser.username && (
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{accountUser.username}</div>
          )}
        </div>
        <a
          href={MINDS_CONSOLE_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flexShrink: 0, fontSize: 12, fontWeight: 500,
            color: 'var(--accent)', textDecoration: 'none',
            padding: '5px 10px', borderRadius: 6,
            border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
          }}
        >MindsHub ↗</a>
      </div>
      {/* Extra rows for username / org if present */}
      {(accountUser.username || accountUser.org) && (
        <div style={{
          borderTop: '1px solid var(--line)',
          padding: '10px 18px',
          display: 'flex', gap: 20,
        }}>
          {accountUser.username && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 2 }}>Username</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>{accountUser.username}</div>
            </div>
          )}
          {accountUser.org && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 2 }}>Organization</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>{accountUser.org}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const signInCard = !accountUser && onSsoSignIn && (
    <div style={{
      ...CARD,
      padding: '32px 28px 28px',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 24,
      background: 'color-mix(in srgb, var(--accent) 5%, var(--surface-glass))',
      borderColor: 'color-mix(in srgb, var(--accent) 28%, transparent)',
    }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)', lineHeight: 1.25, marginBottom: 6 }}>
          Enable cloud capabilities
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 440 }}>
          Sign in with MindsHub to access every model, cloud execution, and publishing — all in one place.
        </div>
      </div>

      {/* Feature grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', width: '100%' }}>
        {[
          { icon: '⇌', label: 'Seamless model router', desc: 'The simplest way to use all models in one place — Claude, GPT, DeepSeek, Kimi, and more.' },
          { icon: '⟁', label: 'Remote tasks', desc: 'Run code and long tasks on managed infrastructure, not your laptop.', soon: true },
          { icon: <svg width="17" height="13" viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15.5 12H5a4 4 0 0 1-.5-7.97A5 5 0 0 1 14.5 6h1a3 3 0 0 1 0 6Z" /></svg>, label: 'Share & collaborate', desc: 'Share dashboards, reports, and artifacts — and work on them together.' },
          { icon: '⊹', label: 'Unified account', desc: 'One login, one bill — no juggling API keys across providers.' },
        ].map(({ icon, label, desc, soon }) => (
          <div key={label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{
              fontSize: 16, lineHeight: 1,
              color: 'var(--accent)',
              marginTop: 2, flexShrink: 0,
              display: 'inline-flex', alignItems: 'center',
            }}>{icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-strong)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                {label}
                {soon && (
                  <span style={{
                    fontSize: 9.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                    padding: '1px 5px', borderRadius: 99,
                    background: 'rgba(127,127,127,0.1)', border: '1px solid rgba(127,127,127,0.2)',
                    color: 'var(--text-muted)',
                  }}>coming soon</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc}</div>
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
            <div style={{ padding: '32px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              <div style={{ fontWeight: 600, color: 'var(--text-strong)', fontSize: 14 }}>Managed via MindsHub</div>
              <div style={{ maxWidth: 320 }}>Account management is handled through MindsHub for the web version.</div>
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
        {accountUser && <div style={{ ...CARD, padding: '0 18px 8px' }}>
          <Section title="Sign out" subtitle="Disconnect from MindsHub and remove every stored credential on this device. Cowork will return to the onboarding flow on the next launch.">
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
