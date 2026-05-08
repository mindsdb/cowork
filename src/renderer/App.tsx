import { useState, useEffect } from 'react';
import TermsConsent from './pages/TermsConsent';
import Setup from './pages/Setup';
import Onboarding from './pages/Onboarding';
import IntroSequence from './pages/IntroSequence';
import CoworkApp from './CoworkApp';
import ThemeToggle from './components/ThemeToggle';
import './styles.css';

type Page = 'loading' | 'intro' | 'terms' | 'setup' | 'onboarding' | 'launching' | 'terminal';

const LOGO = `  \u2584\u2580\u2588 \u2588\u2584 \u2588 \u2580\u2588\u2580 \u2588\u2580\u2588 \u2588\u2584 \u2588
  \u2588\u2580\u2588 \u2588 \u2580\u2588  \u2588  \u2588\u2584\u2588 \u2588 \u2580\u2588`;

const LOGO_PAGES = new Set<Page>(['terms', 'setup', 'onboarding']);

export default function App() {
  const [page, setPage] = useState<Page>('loading');

  useEffect(() => {
    async function init() {
      try {
        const settings = await window.antontron.readSettings();
        if (settings.ANTON_TERMS_CONSENT !== 'true') {
          // Terms gate the rest of the app — every launch up until the
          // user accepts shows the intro, then the terms screen. Once
          // accepted, the intro never plays again because we never
          // re-enter this branch.
          setPage('intro');
          return;
        }

        // The check now returns both halves of "ready to start the
        // server": is the anton CLI installed, AND are the Python
        // deps the bundled FastAPI server needs (fastapi, uvicorn,
        // python-multipart, pydantic) actually importable from the
        // tool venv. Either being false means setup needs to run —
        // setup re-installs anton with the `--with` extras included.
        const status = await window.antontron.checkInstall();
        if (!status.antonInstalled || !status.serverDepsReady) {
          setPage('setup');
          return;
        }
        const { configured } = await window.antontron.checkConfigured();
        if (!configured) {
          setPage('onboarding');
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
    const status = await window.antontron.checkInstall();
    if (!status.antonInstalled || !status.serverDepsReady) {
      setPage('setup');
      return;
    }
    const { configured } = await window.antontron.checkConfigured();
    if (!configured) {
      setPage('onboarding');
      return;
    }
    setPage('launching');
    setTimeout(() => setPage('terminal'), 1200);
  };

  const handleTermsAccepted = () => { advanceFromTerms(); };
  // After install (or re-install), skip the Minds/LLM onboarding
  // step if `~/.anton/.env` already provides one of the supported
  // provider keys. This is the returning-user case — they already
  // configured a provider on a previous run, the installer just
  // refreshed the binary, and forcing them through onboarding again
  // makes them re-pick what they already had. The same
  // `checkConfigured()` gate the boot path uses determines this.
  const handleInstallComplete = async () => {
    try {
      const { configured } = await window.antontron.checkConfigured();
      if (configured) {
        setPage('launching');
        setTimeout(() => setPage('terminal'), 1200);
        return;
      }
    } catch {
      // Fail-open to onboarding — better to ask the user one
      // unnecessary time than to land in the terminal with no key.
    }
    setPage('onboarding');
  };
  const handleOnboardingComplete = () => {
    setPage('launching');
    setTimeout(() => setPage('terminal'), 1200);
  };

  const isMac = window.antontron.getPlatform() === 'darwin';
  const showLogo = LOGO_PAGES.has(page);
  const isTopPinned = page === 'onboarding';

  return (
    <>
      {/* Top-of-window drag overlay only matters for the onboarding pages
          (terms / setup / onboarding) which don't have their own draggable
          chrome. The cowork page provides drag via its sidebar header, so
          we skip this overlay there — otherwise it sits on top of the
          sidebar's icon buttons at z-index:1000 and blocks pointer events
          for the upper ~38px (causing the icons to feel "broken / only
          hoverable at the bottom"). */}
      {isMac && (page === 'intro' || page === 'terms' || page === 'setup' || page === 'onboarding' || page === 'launching') && <div className="titlebar-drag" />}

      {page === 'loading' && (
        <div className="setup-container">
          <div className="logo-section">
            <div className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        </div>
      )}

      {page === 'intro' && (
        <IntroSequence onComplete={() => setPage('terms')} />
      )}

      {showLogo && (
        <div className={`onboard-shell ${isTopPinned ? 'top-pinned' : ''}`}>
          <div className={`onboard-spacer ${isTopPinned ? 'collapsed' : ''}`} />
          <div className="logo-section shared-logo">
            <pre className="logo-ascii">{LOGO}</pre>
            <div className="logo-subtitle">autonomous coworker</div>
          </div>

          <div className="onboard-content" key={page}>
            {page === 'terms' && <TermsConsent onAccept={handleTermsAccepted} />}
            {page === 'setup' && <Setup onComplete={handleInstallComplete} />}
            {page === 'onboarding' && <Onboarding onComplete={handleOnboardingComplete} />}
          </div>
          <div className={`onboard-spacer ${isTopPinned ? 'collapsed' : ''}`} />
        </div>
      )}

      {page === 'launching' && (
        <div className="launch-screen">
          <pre className="logo-ascii">{LOGO}</pre>
          <div className="launch-text">Starting Anton...</div>
          <div className="launch-bar">
            <div className="launch-bar-fill" />
          </div>
        </div>
      )}

      {page === 'terminal' && <CoworkApp />}

      {/* Floating theme toggle — present on every page (terms, setup,
          onboarding, launching, terminal) so the user can flip light/dark
          before they ever land in the cowork shell. The cowork-side
          toggle inside CoworkApp will pick up the same localStorage value
          when the user reaches it. */}
      {page !== 'terminal' && <ThemeToggle />}
    </>
  );
}
