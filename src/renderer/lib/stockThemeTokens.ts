// The stock light and dark themes' surface tokens, as globals.css declares
// them under body[data-theme="light"] and body[data-theme="dark"]. Only one
// theme's tokens are on the page at a time, so code that needs the other
// theme's (the background pickers' "Default" color, the accent contrast check
// without a custom background) reads them here. stockThemeTokens.test.ts
// parses globals.css and fails if the two drift.

export type ThemeName = 'light' | 'dark';

export interface StockSurfaces {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
}

export const STOCK_THEME_SURFACES: Record<ThemeName, StockSurfaces> = {
  light: { bg: '#FAFAFA', surface: '#FFFFFF', surface2: '#F4F4F4', surface3: '#ECECEA' },
  dark: { bg: '#080d18', surface: '#0E1626', surface2: '#131D31', surface3: '#1A2640' },
};

/** A stock theme's default background, as the color picker's 7-digit hex. */
export function stockBackground(theme: ThemeName): string {
  return STOCK_THEME_SURFACES[theme].bg.toLowerCase();
}
