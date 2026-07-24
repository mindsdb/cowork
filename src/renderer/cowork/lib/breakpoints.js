// Canonical responsive breakpoints — the single source of truth for the
// app's layout-mode switches. `useBreakpoint` (hooks/useBreakpoint.js)
// reads these in JS, and the CSS side documents the same values (see the
// "Responsive scale" comment in styles/globals.css) so a resize crosses
// one boundary in both systems at the same width. Before this module the
// JS switched at 640/900 while the CSS switched at 700/760/820/1050/…,
// which is why the tablet band felt half-transformed.
//
//   phone    width <  640      → MobileShell (bespoke mobile chrome)
//   tablet   640 ≤ width < 900  → docked slim icon-rail sidebar
//   desktop  width ≥  900      → full docked sidebar
//   wide     width ≥ 1280      → reserved for max-content-width tuning
//
// Boundaries name the max width of the band below them, so
// `width < PHONE_MAX` reads as "phone". CSS max-width rules use the `.98`
// convention (e.g. 639.98) to avoid a double-match at the exact pixel;
// the `*_MAX_CSS` helpers below carry that offset so callers don't
// re-derive it.
export const PHONE_MAX = 640;
export const TABLET_MAX = 900;
export const DESKTOP_WIDE = 1280;

// max-width media-query edge (one hairline below the boundary) so a
// `max-width` rule and the JS `<` test flip at the same visual width.
export const PHONE_MAX_CSS = PHONE_MAX - 0.02; // 639.98
export const TABLET_MAX_CSS = TABLET_MAX - 0.02; // 899.98

export const BREAKPOINTS = { PHONE_MAX, TABLET_MAX, DESKTOP_WIDE };
