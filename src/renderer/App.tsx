import { useState, useEffect } from 'react';
import TermsConsent from './pages/TermsConsent';
import Setup from './pages/Setup';
import Onboarding from './pages/Onboarding';
import IntroSequence from './pages/IntroSequence';
import CoworkApp from './CoworkApp';
import ThemeToggle from './components/ThemeToggle';
import { host } from './platform/host';
import './styles.css';

type Page = 'loading' | 'intro' | 'terms' | 'setup' | 'onboarding' | 'launching' | 'terminal';

// Minds bear icon embedded inline so the logo renders without a network
// fetch and works identically in Electron and web builds.
function MindsLogo({ size = 36 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-40 -40 160 160"
      width={size}
      height={size}
      fill="none"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <g transform="translate(0,18)">
        <path d="M54.6875 23.9074C55.1361 23.3949 55.9792 23.6568 56.0586 24.3331L57.9141 40.1652C57.9376 40.3653 58.0374 40.549 58.1924 40.6779L59.084 41.4181C59.3623 41.6495 59.4466 42.041 59.2881 42.3663L58.7061 43.5587C58.5501 43.8783 58.1987 44.0535 57.8496 43.9855L52.4297 42.9288C52.1688 42.8779 51.9512 42.6987 51.8516 42.4523L47.8047 32.424C47.6939 32.1492 47.7473 31.8354 47.9424 31.6124L54.6875 23.9074ZM22.4981 29.6075C22.9578 29.3375 23.5474 29.5939 23.6631 30.1144L25.6963 39.2765C25.7282 39.4201 25.8002 39.5515 25.9033 39.6564L27.0498 40.8224C27.2671 41.0435 27.334 41.3717 27.2207 41.6603L26.7891 42.7609C26.6562 43.0993 26.3083 43.3026 25.9483 43.2521L20.5625 42.4952C20.3097 42.4596 20.0903 42.3034 19.9736 42.0763L15.9756 34.299C15.7852 33.9284 15.9173 33.473 16.2764 33.2618L22.4981 29.6075ZM42.9453 0.000127381C44.175 0.0198076 51.9527 2.51416 53.7608 2.37708C55.3607 2.25531 62.6581 2.24099 64.3106 2.23939C64.5315 2.23917 64.7427 2.17593 64.9346 2.06653C65.405 1.79837 66.0885 1.46105 66.4316 1.47376C66.9619 1.49339 67.5509 1.47369 68.0615 2.06263C68.1524 2.1717 68.3107 2.47943 68.2715 2.88587L68.2705 2.90052C68.2645 2.96253 68.2588 3.02477 68.2588 3.08704V3.68372C68.2588 3.74224 68.2524 3.80108 68.2559 3.8595C68.2654 4.0183 68.3479 4.27974 68.6318 4.49915L73.4248 9.17396C73.6736 9.4228 74.1516 10.1246 74.0733 10.9415V11.7863C74.0994 11.9892 74.1867 12.4309 74.3281 12.5724L78.085 16.5958C78.1599 16.6761 78.2465 16.7449 78.3379 16.8058C78.573 16.9622 78.8873 17.2062 79.002 17.4142C79.0392 17.4818 79.0601 17.5587 79.0723 17.6349C79.1179 17.9225 79.0183 18.464 78.3359 18.9962C77.8776 19.3629 76.6229 20.2142 75.2715 20.6857C75.0358 20.7577 74.2893 20.8422 73.1895 20.6066L65.3809 19.7755C65.2957 19.7664 65.2131 19.7488 65.1318 19.7218C64.3351 19.4569 59.8465 17.9788 59.0059 18.0226C58.1249 18.069 54.1547 20.913 53.7881 21.1769C53.7683 21.1912 53.7522 21.2019 53.7315 21.215C53.1795 21.5638 45.1487 26.6409 44.3574 27.3117C43.6199 27.937 43.066 32.9029 42.9629 33.8859C42.951 33.9988 42.9237 34.1078 42.8809 34.213L40.749 39.4493C40.5972 39.8222 40.7264 40.2508 41.0596 40.4767C41.3457 40.6707 41.4869 41.0182 41.416 41.3566L41.2842 41.9855C41.1697 42.5311 40.6884 42.9218 40.1309 42.922H33.9551C33.3043 42.9218 32.7764 42.3941 32.7764 41.7433V28.5626C32.7764 27.8843 32.2055 27.3458 31.5283 27.3859L11.542 28.5685C11.0277 28.5989 10.5925 28.9603 10.4678 29.4601L9.18848 34.5861C9.16821 34.6673 9.13953 34.7463 9.10255 34.8214L6.83497 39.4259C6.64963 39.8026 6.77906 40.2586 7.13477 40.4816C7.43509 40.6699 7.57998 41.0302 7.49415 41.3742L7.33106 42.0284C7.20006 42.5533 6.72848 42.922 6.18751 42.922H1.17774C0.525642 42.9218 -0.0023792 42.4022 8.0631e-06 41.7501C0.0164061 37.3805 0.0858068 22.1835 0.270516 20.1349C0.463916 17.9909 1.71279 16.3656 1.97364 16.047C2.00545 16.0081 2.03147 15.9744 2.05958 15.9327C2.54839 15.2086 7.52268 7.86798 9.15821 6.54212C10.8788 5.14745 19.6 1.39535 20.8184 1.31653C22.0362 1.23797 31.4147 2.23919 32.7764 2.23939C34.1366 2.23939 41.7156 -0.0195165 42.9453 0.000127381Z" fill="#1F9CB0" />
      </g>
    </svg>
  );
}

