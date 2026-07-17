// Sidebar branding (title text, title color, logo) — synced Settings fields
// (navTitle/navTitleColor/navLogo), same mechanism as the greeting. Unlike
// the "Design your own" CustomTheme recipe (customTheme.ts, local-only,
// tied to the Custom skin), branding applies regardless of skin/theme.

/**
 * Apply (or with null/empty, clear) the sidebar wordmark color as an inline
 * body property. Independent of the active skin — works in every style.
 */
export function applyNavTitleColor(color: string | null | undefined): void {
  if (color) document.body.style.setProperty('--nav-title-color', color);
  else document.body.style.removeProperty('--nav-title-color');
}
