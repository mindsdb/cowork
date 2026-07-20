import { describe, expect, it } from 'vitest';
import {
  appIdForOrigin,
  sanitizeApps,
  suggestAppName,
  tabMatchesApp,
} from './browser-logic';

describe('web apps registry', () => {
  it('appIdForOrigin is stable and slug-safe', () => {
    expect(appIdForOrigin('https://mail.google.com')).toBe('app-mail.google.com');
    expect(appIdForOrigin('https://Linear.App')).toBe('app-linear.app');
    expect(appIdForOrigin('http://localhost:3000')).toBe('app-localhost-3000');
  });

  it('suggestAppName makes an editable guess', () => {
    expect(suggestAppName('https://mail.google.com')).toBe('Mail Google');
    expect(suggestAppName('https://www.linear.app')).toBe('Linear');
    expect(suggestAppName('https://www.bbc.co.uk/sport')).toBe('Bbc');
    expect(suggestAppName('not a url')).toBe('not a url');
  });

  it('tabMatchesApp matches on exact origin only', () => {
    expect(tabMatchesApp('https://mail.google.com/mail/u/0/#inbox', 'https://mail.google.com')).toBe(true);
    expect(tabMatchesApp('https://google.com', 'https://mail.google.com')).toBe(false);
    expect(tabMatchesApp('about:blank', 'https://mail.google.com')).toBe(false);
    expect(tabMatchesApp('', 'https://mail.google.com')).toBe(false);
  });

  it('sanitizeApps drops junk, normalizes origins, and backfills ids/names', () => {
    const apps = sanitizeApps([
      { id: 'app-x', name: 'X', origin: 'https://x.com/', createdAt: 1 },
      { origin: 'https://linear.app' }, // backfill id + name
      { name: 'no origin' },
      { origin: 'ftp://evil.com' },
      'garbage',
      { origin: 42 },
    ]);
    expect(apps).toEqual([
      { id: 'app-x', name: 'X', origin: 'https://x.com', createdAt: 1 },
      { id: 'app-linear.app', name: 'Linear', origin: 'https://linear.app', createdAt: 0 },
    ]);
    expect(sanitizeApps(null)).toEqual([]);
    expect(sanitizeApps('nope')).toEqual([]);
  });
});