const LOGO_PAGES = new Set<Page>(['terms', 'setup', 'onboarding']);

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

export default function App() {
  const [page, setPage] = useState<Page>('loading');

  useEffect(() => {
    async function init() {
      try {
        const settings = await host.readSettings();
        // Consent counts if either the server-side flag is set (desktop /
        // onboarding path) or this browser already accepted (web path).
        const consented = settings.ANTON_TERMS_CONSENT === 'true' || hasLocalTermsConsent();
        if (!consented) {
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
        // On web both flags are reported true by the FastAPI host
        // (it IS the install), so this branch short-circuits there.
        const status = await host.checkInstall();
        if (!status.antonInstalled || !status.serverDepsReady) {
          setPage('setup');
          return;
        }
        const { configured } = await host.checkConfigured();
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
    const status = await host.checkInstall();
    if (!status.antonInstalled || !status.serverDepsReady) {
      setPage('setup');
      return;
    }
    const { configured } = await host.checkConfigured();
    if (!configured) {
      setPage('onboarding');
      return;
    }
    setPage('launching');
    setTimeout(() => setPage('terminal'), 1200);
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
  // After install (or re-install), skip the Minds/LLM onboarding
  // step if `~/.anton/.env` already provides one of the supported
  // provider keys. This is the returning-user case — they already
  // configured a provider on a previous run, the installer just
  // refreshed the binary, and forcing them through onboarding again
  // makes them re-pick what they already had. The same
  // `checkConfigured()` gate the boot path uses determines this.
  const handleInstallComplete = async () => {
    try {
      const { configured } = await host.checkConfigured();
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
  const handleOnboardingComplete = async () => {
    // Restart the backend so it picks up the freshly-written
    // ~/.anton/.env (provider keys, model settings). The server
    // started during Setup before the .env existed, so its cached
    // env-file list doesn't include it.
    try { await host.restartServer(); } catch {}
    setPage('terminal');
  };

  const isMac = host.isMac();
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
            <div className="logo-brand">
              <MindsLogo size={120} />
              <span className="logo-brand-text">Minds Cowork</span>
            </div>
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
          <div className="logo-brand">
            <MindsLogo size={120} />
            <span className="logo-brand-text">Minds Cowork</span>
          </div>
          <div className="launch-text">Starting Minds Cowork...</div>
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
