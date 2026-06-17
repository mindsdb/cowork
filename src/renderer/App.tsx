import { useState, useEffect } from 'react';
import TitleScreen from './pages/arcade/TitleScreen';
import TermsScreen from './pages/arcade/TermsScreen';
import SetupScreen from './pages/arcade/SetupScreen';
import { COWORKERS } from './pages/arcade/CoworkerSelect';
import { THEME_PRESETS } from './pages/arcade/ThemeSelect';
import OnboardingScreen from './pages/arcade/OnboardingScreen';
import LaunchScreen from './pages/arcade/LaunchScreen';
import CoworkApp from './CoworkApp';
import { host } from './platform/host';
import { persistSkin } from './lib/skins';
import type { SpriteName } from './pages/arcade/sprites';
import './styles.css';

type Page = 'loading' | 'intro' | 'terms' | 'setup' | 'onboarding' | 'launching' | 'terminal';

// Terms-consent persistence for the web build.
//
// The desktop app records consent in the server-side .env
// (`ANTON_TERMS_CONSENT`), but that flag is only ever written by the
// Onboarding screen. The web deployment ships with a provider already
// configured, so onboarding is skipped — meaning the flag was never
// written and the terms screen reappeared on every refresh. We persist
// a per-browser flag in localStorage instead: it survives a reload, is
// scoped to the individual user (unlike the shared server .env), and
// matches how the app already persists the theme.
const TERMS_CONSENT_KEY = 'anton.termsConsent';

// The active coworker cartridge (mirrors the backend `harness` setting).
// The picker was removed from onboarding — new users default to ANTON —
// but the key is still read here in case an earlier build persisted one.
const COWORKER_KEY = 'anton.coworker';

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

function recallCoworker(): { id: string; label: string; sprite: SpriteName } {
  let id = 'anton';
  try { id = window.localStorage.getItem(COWORKER_KEY) || 'anton'; } catch {}
  const cw = COWORKERS.find((c) => c.id === id && !c.locked);
  return cw
    ? { id: cw.id, label: cw.name, sprite: cw.sprite }
    : { id: 'anton', label: 'ANTON', sprite: 'anton' };
}

