import { useState, useEffect, useMemo } from 'react';
import { loadSkin, persistSkin, SKIN_LOCKED, DEFAULT_SKIN, DEPLOYMENT_LOOK, SKINS } from '../../lib/skins';
import { loadCustomTheme, persistCustomTheme, applyCustomTheme } from '../../lib/customTheme';
import { resolveLook } from '../../lib/orgBranding';

// Set once the member picks a style or theme themselves, so the org's default
// look (ENG-4020) stops applying to them. Without these, the stored value
// alone can't tell a pick from the default the app wrote on first run.
const SKIN_CHOSEN_KEY = 'anton.skinChosen';
const THEME_CHOSEN_KEY = 'anton.themeChosen';
const KNOWN_SKINS = SKINS.map((s) => s.id);

function readFlag(key) {
  try { return window.localStorage.getItem(key) === '1'; } catch { return false; }
}

function writeFlag(key) {
  try { window.localStorage.setItem(key, '1'); } catch {}
}

// The app's appearance axes — theme (light | dark), skin, and the
// "design your own" custom-skin recipe — plus the Display picker modal's
// open state. Owns the side effects that keep each applied to <body>:
//   theme  → gf-theme-* class + data-theme + live gravity-field palette
//   skin   → data-skin + persistence
//   custom → inline body token overrides (only while the custom skin is active)
//
// What is applied is the resolved look (lib/orgBranding.ts resolveLook): the
// deployment brand, the org's branding and the member's own choices weighed in
// one place. The member's own choices are what this hook stores; the returned
// `theme`, `skin` and `customTheme` are what the page shows. `look` carries the
// rest of the resolution (greeting, sidebar logo, tab icon, and which fields
// the org has locked, sidebar title and its color) for App to apply.
//
// The settings-driven nav title colour stays in App.jsx — it reads
// `settings`, a different domain.
export function useThemeSkin({ orgBranding = null, settings = null, hostedMindsHub = false } = {}) {
  // Theme (light | dark) — persisted in localStorage so the choice
  // survives reloads. The animated background canvas (gravity-field)
  // and the body's bg colour both follow this value.
  const [theme, setThemeState] = useState(() => {
    try {
      const saved = window.localStorage.getItem('anton.theme');
      return saved === 'light' || saved === 'dark' ? saved : 'dark';
    } catch { return 'dark'; }
  });
  // Skin — a second styling axis, orthogonal to light/dark. Each entry
  // in the SKINS registry (lib/skins.ts) maps to a token-override
  // stylesheet keyed on body[data-skin]; both color schemes have a
  // variant per skin, so the two toggles compose freely.
  const [skin, setSkinState] = useState(loadSkin);
  // The full Display / theme picker modal, opened from the sidebar
  // footer's "Display settings" button.
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  // The "design your own" recipe behind the `custom` skin — edited in
  // Settings → Appearance, applied as inline body token overrides.
  const [customTheme, setCustomThemeState] = useState(loadCustomTheme);
  const [skinChosen, setSkinChosen] = useState(() => readFlag(SKIN_CHOSEN_KEY));
  const [themeChosen, setThemeChosen] = useState(() => readFlag(THEME_CHOSEN_KEY));

  const greeting = settings?.greeting ?? null;
  const navLogo = settings?.navLogo || null;
  const favicon = settings?.favicon || null;
  const navTitle = settings?.navTitle || null;
  const navTitleColor = settings?.navTitleColor || null;
  const look = useMemo(() => resolveLook({
    deployment: DEPLOYMENT_LOOK,
    org: orgBranding,
    member: {
      skin,
      // A style other than the default was picked by someone, before the flag
      // existed; a light theme likewise, since dark is the default.
      skinChosen: skinChosen || skin !== DEFAULT_SKIN,
      customTheme,
      theme,
      themeChosen: themeChosen || theme === 'light',
      greeting,
      navLogo,
      favicon,
      navTitle,
      navTitleColor,
    },
    knownSkins: KNOWN_SKINS,
    hostedMindsHub,
  }), [orgBranding, skin, skinChosen, customTheme, theme, themeChosen, greeting, navLogo, favicon, navTitle, navTitleColor, hostedMindsHub]);

  useEffect(() => {
    try { window.localStorage.setItem('anton.theme', theme); } catch {}
  }, [theme]);

  useEffect(() => {
    const shown = look.theme;
    // Swap body class so kit's gf-theme-* page background colour applies.
    document.body.classList.remove('gf-theme-dark', 'gf-theme-light');
    document.body.classList.add(shown === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
    document.body.dataset.theme = shown;
    // Tell the gravity field to swap palettes live.
    if (window.gravityField && typeof window.gravityField.setTheme === 'function') {
      window.gravityField.setTheme(shown);
    }
  }, [look.theme]);

  useEffect(() => {
    persistSkin(skin);
  }, [skin]);

  useEffect(() => {
    document.body.dataset.skin = look.skin;
  }, [look.skin]);

  useEffect(() => {
    persistCustomTheme(customTheme);
  }, [customTheme]);

  // Custom-skin recipe → inline body tokens. Applied only while the
  // custom skin is active; cleared otherwise so the stylesheet-driven
  // skins are untouched.
  useEffect(() => {
    applyCustomTheme(look.skin === 'custom' ? look.customTheme : null, look.theme === 'light' ? 'light' : 'dark');
  }, [look.skin, look.customTheme, look.theme]);

  // A pick the org has locked, or a style the deployment has locked, does
  // nothing, so the page stays on the look it is required to show.
  const setTheme = (value) => {
    if (look.lockedByOrg.theme) return;
    const next = typeof value === 'function' ? value(look.theme) : value;
    setThemeState(next);
    setThemeChosen(true);
    writeFlag(THEME_CHOSEN_KEY);
  };

  const setSkin = (value) => {
    if (SKIN_LOCKED || look.lockedByOrg.style) return;
    setSkinState(value);
    setSkinChosen(true);
    writeFlag(SKIN_CHOSEN_KEY);
  };

  // Editing the recipe while the org's custom look is showing starts the
  // member's own from it, on the custom style.
  const setCustomTheme = (value) => {
    if (look.lockedByOrg.style) return;
    setCustomThemeState(value);
    if (look.skin === 'custom' && look.skinSource !== 'member' && !SKIN_LOCKED) {
      setSkinState('custom');
      setSkinChosen(true);
      writeFlag(SKIN_CHOSEN_KEY);
    }
  };

  return {
    theme: look.theme, setTheme,
    skin: look.skin, setSkin,
    themeModalOpen, setThemeModalOpen,
    customTheme: look.customTheme ?? customTheme, setCustomTheme,
    look,
  };
}
