import { useState, useEffect, useRef } from 'react';
import { Sun, Moon } from 'lucide-react';
import SetupScreen from './pages/arcade/SetupScreen';
import OnboardingScreen from './pages/arcade/OnboardingScreen';
import { COWORKERS } from './pages/arcade/CoworkerSelect';
import CoworkApp from './CoworkApp';
import OrbitMorph from './cowork/components/ui/OrbitMorph';
import { Tooltip } from './cowork/components/ui/Tooltip';
import { host } from './platform/host';
import { loadSkin, persistSkin } from './lib/skins';
import { syncSettingsToDb, syncModelsToDbWithRetry } from './lib/syncSettings';
import { resolveBootTarget, resolveRegistrationConsent } from './lib/bootTarget';
import { setOrgMode } from './lib/orgMode';
import { trackBootScreenResolved } from './cowork/lib/analytics';
import { hasBootedBefore, rememberBooted, welcomeFloorMs } from './lib/bootWelcome';
import { runPostAuthHandshake } from './lib/postAuth';
import { deriveBootStatus } from '../shared/boot-status';
import type { SpriteName } from './pages/arcade/sprites';
import './styles.css';

// Boot routes through loading, authentication and installation before mounting the workspace.
type Page = 'loading' | 'auth' | 'setup' | 'setupError' | 'terminal';

// Per-browser terms-consent flag (web). Desktop also records consent in
// ~/.anton/.env (ANTON_TERMS_CONSENT), written when auth completes.
const TERMS_CONSENT_KEY = 'anton.termsConsent';
const COWORKER_KEY = 'anton.coworker';
// Keep fast cold boots from flashing the welcome orb.
const WELCOME_MIN_MS = 1600;

function hasCodeFixture(): boolean {
  return import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('codeFixture');
}

function hasLocalTermsConsent(): boolean {
  try {
    return typeof window !== 'undefined'
      && window.localStorage.getItem(TERMS_CONSENT_KEY) === 'true';
  } catch {
    return false;
  }
}

function rememberTermsConsent(): void {
  try { window.localStorage.setItem(TERMS_CONSENT_KEY, 'true'); } catch {}
}

// Agent defaults to Anton (no picker in onboarding). A previously-selected
// coworker in localStorage is still honored if present.
function recallCoworker(): { id: string; label: string; sprite: SpriteName } {
  let id = 'anton';
  try { id = window.localStorage.getItem(COWORKER_KEY) || 'anton'; } catch {}
  const cw = COWORKERS.find((c) => c.id === id && !c.locked);
  return cw
    ? { id: cw.id, label: cw.name, sprite: cw.sprite }
    : { id: 'anton', label: 'ANTON', sprite: 'anton' };
}

// Map skin + theme → the onboarding shell's look. arcade.css reads
// body[data-arcade-preset]: 'midnight'/'daylight' = clean (Inter, no CRT),
// 'gameboy' = 8-bit light, default (no preset) = 8-bit dark CRT.
function applyArcadePreset(skin: string): void {
  const theme = document.body.dataset.theme === 'light' ? 'light' : 'dark';
  const preset = skin === '8bit'
    ? (theme === 'light' ? 'gameboy' : null)         // null → default arcade dark
    : (theme === 'light' ? 'daylight' : 'midnight'); // clean / "normal"
  if (preset) document.body.dataset.arcadePreset = preset;
  else delete document.body.dataset.arcadePreset;
}

function SunIcon({ size = 15 }: { size?: number }) {
  return <Sun size={size} strokeWidth={1.5} aria-hidden="true" />;
}

function MoonIcon({ size = 15 }: { size?: number }) {
  return <Moon size={size} strokeWidth={1.5} aria-hidden="true" />;
}

