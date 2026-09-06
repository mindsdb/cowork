// Keep these layout boundaries aligned with the Responsive scale rules in styles/globals.css.
// Bands use width < *_MAX; CSS helpers subtract .02px to avoid matching both bands at the boundary.
export const PHONE_MAX = 640;
export const TABLET_MAX = 900;
export const DESKTOP_WIDE = 1280;

// max-width media-query edge (one hairline below the boundary) so a
// `max-width` rule and the JS `<` test flip at the same visual width.
export const PHONE_MAX_CSS = PHONE_MAX - 0.02; // 639.98
export const TABLET_MAX_CSS = TABLET_MAX - 0.02; // 899.98

export const BREAKPOINTS = { PHONE_MAX, TABLET_MAX, DESKTOP_WIDE };
