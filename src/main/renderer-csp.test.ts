import { describe, it, expect } from 'vitest';
import { buildRendererCsp, customServerCspSources, DEFAULT_RENDERER_CSP, isRendererDocumentUrl } from './renderer-csp';

// The policy index.html carried as a <meta> tag before ENG-1759 moved it into
// a response header. Pinned verbatim: the default build's posture must not
// drift just because the delivery mechanism changed.
const LEGACY_META_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ws://localhost:* http://127.0.0.1:* http://localhost:* https://us.i.posthog.com https://mindsdb.github.io; frame-src http://127.0.0.1:* http://localhost:*; child-src http://127.0.0.1:* http://localhost:*";

function directive(csp: string, name: string): string[] {
  const part = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name} `));
  return part ? part.slice(name.length + 1).split(/\s+/) : [];
}

describe('buildRendererCsp', () => {
  it('is byte-identical to the old meta policy when no custom server is configured', () => {
    expect(DEFAULT_RENDERER_CSP).toBe(LEGACY_META_CSP);
    expect(buildRendererCsp(null)).toBe(LEGACY_META_CSP);
    expect(buildRendererCsp(undefined)).toBe(LEGACY_META_CSP);
    expect(buildRendererCsp('')).toBe(LEGACY_META_CSP);
  });

  it('allowlists a custom server origin for connect/frame/child, plus its ws:// form for connect', () => {
    const csp = buildRendererCsp('http://192.168.1.5:26866');
    expect(directive(csp, 'connect-src')).toEqual(expect.arrayContaining(['http://192.168.1.5:26866', 'ws://192.168.1.5:26866']));
    expect(directive(csp, 'frame-src')).toContain('http://192.168.1.5:26866');
    expect(directive(csp, 'child-src')).toContain('http://192.168.1.5:26866');
    // Everything the default policy allowed is still there.
    for (const name of ['default-src', 'script-src', 'style-src', 'font-src', 'img-src', 'connect-src', 'frame-src', 'child-src']) {
      expect(directive(csp, name)).toEqual(expect.arrayContaining(directive(LEGACY_META_CSP, name)));
    }
  });

  it('uses wss:// for an https server and never widens img-src', () => {
    const csp = buildRendererCsp('https://cowork.example.com');
    expect(directive(csp, 'connect-src')).toEqual(expect.arrayContaining(['https://cowork.example.com', 'wss://cowork.example.com']));
    expect(directive(csp, 'img-src')).toEqual(directive(LEGACY_META_CSP, 'img-src'));
  });

  it('reduces a URL with a path prefix or trailing slash to its origin', () => {
    expect(customServerCspSources('https://proxy.example.com/cowork/')).toEqual({
      http: 'https://proxy.example.com',
      ws: 'wss://proxy.example.com',
    });
    expect(directive(buildRendererCsp('http://192.168.1.5:26866/'), 'connect-src')).toContain('http://192.168.1.5:26866');
  });

  it('ignores unusable URLs (no scheme, non-http scheme) rather than emitting a broken source', () => {
    expect(customServerCspSources('192.168.1.5:26866')).toBeNull();
    expect(customServerCspSources('ftp://files.example.com')).toBeNull();
    expect(customServerCspSources('not a url')).toBeNull();
    expect(buildRendererCsp('192.168.1.5:26866')).toBe(LEGACY_META_CSP);
  });
});

describe('isRendererDocumentUrl', () => {
  it('matches the bundled file:// renderer in any build', () => {
    expect(isRendererDocumentUrl('file:///Applications/Cowork.app/Contents/Resources/app/dist/index.html', { isPackaged: true })).toBe(true);
    expect(isRendererDocumentUrl('file:///tmp/dev/index.html', { isPackaged: false })).toBe(true);
  });

  it('matches the Vite dev server only when unpackaged', () => {
    expect(isRendererDocumentUrl('http://localhost:5173/', { isPackaged: false })).toBe(true);
    expect(isRendererDocumentUrl('http://localhost:5173/', { isPackaged: true })).toBe(false);
  });

  it('never claims third-party or API-origin pages', () => {
    expect(isRendererDocumentUrl('https://accounts.google.com/o/oauth2/auth', { isPackaged: false })).toBe(false);
    expect(isRendererDocumentUrl('http://127.0.0.1:26866/?state=abc', { isPackaged: false })).toBe(false);
    expect(isRendererDocumentUrl('http://192.168.1.5:26866/', { isPackaged: false })).toBe(false);
  });
});
