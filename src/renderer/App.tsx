import { useState, useEffect, useRef } from 'react';
import SetupScreen from './pages/arcade/SetupScreen';
import OnboardingScreen from './pages/arcade/OnboardingScreen';
import { COWORKERS } from './pages/arcade/CoworkerSelect';
import CoworkApp from './CoworkApp';
import OrbitMorph from './cowork/components/ui/OrbitMorph';
import { host } from './platform/host';
import { loadSkin, persistSkin } from './lib/skins';
import { pushSettingsToDbWithRetry } from './lib/pushSettings';
import { resolveBootTarget } from './lib/bootTarget';
import { hasBootedBefore, rememberBooted, welcomeFloorMs } from './lib/bootWelcome';
import type { SpriteName } from './pages/arcade/sprites';
import './styles.css';

// Onboarding flow:
//   loading (welcome orb) → auth (sign in / register / continue without) →
//   setup (install) → terminal. Agent + theme are not onboarding steps; the
//   look (arcade ↔ normal) is toggled via the corner controller button.
type Page = 'loading' | 'auth' | 'setup' | 'setupError' | 'terminal';

// Per-machine terms-consent flag (localStorage). ENG-1127: consent is no longer
// written to ~/.cowork/.env — this flag is the sole client record for now.
const TERMS_CONSENT_KEY = 'anton.termsConsent';
const COWORKER_KEY = 'anton.coworker';
// Minimum time the welcome orb stays up so it doesn't flash on fast boots.
// The boot veil only briefly masks the window-show moment (~140ms + ~260ms
// fade), so the animated orb is on screen almost immediately and stays for
// roughly this long before routing onward.
const WELCOME_MIN_MS = 1600;

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

function GamepadIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 11h4M8 9v4" /><path d="M15.5 12.5h.01M18 10h.01" />
      <path d="M17.32 6H6.68a4 4 0 0 0-3.98 3.6l-.66 5.86A2.75 2.75 0 0 0 6.8 17.6L8.5 15.5h7l1.7 2.1a2.75 2.75 0 0 0 4.76-2.14l-.66-5.86A4 4 0 0 0 17.32 6Z" />
    </svg>
  );
}

function SunIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>('loading');
  const [coworker] = useState(recallCoworker);
  // ENG-922/ENG-1127: the FULL chosen settings (DB-keyed values) handed up by
  // OnboardingScreen when it deferred to setup (server wasn't up for the write).
  // Consumed once by handlePostAuth after install via the bulk PUT. A ref (not
  // state) — a one-shot side effect that must survive the auth→setup→install
  // transitions without re-rendering.
  const pendingSettingsRef = useRef<Record<string, string> | null>(null);
  // Guards the setupError Retry button so a double-click can't fan out redundant
  // concurrent handshakes.
  const [retrying, setRetrying] = useState(false);
  const [skin, setSkin] = useState(loadSkin);
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

  useEffect(() => {
    async function init() {
      const started = Date.now();
      // Whether this browser has booted before is read up front: the web SPA
      // re-mounts on every refresh, and a returning session shouldn't replay the
      // artificial welcome floor (ENG-1232). welcomeFloorMs gates purely on
      // isWeb, so Electron always keeps the floor regardless of this flag (it
      // rarely re-mounts anyway — only on things like a sign-out reload).
      const bootedBefore = hasBootedBefore();
      // Boot-routing decision lives in a pure, tested unit (resolveBootTarget).
      // config_ready (health) drives readiness; consent comes only from the
      // localStorage flag (ENG-1127 — no `.env`/`/settings/raw` read).
      // hasLocalTermsConsent() is internally try/caught (returns false on any
      // localStorage error), so calling it outside resolveBootTarget's guard is
      // safe — it can't throw and escape init() (ENG-848 review note).
      const target: Page = await resolveBootTarget(host, hasLocalTermsConsent());
      // Keep the welcome orb up briefly so it doesn't flash on a genuine cold
      // start — but skip that floor on a web refresh, where it was pure latency
      // on every reload (ENG-1232).
      const floor = welcomeFloorMs({
        isWeb: host.isWeb,
        bootedBefore,
        elapsedMs: Date.now() - started,
        minMs: WELCOME_MIN_MS,
      });
      if (floor > 0) {
        await new Promise((r) => setTimeout(r, floor));
      }
      // Mark this browser "booted" on every boot, including boots that land on
      // 'auth': the login screen is a place web users sit and refresh, and
      // gating the flag on the target would replay the floor on every such
      // refresh — exactly the latency ENG-1232 removes. The only cost is
      // cosmetic: if the very first boot ever errored to 'auth' (server
      // unreachable), the next boot skips the floor, which is fine — a second
      // mount is not a genuine cold start.
      rememberBooted();
      setPage(target);
    }
    init();
  }, []);

  // Common final step for every path into the chat UI: push any settings
  // onboarding deferred (server wasn't up) via the bulk PUT, so config_ready is
  // true on first mount. Called from both the login and post-install paths so
  // the push is never skipped. ENG-1127: no `.env` read or model-replay here.
  const handlePostAuth = async () => {
    const pending = pendingSettingsRef.current;
    // Nothing owed (server already took the write during onboarding) → enter.
    if (!pending || Object.keys(pending).length === 0) {
      setPage('terminal');
      return;
    }
    // One push with retry/backoff. On failure KEEP the payload and route to the
    // retryable error screen rather than strand a fresh install (#455 review).
    const ok = await pushSettingsToDbWithRetry(pending);
    if (ok) {
      pendingSettingsRef.current = null;
      setPage('terminal');
    } else {
      setPage('setupError');
    }
  };

  // After login (SSO or BYOK): consent recorded, provider chosen. Ensure the
  // backend is installed, then run the post-auth push. `deferredValues` is set
  // only when onboarding deferred to setup (server-not-up race, ENG-922),
  // stashed for handlePostAuth. restartServer is now optional/harmless — a
  // credential written via the settings API takes effect next request.
  const handleAuthComplete = async (deferredValues?: Record<string, string>) => {
    pendingSettingsRef.current = deferredValues ?? null;
    rememberTermsConsent();
    try { await host.restartServer(); } catch {}
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
            We couldn't save your settings. Check your connection, then try again.
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

      {/* Theme + style toggles on the onboarding corner. CoworkApp hasn't
          mounted yet on these pages (no sidebar to host them), so the
          pre-app flow keeps its own floating corner toggles — namespaced
          `arcade-*` (arcade.css) so they're independent of the in-app
          sidebar footer toggle (Sidebar.jsx) that replaced the old
          shared floating-chrome buttons. The CSS stacks the style toggle
          above the theme toggle. */}
      {isArcadePage && (
        <>
          <button
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label="Toggle colour theme"
            className="arcade-theme-toggle"
            style={{ zIndex: 200 }}
          >
            {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
          </button>
          <button
            onClick={() => setSkin((s) => (s === '8bit' ? 'normal' : '8bit'))}
            title={skin === '8bit' ? 'Switch 8-bit arcade style off' : 'Switch style to 8-Bit Arcade mode'}
            aria-label="Toggle 8-bit arcade style"
            className="arcade-theme-toggle arcade-skin-toggle"
            style={{ zIndex: 200 }}
          >
            <GamepadIcon size={15} />
          </button>
        </>
      )}
    </>
  );
}
