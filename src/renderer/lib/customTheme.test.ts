import { describe, it, expect, beforeEach } from 'vitest';
import {
  CONTRAST, DEFAULT_CUSTOM_THEME, applyCustomTheme, contrastRatio, deriveCustomColors, loadCustomTheme, persistCustomTheme,
  textSurfaces, themeBase,
} from './customTheme';

const STORAGE_KEY = 'anton.customTheme';

describe('customTheme — light/dark background split', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.removeAttribute('style');
    document.body.className = '';
  });

  it('defaults bgLight/bgDark to null', () => {
    expect(DEFAULT_CUSTOM_THEME.bgLight).toBeNull();
    expect(DEFAULT_CUSTOM_THEME.bgDark).toBeNull();
    expect(loadCustomTheme()).toEqual(DEFAULT_CUSTOM_THEME);
  });

  it('migrates a legacy single `bg` field into both bgLight and bgDark', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_CUSTOM_THEME, bg: '#123456' }));
    const loaded = loadCustomTheme();
    expect(loaded.bgLight).toBe('#123456');
    expect(loaded.bgDark).toBe('#123456');
  });

  it('round-trips distinct bgLight/bgDark values through persist + load', () => {
    persistCustomTheme({ ...DEFAULT_CUSTOM_THEME, bgLight: '#fafafa', bgDark: '#080d18' });
    const loaded = loadCustomTheme();
    expect(loaded.bgLight).toBe('#fafafa');
    expect(loaded.bgDark).toBe('#080d18');
  });

  it('applies bgLight when theme is light and bgDark when theme is dark', () => {
    const t = { ...DEFAULT_CUSTOM_THEME, bgLight: '#ffffff', bgDark: '#000000' };

    applyCustomTheme(t, 'light');
    expect(document.body.style.getPropertyValue('--bg')).toBe('#ffffff');

    applyCustomTheme(t, 'dark');
    expect(document.body.style.getPropertyValue('--bg')).toBe('#000000');
  });

  it('marks custom-bg-active on body only while a resolved background is set', () => {
    const withBg = { ...DEFAULT_CUSTOM_THEME, bgDark: '#000000' };
    applyCustomTheme(withBg, 'dark');
    expect(document.body.classList.contains('custom-bg-active')).toBe(true);

    // Same recipe, but Light mode has no override — nothing to flatten there.
    applyCustomTheme(withBg, 'light');
    expect(document.body.classList.contains('custom-bg-active')).toBe(false);
  });

  it('clears custom-bg-active when the theme is turned off entirely (t = null)', () => {
    applyCustomTheme({ ...DEFAULT_CUSTOM_THEME, bgDark: '#000000' }, 'dark');
    expect(document.body.classList.contains('custom-bg-active')).toBe(true);
    applyCustomTheme(null, 'dark');
    expect(document.body.classList.contains('custom-bg-active')).toBe(false);
  });

  // The window-level background (outside the sidebar) is otherwise hardcoded
  // per stock theme by .gf-theme-light/.gf-theme-dark (styles.css), which
  // never reference --bg — so without an inline override here, a custom
  // background would only ever show up inside the sidebar.
  describe('window-level background (outside the sidebar)', () => {
    it('sets an inline body background darker than the picked color', () => {
      applyCustomTheme({ ...DEFAULT_CUSTOM_THEME, bgDark: '#334455' }, 'dark');
      const applied = document.body.style.getPropertyValue('background');
      expect(applied).not.toBe('');
      expect(applied.toLowerCase()).not.toBe('#334455');
    });

    it('clears the inline background when no custom bg is resolved', () => {
      applyCustomTheme({ ...DEFAULT_CUSTOM_THEME, bgDark: '#334455' }, 'light');
      expect(document.body.style.getPropertyValue('background')).toBe('');
    });

    it('clears the inline background when the theme is turned off (t = null)', () => {
      applyCustomTheme({ ...DEFAULT_CUSTOM_THEME, bgDark: '#334455' }, 'dark');
      expect(document.body.style.getPropertyValue('background')).not.toBe('');
      applyCustomTheme(null, 'dark');
      expect(document.body.style.getPropertyValue('background')).toBe('');
    });
  });
});

