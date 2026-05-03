import { useState, useEffect } from 'react';
import TermsConsent from './pages/TermsConsent';
import Setup from './pages/Setup';
import Onboarding from './pages/Onboarding';
import CoworkApp from './CoworkApp';
import ThemeToggle from './components/ThemeToggle';
import './styles.css';

type Page = 'loading' | 'terms' | 'setup' | 'onboarding' | 'launching' | 'terminal';

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
          setPage('terms');
          return;
        }

        const installed = await window.antontron.checkInstall();
        if (!installed) {
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
    const installed = await window.antontron.checkInstall();
    if (!installed) {
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
  const handleInstallComplete = () => setPage('onboarding');
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
      {isMac && page !== 'terminal' && <div className="titlebar-drag" />}

      {page === 'loading' && (
        <div className="setup-container">
          <div className="logo-section">
            <div className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        </div>
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
