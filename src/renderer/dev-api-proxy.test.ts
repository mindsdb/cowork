import { EventEmitter } from 'node:events';
import type { IncomingHttpHeaders } from 'node:http';
import * as path from 'node:path';
import type { ResolvedConfig } from 'vite';
import { describe, expect, it } from 'vitest';

import { WINDOW_PROOF_HEADER } from '../shared/server-launch';
import {
  addDevProxyCredentials,
  DEV_PROXY_PLUGIN,
  devApiProxyHook,
  devProxyCredentials,
  isFromDevOrigin,
  type ProxiedRequest,
} from './dev-api-proxy';

const VITE_PORT = 5173;
const CREDENTIALS = { authToken: 'a1'.repeat(32), windowProof: 'b2'.repeat(32) };

describe("the proxy's credentials", () => {
  it("are read from the dev-web plugin's api", () => {
    expect(devProxyCredentials([{ name: 'vite:react' }, { name: DEV_PROXY_PLUGIN, api: CREDENTIALS }])).toEqual(CREDENTIALS);
  });

  it.each([
    ['no plugin carries them, as under npm run dev', [{ name: 'vite:react' }]],
    ['the plugin has no api', [{ name: DEV_PROXY_PLUGIN }]],
    ['only the token is set', [{ name: DEV_PROXY_PLUGIN, api: { authToken: CREDENTIALS.authToken } }]],
    ['only the proof is set', [{ name: DEV_PROXY_PLUGIN, api: { windowProof: CREDENTIALS.windowProof } }]],
    ['the token is empty', [{ name: DEV_PROXY_PLUGIN, api: { authToken: '', windowProof: CREDENTIALS.windowProof } }]],
    ['a value is not a string', [{ name: DEV_PROXY_PLUGIN, api: { authToken: 1, windowProof: CREDENTIALS.windowProof } }]],
    ['another plugin carries them', [{ name: 'someone-else', api: CREDENTIALS }]],
  ])('are none when %s', (_label, plugins) => {
    expect(devProxyCredentials(plugins)).toBeNull();
  });

  it("go by the name scripts/dev-web-vite.mjs gives its plugin", async () => {
    const script = await import(/* @vite-ignore */ path.resolve('scripts/dev-web-vite.mjs'));

    expect(script.DEV_PROXY_PLUGIN).toBe(DEV_PROXY_PLUGIN);
  });
});

describe("vite.config.ts's hook on the /api proxy", () => {
  /* What the hook registers on the proxy once Vite's config resolved with `plugins`. */
  function registered(plugins: ResolvedConfig['plugins']): number {
    const hook = devApiProxyHook(VITE_PORT);
    const resolved = hook.plugin.configResolved;
    if (typeof resolved !== 'function') throw new Error('the hook plugin has no configResolved function');
    resolved.call({} as never, { plugins } as ResolvedConfig);
    const events = new EventEmitter();
    hook.configure(events);
    return events.listenerCount('proxyReq');
  }

  it('adds the header rule when the dev-web plugin carries the credentials', () => {
    expect(registered([{ name: DEV_PROXY_PLUGIN, api: CREDENTIALS }])).toBe(1);
  });

  it('adds nothing without them, so desktop main\'s headers pass unchanged', () => {
    expect(registered([{ name: 'vite:react' }])).toBe(0);
  });
});

describe("a request from Vite's own page", () => {
  it.each<[string, IncomingHttpHeaders, boolean]>([
    ['a POST from the page at localhost', { origin: 'http://localhost:5173', host: 'localhost:5173' }, true],
    ['a POST from the page at 127.0.0.1', { origin: 'http://127.0.0.1:5173', host: '127.0.0.1:5173' }, true],
    ['a same-origin GET, which carries no Origin', { host: 'localhost:5173', referer: 'http://localhost:5173/c/123' }, true],
    ['a cross-site POST', { origin: 'https://evil.example', host: 'localhost:5173' }, false],
    ['a page on another local port', { origin: 'http://localhost:3000', host: 'localhost:5173' }, false],
    ["a sandboxed frame's fetch, whose Origin is null", { origin: 'null', host: 'localhost:5173', referer: 'http://localhost:5173/' }, false],
    ['a cross-site image, whose Referer names its page', { host: 'localhost:5173', referer: 'https://evil.example/page' }, false],
    ['a cross-site request that sends no Referer', { host: 'localhost:5173' }, false],
    ['a rebound name with a local Referer', { host: 'evil.example:5173', referer: 'http://localhost:5173/' }, false],
    ['an unparseable Referer', { host: 'localhost:5173', referer: 'not a url' }, false],
  ])('%s: %s', (_label, headers, own) => {
    expect(isFromDevOrigin(headers, VITE_PORT)).toBe(own);
  });
});

describe('the proxy header rule', () => {
  /* A proxied request that records the headers the rule leaves on it. */
  function proxiedRequest(initial: Record<string, string>) {
    const headers = new Map(Object.entries(initial).map(([name, value]) => [name.toLowerCase(), value]));
    const request: ProxiedRequest = {
      setHeader: (name, value) => headers.set(name.toLowerCase(), value),
      removeHeader: (name) => { headers.delete(name.toLowerCase()); },
    };
    return { request, headers: () => Object.fromEntries(headers) };
  }

  function proxy(incoming: IncomingHttpHeaders, outgoing: Record<string, string>) {
    const events = new EventEmitter();
    addDevProxyCredentials(events, VITE_PORT, CREDENTIALS);
    const sent = proxiedRequest(outgoing);
    events.emit('proxyReq', sent.request, { headers: incoming });
    return sent.headers();
  }

  it("adds the token and the proof to a request from Vite's page, replacing a proof it brought", () => {
    const incoming = { origin: 'http://localhost:5173', [WINDOW_PROOF_HEADER.toLowerCase()]: 'forged' };

    expect(proxy(incoming, { 'x-cowork-window-proof': 'forged' })).toEqual({
      authorization: `Bearer ${CREDENTIALS.authToken}`,
      'x-cowork-window-proof': CREDENTIALS.windowProof,
    });
  });

  it('adds neither to a cross-site request, and removes a proof it brought', () => {
    expect(proxy({ origin: 'https://evil.example' }, { 'x-cowork-window-proof': 'forged', accept: '*/*' })).toEqual({ accept: '*/*' });
  });
});
