import { describe, expect, it } from 'vitest';
import {
  BROWSER_BADGE,
  browserStep,
  browserViewerTheme,
  isFramableViewUrl,
  latestBrowserSession,
  needsFreshViewUrl,
  withBrowserStep,
} from './browserSession';

const VIEW = 'https://br-ab12cd34.4nton.ai/sessions/main/view?et=tok';

describe('isFramableViewUrl', () => {
  it('accepts a standalone browser service on this machine', () => {
    expect(isFramableViewUrl('http://localhost:8080/sessions/main/view?et=tok')).toBe(true);
    expect(isFramableViewUrl('http://127.0.0.1:8080/sessions/main/view')).toBe(true);
    expect(isFramableViewUrl('http://browser.acme.dev/sessions/main/view')).toBe(false);
    expect(isFramableViewUrl('http://localhost.evil.com/v')).toBe(false);
  });

  it('accepts a standalone server over https, but only its viewer page', () => {
    expect(isFramableViewUrl('https://browser.acme.dev/sessions/u-1/view?et=tok')).toBe(true);
    expect(isFramableViewUrl('https://browser.acme.dev/')).toBe(false);
    expect(isFramableViewUrl('https://evil.com/phish')).toBe(false);
    expect(isFramableViewUrl('https://user:pw@browser.acme.dev/sessions/main/view')).toBe(false);
  });

  it('accepts hosted browser instances only', () => {
    expect(isFramableViewUrl(VIEW)).toBe(true);
    expect(isFramableViewUrl('https://br-ab12cd34-alpha.dev.mindshub.ai/sessions/main/view')).toBe(true);
    for (const bad of ['', null, 'http://br-x.4nton.ai/v', 'https://hm-x.4nton.ai/v', 'https://br-x.4nton.ai.evil.com/v', 'javascript:alert(1)']) {
      expect(isFramableViewUrl(bad)).toBe(false);
    }
  });
});

describe('browserStep', () => {
  it('builds one Browser step from the event', () => {
    const step = browserStep({ session_id: 'main', view_url: VIEW, expires_at: 99 }, 5);
    expect(step).toMatchObject({ badge: BROWSER_BADGE, icon: 'globe', data: { sessionId: 'main', viewUrl: VIEW, expiresAt: 99 } });
  });

  it('drops events it cannot frame', () => {
    expect(browserStep({ session_id: 'main', view_url: 'https://evil.com' }, 0)).toBeNull();
    expect(browserStep({ view_url: VIEW }, 0)).toBeNull();
  });

  it('a second event for the same session refreshes the URL instead of adding a step', () => {
    const first = browserStep({ session_id: 'main', view_url: VIEW, expires_at: 1 }, 1);
    const second = browserStep({ session_id: 'main', view_url: `${VIEW}2`, expires_at: 2 }, 2);
    const steps = withBrowserStep(withBrowserStep([], first), second);
    expect(steps).toHaveLength(1);
    expect(steps[0].data.viewUrl).toBe(`${VIEW}2`);
  });
});

describe('latestBrowserSession', () => {
  const step = (url) => browserStep({ session_id: 'main', view_url: url, expires_at: 10 }, 0);

  it('prefers the streaming turn, then the newest message', () => {
    const messages = [{ steps: [step(`${VIEW}a`)] }, { steps: [] }, { steps: [step(`${VIEW}b`)] }];
    expect(latestBrowserSession(messages, null)).toMatchObject({ key: 'm2:main', viewUrl: `${VIEW}b` });
    expect(latestBrowserSession(messages, { steps: [step(`${VIEW}c`)] })).toMatchObject({ key: 'live:main', viewUrl: `${VIEW}c` });
  });

  it('is null when no turn opened the browser', () => {
    expect(latestBrowserSession([{ steps: [{ badge: 'Tool' }] }], { steps: [] })).toBeNull();
  });
});

describe('needsFreshViewUrl', () => {
  it('re-mints near expiry, and when there is no URL', () => {
    const now = 1_000_000_000;
    expect(needsFreshViewUrl({ viewUrl: VIEW, expiresAt: now / 1000 + 3600 }, now)).toBe(false);
    expect(needsFreshViewUrl({ viewUrl: VIEW, expiresAt: now / 1000 + 30 }, now)).toBe(true);
    expect(needsFreshViewUrl({ viewUrl: VIEW, expiresAt: 0 }, now)).toBe(false);
    expect(needsFreshViewUrl({ viewUrl: '' }, now)).toBe(true);
  });
});

describe('browserViewerTheme', () => {
  it('maps the app tokens onto the viewer variables', () => {
    const tokens = { '--bg': ' #080d18 ', '--surface': '#0E1626', '--line': '#1E2A44', '--ink': '#F2F6FF', '--font-sans': "'JetBrains Mono', monospace" };
    const style = { getPropertyValue: (name) => tokens[name] ?? '' };
    expect(browserViewerTheme(style, 'dark')).toEqual({
      type: 'browser-theme',
      scheme: 'dark',
      vars: { bg: '#080d18', panel: '#0E1626', border: '#1E2A44', text: '#F2F6FF', font: "'JetBrains Mono', monospace" },
    });
    expect(browserViewerTheme(style, undefined).scheme).toBe('light');
  });
});

