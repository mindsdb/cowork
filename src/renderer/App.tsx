import { useState, useEffect } from 'react';
import Setup from './pages/Setup';
import Onboarding from './pages/Onboarding';
import Terminal from './pages/Terminal';
import './styles.css';

type Page = 'loading' | 'setup' | 'onboarding' | 'launching' | 'terminal';

export default function App() {
  const [page, setPage] = useState<Page>('loading');

  useEffect(() => {
    async function init() {
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

      {page === 'setup' && <Setup onComplete={handleInstallComplete} />}
      {page === 'onboarding' && <Onboarding onComplete={handleOnboardingComplete} />}

      {page === 'launching' && (
        <div className="launch-screen">
          <pre className="logo-ascii">{`  ▄▀█ █▄ █ ▀█▀ █▀█ █▄ █
  █▀█ █ ▀█  █  █▄█ █ ▀█`}</pre>
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