export default function App() {
  // Development-only fixtures bypass onboarding so visual QA states are deterministic on a clean
  // profile.
  const [page, setPage] = useState<Page>(() => hasCodeFixture() ? 'terminal' : 'loading');
  const [coworker] = useState(recallCoworker);
  // Retain deferred onboarding model writes across setup/install transitions; handlePostAuth
  // replays them once the server is ready.
  const deferredModelRef = useRef<string[] | null>(null);
  // Guards the setupError Retry button so a double-click can't fan out redundant
  // concurrent handshakes.
  const [retrying, setRetrying] = useState(false);
  // Include all update channels so the boot overlay cannot imply completion while a shell restart
  // is pending.
  const [otaPhase, setOtaPhase] = useState<string | null>(null);
  const [shellPhase, setShellPhase] = useState<string | null>(null);
  const [manualShellPending, setManualShellPending] = useState(false);
  const bootStatus = deriveBootStatus({
    ota: { phase: otaPhase },
    shell: { phase: shellPhase },
    manualShellPending,
  });
  // Onboarding reads the saved skin but offers only a light/dark toggle.
  const [skin] = useState(loadSkin);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = window.localStorage.getItem('anton.theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return document.body.dataset.theme === 'light' ? 'light' : 'dark';
  });

  // Keep body skin + onboarding shell preset + persistence in sync.
  useEffect(() => {
    document.body.dataset.skin = skin;
    persistSkin(skin);
    applyArcadePreset(skin);
  }, [skin]);

  // Apply + persist the light/dark theme (mirrors CoworkApp), then refresh
  // the arcade preset since the preset depends on the active theme.
  useEffect(() => {
    try { window.localStorage.setItem('anton.theme', theme); } catch {}
    document.body.classList.remove('gf-theme-dark', 'gf-theme-light');
    document.body.classList.add(theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
    document.body.dataset.theme = theme;
    const gf = (window as unknown as { gravityField?: { setTheme?: (t: string) => void } }).gravityField;
    if (gf && typeof gf.setTheme === 'function') gf.setTheme(theme);
    applyArcadePreset(skin);
  }, [theme, skin]);

  // Track OTA for the lifetime of the boot gate; shell-available is a separate pending manual
  // reinstall.
  useEffect(() => {
    return host.onUpdateStatus((status) => {
      if (status?.phase === 'shell-available') { setManualShellPending(true); return; }
      setOtaPhase(status?.phase ?? null);
    });
  }, []);

  // Pull shell state for reload recovery and subscribe to live progress. These host calls are
  // no-ops on web.
  useEffect(() => {
    let cancelled = false;
    host.getShellAutoUpdate()
      .then((snapshot) => { if (!cancelled) setShellPhase(snapshot?.phase ?? null); })
      .catch(() => {});
    const unsubscribe = host.onShellAutoUpdate((snapshot) => {
      if (!cancelled) setShellPhase(snapshot?.phase ?? null);
    });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  // Recover missed manual notices after reload and on old shells. A null pull must not clear a
  // notice already pushed.
  useEffect(() => {
    let cancelled = false;
    host.getShellUpdate()
      .then((update) => { if (!cancelled && update) setManualShellPending(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (hasCodeFixture()) return;
    async function init() {
      const started = Date.now();
      // Returning web visits skip the artificial welcome delay; Electron always keeps it.
      const bootedBefore = hasBootedBefore();
      // Hosted web cannot read raw settings; registration consent avoids repeating consent on each
      // browser. Resolve the web-only module here, outside the pure boot decision.
      const decision = await resolveBootTarget(
        host,
        hasLocalTermsConsent(),
        await resolveRegistrationConsent(host.isWeb, () => import('./lib/keycloak')),
      );
      const target: Page = decision.target;
      // Unknown web tenancy fails closed to org mode, keeping desktop-only artifact actions hidden.
      setOrgMode(decision.orgMode ?? host.isWeb);
      // Record the first screen before sign-in, including installs that never reach a healthy
      // server.
      void trackBootScreenResolved(target);
      // Skip the welcome floor on returning web visits.
      const floor = welcomeFloorMs({
        isWeb: host.isWeb,
        bootedBefore,
        elapsedMs: Date.now() - started,
        minMs: WELCOME_MIN_MS,
      });
      if (floor > 0) {
        await new Promise((r) => setTimeout(r, floor));
      }
      // Count auth-screen boots too so refreshing the login page does not replay the delay.
      rememberBooted();
      setPage(target);
    }
    init();
  }, []);

  // Run the settings/model handshake on both existing-install and post-install login paths.
  const handlePostAuth = async () => {
    // Keep failed model replay retryable; bulk settings sync cannot recover an omitted model write.
    const res = await runPostAuthHandshake({
      readSettings: () => host.readSettings(),
      syncSettingsToDb,
      replayModels: (lines) => syncModelsToDbWithRetry(lines),
      deferredModelLines: deferredModelRef.current,
    });
    if (res.clearDeferred) deferredModelRef.current = null;
    setPage(res.next);
  };

  // Keep deferred model lines until installation and the post-auth handshake finish.
  const handleAuthComplete = async (deferredModelLines?: string[]) => {
    deferredModelRef.current = deferredModelLines ?? null;
    rememberTermsConsent();
    /*
     * Keep the sidecar running: onboarding already wrote its authoritative DB settings. Restarting
     * adds a cold boot and credential handoff without changing the configuration.
     */
    try {
      const status = await host.checkInstall();
      if (!status.antonInstalled || !status.serverDepsReady) {
        setPage('setup');
        return;
      }
    } catch {
      setPage('setup');
      return;
    }
    await handlePostAuth();
  };

  // After install: server is up — run the same credential handshake.
  const handleInstallComplete = async () => {
    await handlePostAuth();
  };

  const isMac = host.isMac();
  const isArcadePage = page !== 'terminal';

  return (
    <>
      {/* Drag overlay for the chromeless arcade pages (auth/setup). */}
      {isMac && isArcadePage && <div className="titlebar-drag" />}

      {page === 'loading' && (
        <div
          className="arc-root welcome-loading"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20 }}
        >
          <OrbitMorph state="thinking" size={72} />
          <div className="arc-welcome-title">
            Welcome to MindsHub Cowork
          </div>
          {bootStatus && (
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--arc-muted)' }}>
              {bootStatus}
            </div>
          )}
        </div>
      )}

      {page === 'auth' && (
        <OnboardingScreen coworker={coworker} onComplete={handleAuthComplete} />
      )}

      {page === 'setup' && <SetupScreen onComplete={handleInstallComplete} />}

      {page === 'setupError' && (
        <div
          className="arc-root welcome-loading"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 18, padding: 24, textAlign: 'center' }}
        >
          <OrbitMorph state="thinking" size={72} />
          <div className="arc-welcome-title">Couldn't finish setup</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--arc-muted)', maxWidth: 380 }}>
            Your provider is saved, but we couldn't apply your model. Check your connection, then try again.
          </div>
          <button
            className="arc-btn"
            disabled={retrying}
            onClick={async () => { setRetrying(true); try { await handlePostAuth(); } finally { setRetrying(false); } }}
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {page === 'terminal' && <CoworkApp />}

      {/*
 * Onboarding owns its theme toggle before CoworkApp mounts. It honors the saved skin but only
 * switches light/dark.
 */}
      {isArcadePage && (
        <Tooltip content={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          <button
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label="Toggle colour theme"
            className="arcade-theme-toggle"
            style={{ zIndex: 200 }}
          >
            {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
          </button>
        </Tooltip>
      )}
    </>
  );
}
