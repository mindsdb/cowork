import { useState, useEffect } from 'react';
import { loadSkin, persistSkin } from '../../lib/skins';
import { loadCustomTheme, persistCustomTheme, applyCustomTheme } from '../../lib/customTheme';

// The app's appearance axes — theme (light | dark), skin, and the
// "design your own" custom-skin recipe — plus the Display picker modal's
// open state. Owns the side effects that keep each applied to <body>:
//   theme  → gf-theme-* class + data-theme + live gravity-field palette
//   skin   → data-skin + persistence
//   custom → inline body token overrides (only while the custom skin is active)
//
// The settings-driven nav title colour stays in App.jsx — it reads
// `settings`, a different domain.
export function useThemeSkin() {
  // Theme (light | dark) — persisted in localStorage so the choice
  // survives reloads. The animated background canvas (gravity-field)
  // and the body's bg colour both follow this value.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = window.localStorage.getItem('anton.theme');
      return saved === 'light' || saved === 'dark' ? saved : 'dark';
    } catch { return 'dark'; }
  });
  // Skin — a second styling axis, orthogonal to light/dark. Each entry
  // in the SKINS registry (lib/skins.ts) maps to a token-override
  // stylesheet keyed on body[data-skin]; both color schemes have a
  // variant per skin, so the two toggles compose freely.
  const [skin, setSkin] = useState(loadSkin);
  // The full Display / theme picker modal, opened from the sidebar
  // footer's "Display settings" button.
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  // The "design your own" recipe behind the `custom` skin — edited in
  // Settings → Appearance, applied as inline body token overrides.
  const [customTheme, setCustomTheme] = useState(loadCustomTheme);

  useEffect(() => {
    try { window.localStorage.setItem('anton.theme', theme); } catch {}
    // Swap body class so kit's gf-theme-* page background colour applies.
    document.body.classList.remove('gf-theme-dark', 'gf-theme-light');
    document.body.classList.add(theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
    document.body.dataset.theme = theme;
    // Tell the gravity field to swap palettes live.
    if (window.gravityField && typeof window.gravityField.setTheme === 'function') {
      window.gravityField.setTheme(theme);
    }
  }, [theme]);

  useEffect(() => {
    persistSkin(skin);
    document.body.dataset.skin = skin;
  }, [skin]);

  // Custom-skin recipe → inline body tokens. Applied only while the
  // custom skin is active; cleared otherwise so the stylesheet-driven
  // skins are untouched.
  useEffect(() => {
    persistCustomTheme(customTheme);
    applyCustomTheme(skin === 'custom' ? customTheme : null, theme === 'light' ? 'light' : 'dark');
  }, [skin, customTheme, theme]);

  return {
    theme, setTheme,
    skin, setSkin,
    themeModalOpen, setThemeModalOpen,
    customTheme, setCustomTheme,
  };
}
