import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// App imports legacy styles first, so Tailwind utilities win equal-specificity ties.
// Higher-specificity legacy selectors may still require explicit overrides.
import './cowork/styles/tailwind.css';
// Bundle KaTeX locally because CSP forbids CDN scripts. Import before globals.css so local
// math-spacing rules win.
import 'katex/dist/katex.min.css';
// Onboarding also needs the cowork fonts/tokens; shell styles alias their legacy names to these
// tokens.
import './cowork/styles/globals.css';
import './cowork/styles/skin-8bit.css';
import './styles.css';
import { loadSkin } from './lib/skins';

// This entry requires preload's Electron bridge. Show a development pointer in plain browsers
// instead of silently using web host fallbacks.
if (typeof window !== 'undefined' && !(window as any).antontron) {
  document.body.innerHTML = `
    <div style="
      font-family: 'Inter', system-ui, sans-serif;
      max-width: 560px;
      margin: 15vh auto;
      padding: 32px;
      color: #f3f5f7;
      background: #1a1a24;
      border: 1px solid #2a2a3a;
      border-radius: 12px;
      line-height: 1.55;
    ">
      <h1 style="margin: 0 0 12px; font-size: 22px; font-weight: 600;">
        This is the Electron entry
      </h1>
      <p style="margin: 0 0 16px; color: #b8b8c8;">
        You're loading <code>index.html</code> in a browser, but this entry
        depends on the Electron preload bridge. Use one of:
      </p>
      <ul style="margin: 0; padding-left: 20px; color: #b8b8c8;">
        <li><code style="color:#7aa7ff;">npm run dev</code> &mdash; launches Electron itself.</li>
        <li><code style="color:#7aa7ff;">npm run dev:web</code> &mdash; opens the browser SPA at <a style="color:#7aa7ff;" href="/index-web.html">/index-web.html</a>.</li>
      </ul>
    </div>`;
} else {
  // Apply the persisted theme + skin on first paint (before React
  // mounts) so onboarding doesn't flash the wrong palette.
  (() => {
    let theme: 'light' | 'dark' = 'dark';
    try {
      const saved = window.localStorage.getItem('anton.theme');
      if (saved === 'light' || saved === 'dark') theme = saved;
    } catch {}
    document.body.dataset.theme = theme;
    document.body.dataset.skin = loadSkin();
    document.body.classList.add(theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
  })();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
