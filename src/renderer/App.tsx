import { useState, useEffect, useRef } from 'react';
import { Gamepad2, Sun, Moon } from 'lucide-react';
import SetupScreen from './pages/arcade/SetupScreen';
import OnboardingScreen from './pages/arcade/OnboardingScreen';
import { COWORKERS } from './pages/arcade/CoworkerSelect';
import CoworkApp from './CoworkApp';
import OrbitMorph from './cowork/components/ui/OrbitMorph';
import { Tooltip } from './cowork/components/ui/Tooltip';
import { host } from './platform/host';
import { loadSkin, persistSkin } from './lib/skins';
import { syncSettingsToDb, syncModelsToDbWithRetry } from './lib/syncSettings';
import { resolveBootTarget } from './lib/bootTarget';
import { trackBootScreenResolved } from './cowork/lib/analytics';
import { hasBootedBefore, rememberBooted, welcomeFloorMs } from './lib/bootWelcome';
import { runPostAuthHandshake } from './lib/postAuth';
import type { SpriteName } from './pages/arcade/sprites';
import './styles.css';

// Onboarding flow:
//   loading (welcome orb) → auth (sign in / register / continue without) →
//   setup (install) → terminal. Agent + theme are not onboarding steps; the
//   look (arcade ↔ normal) is toggled via the corner controller button.
type Page = 'loading' | 'auth' | 'setup' | 'setupError' | 'terminal';

// Per-browser terms-consent flag (web). Desktop also records consent in
// ~/.anton/.env (ANTON_TERMS_CONSENT), written when auth completes.
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
  return <Gamepad2 size={size} strokeWidth={1.5} aria-hidden="true" />;
}

function SunIcon({ size = 15 }: { size?: number }) {
  return <Sun size={size} strokeWidth={1.5} aria-hidden="true" />;
}

function MoonIcon({ size = 15 }: { size?: number }) {
  return <Moon size={size} strokeWidth={1.5} aria-hidden="true" />;
}

export default function App() {
  const [page, setPage] = useState<Page>('loading');
  const [coworker] = useState(recallCoworker);
  // ENG-922: model lines handed up by OnboardingScreen when it deferred to the
  // setup/install screen (server wasn't up to take the DB write). Consumed once
  // by handlePostAuth after install. A ref (not state) — it drives a one-shot
  // side effect, not a render; it also must survive the auth→setup→install page
  // transitions without re-rendering.
  const deferredModelRef = useRef<string[] | null>(null);
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
      // readSettings() is best-effort there, so a hosted-web /settings/raw 403
      // (ENG-817) can't abort the gate and strand a configured instance on the
      // auth screen; config_ready (health) drives the real decision.
      // hasLocalTermsConsent() is internally try/caught (returns false on any
      // localStorage error), so calling it outside resolveBootTarget's guard is
      // safe — it can't throw and escape init() (ENG-848 review note).
      const target: Page = await resolveBootTarget(host, hasLocalTermsConsent());
      // ENG-921: record the resolved first screen + ground-truth server-install
      // state before sign-in, so first-run breakage between download and a
      // healthy server is measurable (app_installed only fires once the server
      // is healthy). Desktop-only and fire-and-forget — it never blocks boot.
      void trackBootScreenResolved(target);
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

  // Common final step for every path that leads to the chat UI:
  // push any credentials sitting in ~/.cowork/.env into the server DB so
  // config_ready is true on first mount. Called from both the already-installed
  // login path and the post-install path so the handshake is never skipped.
  const handlePostAuth = async () => {
    // Push .env credentials into the DB, then replay any deferred onboarding
    // model (see deferredModelRef). Decision extracted to runPostAuthHandshake
    // so the exhausted-retry transition — route to a retryable error instead of
    // silently entering the app config-not-ready — is unit-tested without
    // rendering App (ENG-922, #455 review).
    const res = await runPostAuthHandshake({
      readSettings: () => host.readSettings(),
      syncSettingsToDb,
      replayModels: (lines) => syncModelsToDbWithRetry(lines),
      deferredModelLines: deferredModelRef.current,
    });
    if (res.clearDeferred) deferredModelRef.current = null;
    setPage(res.next);
  };

  // After login (SSO or BYOK): consent is recorded and a provider is saved.
  // Ensure the backend is installed, then run the credential handshake.
  // `deferredModelLines` is present only when onboarding deferred to setup (the
  // fresh-install/server-not-up race, ENG-922); stashed for handlePostAuth to
  // replay once install finishes.
  const handleAuthComplete = async (deferredModelLines?: string[]) => {
    deferredModelRef.current = deferredModelLines ?? null;
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

      {/* Theme + style toggles on the onboarding corner. CoworkApp hasn't
          mounted yet on these pages (no sidebar to host them), so the
          pre-app flow keeps its own floating corner toggles — namespaced
          `arcade-*` (arcade.css) so they're independent of the in-app
          sidebar footer toggle (Sidebar.jsx) that replaced the old
          shared floating-chrome buttons. The CSS stacks the style toggle
          above the theme toggle. */}
      {isArcadePage && (
        <>
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
          <Tooltip content={skin === '8bit' ? 'Switch 8-bit arcade style off' : 'Switch style to 8-Bit Arcade mode'}>
            <button
              onClick={() => setSkin((s) => (s === '8bit' ? 'normal' : '8bit'))}
              aria-label="Toggle 8-bit arcade style"
              className="arcade-theme-toggle arcade-skin-toggle"
              style={{ zIndex: 200 }}
            >
              <GamepadIcon size={15} />
            </button>
          </Tooltip>
        </>
      )}
    </>
  );
}
