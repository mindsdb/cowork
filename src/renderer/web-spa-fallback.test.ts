import { describe, it, expect } from 'vitest';
import { isSpaNavigation } from './web-spa-fallback';

// A top-level browser navigation (address bar, refresh, link click).
const nav = (url: string) => ({ url, method: 'GET', headers: { accept: 'text/html,application/xhtml+xml' } });

describe('isSpaNavigation (ENG-1233 dev-server history fallback)', () => {
  it('rewrites the SPA routes', () => {
    for (const url of ['/', '/c/abc-123', '/projects', '/connect', '/scheduled/sched-9']) {
      expect(isSpaNavigation(nav(url))).toBe(true);
    }
  });

  it('rewrites a route segment that contains a dot (the bug: project addressed by name)', () => {
    // `/projects/acme.io` and `/projects/v1.2` are SPA routes, not files — an
    // extension check would 404 these on refresh in `npm run dev:web`.
    expect(isSpaNavigation(nav('/projects/acme.io'))).toBe(true);
    expect(isSpaNavigation(nav('/projects/v1.2'))).toBe(true);
    expect(isSpaNavigation(nav('/c/my.conversation.id'))).toBe(true);
  });

  it('ignores query strings when matching internals', () => {
    expect(isSpaNavigation(nav('/projects?foo=bar'))).toBe(true);
    expect(isSpaNavigation(nav('/api/x?y=z'))).toBe(false);
  });

  it('leaves sub-resource requests alone (no text/html Accept)', () => {
    // Assets are loaded via <link>/<script>/<img>/import — never text/html.
    expect(isSpaNavigation({ url: '/gravity-field/gravity-field.css', method: 'GET', headers: { accept: 'text/css,*/*' } })).toBe(false);
    expect(isSpaNavigation({ url: '/web-main.tsx', method: 'GET', headers: { accept: '*/*' } })).toBe(false);
    expect(isSpaNavigation({ url: '/assets/index-abc.js', method: 'GET', headers: { accept: '*/*' } })).toBe(false);
  });

  it('leaves the proxied API and Vite internals alone even on an HTML nav', () => {
    for (const url of ['/api/v1/health', '/@vite/client', '/@react-refresh', '/node_modules/foo', '/__inspect']) {
      expect(isSpaNavigation(nav(url))).toBe(false);
    }
  });

  it('only rewrites GET', () => {
    expect(isSpaNavigation({ url: '/projects', method: 'POST', headers: { accept: 'text/html' } })).toBe(false);
  });

  it('tolerates a missing url or accept header', () => {
    expect(isSpaNavigation({ method: 'GET', headers: {} })).toBe(false);
    expect(isSpaNavigation({})).toBe(false);
  });
});