// First-run appearance default. Agent + style selection were dropped from
// onboarding, so a new user silently gets ANTON on the MIDNIGHT look
// (standard dark). Guarded so it never overrides a returning user's
// Settings → Appearance choice.
function applyDefaultAppearanceOnce(): void {
  try {
    if (window.localStorage.getItem('anton.theme')) return;
    const midnight = THEME_PRESETS.find((p) => p.id === 'midnight');
    if (!midnight) return;
    persistSkin(midnight.skin);
    window.localStorage.setItem('anton.theme', midnight.theme);
    document.body.dataset.skin = midnight.skin;
    document.body.dataset.theme = midnight.theme;
    document.body.dataset.arcadePreset = midnight.id;
    document.body.classList.remove('gf-theme-dark', 'gf-theme-light');
    document.body.classList.add(midnight.theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
  } catch {}
}

// Dev-only deep link (`?page=onboarding` etc.) so onboarding screens can
// be iterated on / screenshotted without replaying the whole gate
// sequence. Compiled out of production bundles via import.meta.env.DEV.
function devForcedPage(): Page | null {
  if (!import.meta.env.DEV) return null;
  try {
    const p = new URLSearchParams(window.location.search).get('page');
    const valid: Page[] = ['intro', 'terms', 'setup', 'onboarding', 'launching'];
    return valid.includes(p as Page) ? (p as Page) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [page, setPage] = useState<Page>('loading');
  const [coworker] = useState(recallCoworker);
  // When inspecting a single screen via `?page=`, freeze it: the
  // onboarding/launch screens auto-advance on completion, which would
  // navigate away from the very screen you're trying to look at.
  const isDevFrozen = Boolean(devForcedPage());

  useEffect(() => {
    const forced = devForcedPage();
    if (forced) { setPage(forced); return; }

    async function init() {
      try {
        const settings = await host.readSettings();
        // Consent counts if either the server-side flag is set (desktop /
        // onboarding path) or this browser already accepted (web path).
        const consented = settings.ANTON_TERMS_CONSENT === 'true' || hasLocalTermsConsent();
        if (!consented) {
          // Terms gate the rest of the app — every launch up until the
          // user accepts shows the title screen, then terms. Once
          // accepted, the intro never plays again because we never
          // re-enter this branch.
          setPage('intro');
          return;
        }

        // Both halves of "ready to start the server": is the anton CLI
        // installed, AND are the Python deps the bundled FastAPI server
        // needs importable from the tool venv. Either being false means
        // setup needs to run. On web both flags are reported true by the
        // FastAPI host (it IS the install), so this short-circuits there.
        const status = await host.checkInstall();
        if (!status.antonInstalled || !status.serverDepsReady) {
          setPage('setup');
          return;
        }
        const { configured } = await host.checkConfigured();
        if (!configured) {
          applyDefaultAppearanceOnce(); setPage('onboarding');
          return;
        }
        setPage('terminal');
      } catch {
        setPage('terms');
      }
    }
    init();
  }, []);

  const advanceFromTerms = async () => {
    const status = await host.checkInstall();
    if (!status.antonInstalled || !status.serverDepsReady) {
      setPage('setup');
      return;
    }
    const { configured } = await host.checkConfigured();
    if (!configured) {
      applyDefaultAppearanceOnce(); setPage('onboarding');
      return;
    }
    setPage('launching');
  };

  const handleTermsAccepted = () => {
    // Persist consent before advancing. The web build skips onboarding
    // (the provider is pre-configured), and onboarding is the only place
    // the server-side ANTON_TERMS_CONSENT flag is written — so without
    // this a browser refresh drops the user back onto the terms screen
    // every single time.
    rememberTermsConsent();
    advanceFromTerms();
  };

  // After install (or re-install), skip coworker/provider onboarding if
  // `~/.anton/.env` already provides a supported provider key — the
  // returning-user case where the installer just refreshed the binary.
  const handleInstallComplete = async () => {
    try {
      const { configured } = await host.checkConfigured();
      if (configured) {
        setPage('launching');
        return;
      }
    } catch {
      // Fail-open to onboarding — better to ask the user one
      // unnecessary time than to land in the terminal with no key.
    }
    applyDefaultAppearanceOnce(); setPage('onboarding');
  };

  const handleOnboardingComplete = async () => {
    // Restart the backend so it picks up the freshly-written
    // ~/.anton/.env (provider keys, model settings). The server
    // started during Setup before the .env existed, so its cached
    // env-file list doesn't include it.
    try { await host.restartServer(); } catch {}
    setPage('launching');
  };

  const isMac = host.isMac();
  const isArcadePage = page !== 'terminal' && page !== 'loading';

  return (
    <>
      {/* Top-of-window drag overlay only matters for the arcade pages,
          which don't have their own draggable chrome. The cowork page
          provides drag via its sidebar header, so we skip this overlay
          there — otherwise it blocks pointer events for the upper
          ~38px of the sidebar icons. */}
      {isMac && isArcadePage && <div className="titlebar-drag" />}

      {page === 'loading' && (
        <div style={{ position: 'fixed', inset: 0, background: '#0a0a13' }} />
      )}

      {page === 'intro' && <TitleScreen onComplete={() => setPage('terms')} />}
      {page === 'terms' && <TermsScreen onAccept={handleTermsAccepted} />}
      {page === 'setup' && <SetupScreen onComplete={handleInstallComplete} />}
      {page === 'onboarding' && (
        <OnboardingScreen
          coworker={coworker}
          onComplete={isDevFrozen ? () => {} : handleOnboardingComplete}
        />
      )}
      {page === 'launching' && (
        <LaunchScreen
          coworkerLabel={coworker.label}
          onDone={isDevFrozen ? () => {} : () => setPage('terminal')}
        />
      )}

      {page === 'terminal' && <CoworkApp />}
    </>
  );
}
