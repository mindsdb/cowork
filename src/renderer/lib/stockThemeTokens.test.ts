import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STOCK_THEME_SURFACES, stockBackground } from './stockThemeTokens';

const css = readFileSync(join(__dirname, '../cowork/styles/globals.css'), 'utf8');

function themeBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  return css.slice(start, css.indexOf('\n}', start));
}

function token(block: string, name: string): string {
  const m = new RegExp(`\\s${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(block);
  if (!m) throw new Error(`no ${name}`);
  return m[1];
}

describe('stock theme tokens', () => {
  it.each([
    ['light', 'body, body[data-theme="light"]'],
    ['dark', 'body[data-theme="dark"]'],
  ] as const)('match globals.css for %s', (theme, selector) => {
    const block = themeBlock(selector);
    const s = STOCK_THEME_SURFACES[theme];
    expect(s.bg.toLowerCase()).toBe(token(block, '--bg').toLowerCase());
    expect(s.surface.toLowerCase()).toBe(token(block, '--surface').toLowerCase());
    expect(s.surface2.toLowerCase()).toBe(token(block, '--surface-2').toLowerCase());
    expect(s.surface3.toLowerCase()).toBe(token(block, '--surface-3').toLowerCase());
  });

  it('gives each theme its own default background', () => {
    expect(stockBackground('dark')).toBe('#080d18');
    expect(stockBackground('light')).toBe('#fafafa');
  });
});