describe('customTheme — one background, readable in both themes (ENG-4020)', () => {
  const GRID = ['#ffffff', '#000000', '#808080', '#ff0000', '#0000ff', '#ffff00', '#f5f5f0', '#111111'];
  const ACCENTS = ['#a78bfa', '#ffff00', '#1f9cb0', '#000080'];
  const THEMES = ['light', 'dark'] as const;
  const hexOf = (value: string) => {
    const m = /^#[0-9a-f]{6}$/i.exec(value);
    if (m) return value;
    const rgb = /rgba?\((\d+), (\d+), (\d+)/.exec(value)!;
    return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  };

  describe.each(THEMES)('%s theme', (theme) => {
    it.each(GRID)('keeps the base in the theme\'s polarity for %s', (bg) => {
      const base = themeBase(bg, theme)!;
      const white = contrastRatio(base, '#ffffff');
      const black = contrastRatio(base, '#000000');
      if (theme === 'light') expect(black).toBeGreaterThan(white);
      else expect(white).toBeGreaterThan(black);
    });

    it.each(GRID.flatMap((bg) => ACCENTS.map((accent) => [bg, accent])))(
      'gives readable text on every surface for background %s and accent %s',
      (bg, accent) => {
        const recipe = { ...DEFAULT_CUSTOM_THEME, accent, bgLight: bg, bgDark: bg };
        const tokens = deriveCustomColors(recipe, theme);
        const surfaces = textSurfaces(tokens, theme);
        const pairs: [string, number][] = [
          ['--ink', CONTRAST.ink],
          ['--ink-2', CONTRAST.secondary],
          ['--ink-3', CONTRAST.secondary],
          ['--ink-4', CONTRAST.placeholder],
          ['--accent', CONTRAST.accentText],
          ['--accent-2', CONTRAST.accentText],
          ['--accent-3', CONTRAST.accentText],
        ];
        for (const [token, floor] of pairs) {
          for (const surface of surfaces) {
            expect(contrastRatio(tokens[token], surface), `${token} on ${surface}`).toBeGreaterThanOrEqual(floor);
          }
        }
        // Every surface, line and ink token is set, so none falls back to the stock theme's.
        for (const token of ['--bg', '--surface', '--surface-2', '--surface-3', '--line', '--line-2', '--sidebar-bg',
          '--surface-glass', '--ink', '--ink-2', '--ink-3', '--ink-4', '--ink-5']) {
          expect(tokens[token], token).toBeTruthy();
        }
        // The glass cards share the surface's color.
        expect(hexOf(tokens['--surface-glass'])).toBe(tokens['--surface'].toLowerCase());
        // The solid accent button's label reads on it.
        expect(contrastRatio(tokens['--accent-solid'], tokens['--accent-solid-ink'])).toBeGreaterThanOrEqual(3);
      },
    );

    it.each(ACCENTS)('keeps accent %s readable as text on the stock surfaces when no background is set', (accent) => {
      const tokens = deriveCustomColors({ ...DEFAULT_CUSTOM_THEME, accent }, theme);
      expect(tokens['--bg']).toBeUndefined();
      const stock = theme === 'light' ? ['#FAFAFA', '#FFFFFF', '#F4F4F4', '#ECECEA'] : ['#080d18', '#0E1626', '#131D31', '#1A2640'];
      for (const surface of stock) expect(contrastRatio(tokens['--accent'], surface)).toBeGreaterThanOrEqual(CONTRAST.accentText);
    });
  });

  it('turns a near-white background into a dark shade in dark theme, so cards and text agree', () => {
    const tokens = deriveCustomColors({ ...DEFAULT_CUSTOM_THEME, bgLight: '#f5f5f0', bgDark: '#f5f5f0' }, 'dark');
    expect(contrastRatio(tokens['--surface'], '#000000')).toBeLessThan(contrastRatio(tokens['--surface'], '#ffffff'));
    expect(contrastRatio(tokens['--ink'], '#ffffff')).toBeLessThan(contrastRatio(tokens['--ink'], '#000000'));
  });

  it('applies and clears the derived surface, glass and ink tokens on <body>', () => {
    applyCustomTheme({ ...DEFAULT_CUSTOM_THEME, bgDark: '#f5f5f0' }, 'dark');
    for (const token of ['--surface-glass', '--ink-3', '--sidebar-bg', '--accent-solid']) {
      expect(document.body.style.getPropertyValue(token)).not.toBe('');
    }
    applyCustomTheme(null, 'dark');
    for (const token of ['--surface-glass', '--ink-3', '--sidebar-bg', '--accent-solid']) {
      expect(document.body.style.getPropertyValue(token)).toBe('');
    }
  });
});
