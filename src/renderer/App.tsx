import { useState, useEffect } from 'react';
import TermsConsent from './pages/TermsConsent';
import Setup from './pages/Setup';
import Onboarding from './pages/Onboarding';
import Terminal from './pages/Terminal';
import './styles.css';

type Page = 'loading' | 'terms' | 'setup' | 'onboarding' | 'launching' | 'terminal';

export default function App() {
  const [page, setPage] = useState<Page>('loading');

  useEffect(() => {
    async function init() {
      // Check if terms were already accepted
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
      // Installed — check if API key is configured
      const { configured } = await window.antontron.checkConfigured();
      if (!configured) {
        setPage('onboarding');
        return;
      }
      setPage('terminal');
    }
    init();
  }, []);

  const handleTermsAccepted = () => {
    setPage('setup');
  };

  const handleInstallComplete = () => {
    // After install, go to onboarding (API key setup)
    setPage('onboarding');
  };

  const handleOnboardingComplete = () => {
    // Fade transition before terminal
    setPage('launching');
    setTimeout(() => setPage('terminal'), 1200);
  };

  const isMac = window.antontron.getPlatform() === 'darwin';

  return (
    <>
      {isMac && <div className="titlebar-drag" />}

      {page === 'loading' && (
        <div className="setup-container">
          <div className="logo-section">
            <div className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        </div>
      )}

      {page === 'terms' && <TermsConsent onAccept={handleTermsAccepted} />}
      {page === 'setup' && <Setup onComplete={handleInstallComplete} />}
      {page === 'onboarding' && <Onboarding onComplete={handleOnboardingComplete} />}

      {page === 'launching' && (
        <div className="launch-screen">
          <pre className="logo-ascii">{`  \u2584\u2580\u2588 \u2588\u2584 \u2588 \u2580\u2588\u2580 \u2588\u2580\u2588 \u2588\u2584 \u2588
  \u2588\u2580\u2588 \u2588 \u2580\u2588  \u2588  \u2588\u2584\u2588 \u2588 \u2580\u2588`}</pre>
          <div className="launch-text">Starting Anton...</div>
          <div className="launch-bar">
            <div className="launch-bar-fill" />
          </div>
        </div>
      )}

      {page === 'terminal' && <Terminal />}
    </>
  );
}
