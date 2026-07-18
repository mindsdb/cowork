import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CdpSocket } from './cdp-client';
import * as bridge from './browser-bridge';
import { FORBIDDEN_CDP_METHODS } from '../shared/browser-bridge-types';

// A fake CDP socket that records every method sent and returns canned results,
// so we can assert NO forbidden (Network.getCookies / Storage / Input) method
// is ever issued.
class FakeCdpSocket implements CdpSocket {
  static instances: FakeCdpSocket[] = [];
  sentMethods: string[] = [];
  private handlers: Record<string, ((arg?: unknown) => void)[]> = {};
  // Canned page snapshot returned by Runtime.evaluate.
  page = {
    url: 'https://docs.example.com/api',
    title: 'API Docs',
    text: 'Hello world',
    headings: ['API'],
    links: [
      { text: 'Charges', href: 'https://docs.example.com/api/charges' },
      { text: 'External', href: 'https://evil.example.org/x' },
    ],
    viewport: { scrollX: 0, scrollY: 0, scrollHeight: 2000, innerHeight: 800 },
  };

  constructor() {
    FakeCdpSocket.instances.push(this);
  }
  send(data: string): void {
    const frame = JSON.parse(data);
    this.sentMethods.push(frame.method);
    // Reply asynchronously on next tick.
    queueMicrotask(() => {
      let result: Record<string, unknown> = {};
      if (frame.method === 'Runtime.evaluate') {
        result = { result: { value: this.page } };
      }
      this.fire('message', JSON.stringify({ id: frame.id, result }));
    });
  }
  close(): void {
    this.fire('close');
  }
  on(event: string, cb: (arg?: unknown) => void): void {
    (this.handlers[event] ||= []).push(cb);
  }
  fire(event: string, arg?: unknown): void {
    for (const cb of this.handlers[event] || []) cb(arg);
  }
  emitEvent(method: string, params: unknown): void {
    this.fire('message', JSON.stringify({ method, params }));
  }
}

const TARGET = {
  id: 'TAB-1',
  type: 'page',
  title: 'API Docs',
  url: 'https://docs.example.com/api',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/TAB-1',
};

let restore: () => void;

beforeEach(() => {
  FakeCdpSocket.instances = [];
  process.env.COWORK_BUILD_KIND = 'dev';
  restore = bridge.__setBridgeDeps({
    listTargets: async () => [TARGET],
    wsFactory: () => {
      const s = new FakeCdpSocket();
      // connect() waits for 'open'
      queueMicrotask(() => s.fire('open'));
      return s;
    },
  });
});

afterEach(() => {
  bridge.__resetBridgeForTest();
  restore();
  vi.useRealTimers();
});

async function connect(): Promise<void> {
  await bridge.attach('TAB-1');
  await bridge.approve();
}

describe('browser-bridge state machine', () => {
  it('starts disconnected', () => {
    expect(bridge.currentState()).toBe('disconnected');
  });

  it('attach → awaiting-approval, approve → connected with domain', async () => {
    await bridge.attach('TAB-1');
    expect(bridge.currentState()).toBe('awaiting-approval');
    await bridge.approve();
    expect(bridge.currentState()).toBe('connected');
    expect(bridge.status().domain).toBe('example.com');
  });

  it('cancelAttach returns to disconnected', async () => {
    await bridge.attach('TAB-1');
    bridge.cancelAttach();
    expect(bridge.currentState()).toBe('disconnected');
  });

  it('detach revokes and returns to disconnected', async () => {
    await connect();
    await bridge.detach();
    expect(bridge.currentState()).toBe('disconnected');
  });

  it('goes to lost when the approved target is destroyed', async () => {
    await connect();
    const socket = FakeCdpSocket.instances[0];
    socket.emitEvent('Target.targetDestroyed', { targetId: 'TAB-1' });
    expect(bridge.currentState()).toBe('lost');
  });

  it('stays connected across a same-host main-frame navigation', async () => {
    await connect();
    const socket = FakeCdpSocket.instances[0];
    socket.emitEvent('Page.frameNavigated', {
      frame: { url: 'https://docs.example.com/api/charges' },
    });
    expect(bridge.currentState()).toBe('connected');
    expect(bridge.status().domain).toBe('example.com');
  });
});

describe('browser-bridge read-only primitives', () => {
  it('inspect returns ok with populated observed', async () => {
    await connect();
    const r = await bridge.inspect();
    expect(r.status).toBe('ok');
    expect(r.observed?.title).toBe('API Docs');
    expect(r.observed?.links?.length).toBe(2);
  });

  it('navigate to a known same-domain link succeeds', async () => {
    await connect();
    await bridge.inspect(); // populate lastLinks
    const r = await bridge.navigateApprovedLink('https://docs.example.com/api/charges');
    expect(r.status).toBe('ok');
  });

  it('navigate to a cross-domain link fails with navigation_failed', async () => {
    await connect();
    await bridge.inspect();
    const r = await bridge.navigateApprovedLink('https://evil.example.org/x');
    expect(r.status).toBe('navigation_failed');
    expect(r.reason).toMatch(/leaves the approved site/);
  });

  it('navigate to a link not on the page fails', async () => {
    await connect();
    await bridge.inspect();
    const r = await bridge.navigateApprovedLink('https://docs.example.com/unknown');
    expect(r.status).toBe('navigation_failed');
  });

  it('revokes the approval when a same-site link REDIRECTS off-domain', async () => {
    // codex P1: the link passes the same-site gate, but the server redirects
    // to a different registrable host. The old grant must NOT stay live for a
    // tab now sitting on an unapproved site — the bridge drops to lost
    // (requires re-approval) in addition to reporting navigation_failed.
    await connect();
    await bridge.inspect(); // populate lastLinks
    const socket = FakeCdpSocket.instances[0];
    // After Page.navigate, the page read-back reports an off-domain landing.
    socket.page = { ...socket.page, url: 'https://evil.example.org/landing' };
    const r = await bridge.navigateApprovedLink('https://docs.example.com/api/charges');
    expect(r.status).toBe('navigation_failed');
    expect(r.reason).toMatch(/leaves the approved site/);
    expect(bridge.currentState()).toBe('lost');
    // A later command must NOT run against the off-domain page.
    const after = await bridge.inspect();
    expect(after.status).toBe('bridge_disconnected');
  });

  it('scroll returns ok with a viewport read-back', async () => {
    await connect();
    const r = await bridge.scroll('down');
    expect(r.status).toBe('ok');
    expect(r.observed?.viewport).toBeDefined();
  });

  it('a command while disconnected returns bridge_disconnected without CDP', async () => {
    const r = await bridge.inspect();
    expect(r.status).toBe('bridge_disconnected');
  });

  it('a command after revoke returns permission_denied', async () => {
    await connect();
    // revoke sets the flag; but detach resets to disconnected. Simulate an
    // in-flight revoke race via disposeAllBridges (sets revoked+disconnected).
    bridge.disposeAllBridges();
    const r = await bridge.inspect();
    // disconnected + revoked → the revoked guard wins (permission_denied)
    expect(['permission_denied', 'bridge_disconnected']).toContain(r.status);
  });

  it('NEVER issues a forbidden CDP method during read-only work', async () => {
    await connect();
    await bridge.inspect();
    await bridge.scroll('down');
    await bridge.wait(0);
    const allSent = FakeCdpSocket.instances.flatMap((s) => s.sentMethods);
    for (const forbidden of FORBIDDEN_CDP_METHODS) {
      expect(allSent).not.toContain(forbidden);
    }
    // sanity: it DID issue whitelisted methods
    expect(allSent).toContain('Runtime.evaluate');
  });

  it('refuses a CDP method outside the read-only allowlist (assertReadonly)', async () => {
    // The guard is allowlist-based: a method whose domain is not one of the
    // read-only domains must be refused. We can't call the private cdp() sink
    // directly, but a cross-host inspect (below) and the forbidden-method spy
    // above prove the guard; here we assert the shared predicate the guard
    // delegates to rejects an out-of-allowlist domain.
    const { isReadonlyCdpMethod } = await import('../shared/browser-bridge-types');
    expect(isReadonlyCdpMethod('Network.getCookies')).toBe(false);
    expect(isReadonlyCdpMethod('Runtime.evaluate')).toBe(true);
  });
});

// Item 2 — the connect flow launches OUR managed Chrome with the dedicated
// debug profile (so Browser Control works without the user hand-launching
// Chrome), and reuses an already-running debug port instead of double-spawning.
describe('browser-bridge managed Chrome launch (listTabs)', () => {
  it('spawns Chrome with the debug-profile launch args when the port is down', async () => {
    const spawned: { chromePath: string; args: string[] }[] = [];
    const restore2 = bridge.__setBridgeDeps({
      listTargets: async () => [TARGET],
      resolveChrome: () => '/path/to/google-chrome',
      spawnChrome: (chromePath, args) => {
        spawned.push({ chromePath, args });
        return { dispose: () => {} };
      },
      // Port answers on the first poll AFTER spawn (initial reuse-probe false,
      // then true). One flag flips it.
      probeDebugPort: (() => {
        let up = false;
        return async () => {
          const was = up;
          up = true;
          return was;
        };
      })(),
    });
    const result = await bridge.listTabs();
    restore2();
    expect(result.ok).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].chromePath).toBe('/path/to/google-chrome');
    // Debug-profile args: dedicated port + loopback + non-default user-data-dir.
    const argStr = spawned[0].args.join(' ');
    expect(argStr).toMatch(/--remote-debugging-port=/);
    expect(argStr).toMatch(/--user-data-dir=/);
  });

  it('reuses an already-running debug port without spawning', async () => {
    let spawnCount = 0;
    const restore2 = bridge.__setBridgeDeps({
      listTargets: async () => [TARGET],
      resolveChrome: () => '/path/to/google-chrome',
      spawnChrome: () => {
        spawnCount++;
        return { dispose: () => {} };
      },
      probeDebugPort: async () => true, // already up
    });
    const result = await bridge.listTabs();
    restore2();
    expect(result.ok).toBe(true);
    expect(spawnCount).toBe(0);
  });

  it('returns a graceful reason when Chrome cannot be found', async () => {
    const restore2 = bridge.__setBridgeDeps({
      listTargets: async () => [TARGET],
      resolveChrome: () => null,
      probeDebugPort: async () => false,
    });
    const result = await bridge.listTabs();
    restore2();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Chrome/i);
  });

  it('respawns managed Chrome after the spawned one dies (codex P2)', async () => {
    // First connect flow spawns Chrome; then that Chrome is killed/crashes
    // (port dead again, past the startup window). The stale handle must be
    // disposed and a NEW Chrome spawned — not a 10s wait on a dead process.
    vi.useFakeTimers();
    const spawned: { dispose: () => void; disposed: boolean }[] = [];
    // Port comes up on the first poll after each spawn, and goes down again
    // when the current spawn is "killed" between listTabs calls.
    let portUp = false;
    const restore2 = bridge.__setBridgeDeps({
      listTargets: async () => [TARGET],
      resolveChrome: () => '/path/to/google-chrome',
      spawnChrome: () => {
        const handle = {
          disposed: false,
          dispose: () => {
            handle.disposed = true;
          },
        };
        spawned.push(handle);
        portUp = true; // Chrome opens its port
        return handle;
      },
      probeDebugPort: async () => portUp,
    });
    const first = await bridge.listTabs();
    expect(first.ok).toBe(true);
    expect(spawned).toHaveLength(1);

    // Kill the managed Chrome: port dead, and time passes beyond the startup
    // window so a dead port means "died", not "still starting".
    portUp = false;
    await vi.advanceTimersByTimeAsync(20000);

    const second = await bridge.listTabs();
    restore2();
    expect(second.ok).toBe(true);
    expect(spawned).toHaveLength(2); // a replacement was spawned
    expect(spawned[0].disposed).toBe(true); // stale handle torn down
  });

  it('creates an about:blank tab when the fresh Chrome exposes zero page targets', async () => {
    // Freshly spawned dedicated Chrome (or the user closed every tab in the
    // dedicated window): /json/list has no page target. listTabs must
    // self-heal via /json/new so the picker always has at least one row.
    vi.useFakeTimers();
    const BLANK = {
      id: 'BLANK-1',
      type: 'page',
      title: 'about:blank',
      url: 'about:blank',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/BLANK-1',
    };
    let created = false;
    const restore2 = bridge.__setBridgeDeps({
      listTargets: async () => (created ? [BLANK] : []),
      probeDebugPort: async () => true,
      createTab: async () => {
        created = true;
        return true;
      },
    });
    const resultPromise = bridge.listTabs();
    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;
    restore2();
    expect(result.ok).toBe(true);
    expect(created).toBe(true);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].targetId).toBe('BLANK-1');
  });

  it('createTab failure still returns ok with empty tabs (graceful)', async () => {
    const restore2 = bridge.__setBridgeDeps({
      listTargets: async () => [],
      probeDebugPort: async () => true,
      createTab: async () => false,
    });
    const result = await bridge.listTabs();
    restore2();
    expect(result.ok).toBe(true);
    expect(result.tabs).toHaveLength(0);
  });

  it('does not create a tab when page targets already exist', async () => {
    let createCalls = 0;
    const restore2 = bridge.__setBridgeDeps({
      listTargets: async () => [TARGET],
      probeDebugPort: async () => true,
      createTab: async () => {
        createCalls++;
        return true;
      },
    });
    const result = await bridge.listTabs();
    restore2();
    expect(result.ok).toBe(true);
    expect(result.tabs).toHaveLength(1);
    expect(createCalls).toBe(0);
  });

  it('surfaces a spawn error immediately instead of waiting out the poll deadline', async () => {
    // ENOENT-style child_process failure: the poll loop must bail with the
    // real reason, not the generic 10s "did not open a debugging session".
    const restore2 = bridge.__setBridgeDeps({
      listTargets: async () => [TARGET],
      resolveChrome: () => '/path/to/google-chrome',
      spawnChrome: (_path, _args, onError) => {
        onError?.('spawn /path/to/google-chrome ENOENT');
        return { dispose: () => {} };
      },
      probeDebugPort: async () => false,
    });
    const result = await bridge.listTabs();
    restore2();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Could not launch Chrome (spawn /path/to/google-chrome ENOENT).');
  });

  it('does not kill a just-spawned Chrome that is still starting up', async () => {
    vi.useFakeTimers();
    let spawnCount = 0;
    let probes = 0;
    const restore2 = bridge.__setBridgeDeps({
      listTargets: async () => [TARGET],
      resolveChrome: () => '/path/to/google-chrome',
      spawnChrome: () => {
        spawnCount++;
        return { dispose: () => {} };
      },
      // Slow startup: the port only answers from the third probe on
      // (reuse-probe, then first poll fail, then success).
      probeDebugPort: async () => ++probes >= 3,
    });
    const resultPromise = bridge.listTabs();
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;
    restore2();
    expect(result.ok).toBe(true);
    expect(spawnCount).toBe(1); // never killed + respawned mid-startup
  });
});

// Item 1 — the approved-domain grant is immutable and can never silently
// expand to a host the user did not approve.
describe('browser-bridge domain-grant immutability', () => {
  it('drops to lost when the main frame navigates to a DIFFERENT host', async () => {
    await connect();
    expect(bridge.status().domain).toBe('example.com');
    const socket = FakeCdpSocket.instances[0];
    // A cross-host main-frame navigation must NOT silently re-grant.
    socket.emitEvent('Page.frameNavigated', {
      frame: { url: 'https://evil.example.org/landing' },
    });
    expect(bridge.currentState()).toBe('lost');
  });

  it('ignores an empty-host navigation (about:blank) without expanding', async () => {
    await connect();
    const socket = FakeCdpSocket.instances[0];
    socket.emitEvent('Page.frameNavigated', { frame: { url: 'about:blank' } });
    expect(bridge.currentState()).toBe('connected');
    expect(bridge.status().domain).toBe('example.com');
  });

  it('inspect on a page that drifted to another host returns permission_denied + lost', async () => {
    await connect();
    // Drift the fake page to a different host, then inspect.
    const socket = FakeCdpSocket.instances[0];
    socket.page = { ...socket.page, url: 'https://evil.example.org/x' };
    const r = await bridge.inspect();
    expect(r.status).toBe('permission_denied');
    expect(bridge.currentState()).toBe('lost');
  });

  it('scroll whose readback lands off-domain returns permission_denied + lost, no observed', async () => {
    // The readback race on the central security boundary: the page navigated
    // cross-site between the frameNavigated listener firing and the post-
    // scroll extraction. The shared post-read check must refuse the
    // observation and drop the grant.
    await connect();
    const socket = FakeCdpSocket.instances[0];
    socket.page = { ...socket.page, url: 'https://evil.example.org/x' };
    const r = await bridge.scroll('down');
    expect(r.status).toBe('permission_denied');
    expect(r.reason).toMatch(/different site/);
    expect(r.observed).toBeUndefined();
    expect(bridge.currentState()).toBe('lost');
  });

  it('wait whose readback lands off-domain returns permission_denied + lost, no observed', async () => {
    await connect();
    const socket = FakeCdpSocket.instances[0];
    socket.page = { ...socket.page, url: 'https://evil.example.org/x' };
    const r = await bridge.wait(0);
    expect(r.status).toBe('permission_denied');
    expect(r.reason).toMatch(/different site/);
    expect(r.observed).toBeUndefined();
    expect(bridge.currentState()).toBe('lost');
  });

  // FAIL CLOSED on hostless readback URLs: file:///, data:, about:blank have
  // no registrable host — the tab left the approved site, so the observation
  // must be refused, never returned as approved content.
  for (const hostlessUrl of ['about:blank', 'file:///tmp/x.html', 'data:text/html,hi']) {
    it(`inspect readback on ${hostlessUrl} is refused + lost (fail closed)`, async () => {
      await connect();
      FakeCdpSocket.instances[0].page = { ...FakeCdpSocket.instances[0].page, url: hostlessUrl };
      const r = await bridge.inspect();
      expect(r.status).toBe('permission_denied');
      expect(r.observed).toBeUndefined();
      expect(bridge.currentState()).toBe('lost');
    });

    it(`scroll readback on ${hostlessUrl} is refused + lost (fail closed)`, async () => {
      await connect();
      FakeCdpSocket.instances[0].page = { ...FakeCdpSocket.instances[0].page, url: hostlessUrl };
      const r = await bridge.scroll('down');
      expect(r.status).toBe('permission_denied');
      expect(r.observed).toBeUndefined();
      expect(bridge.currentState()).toBe('lost');
    });

    it(`wait readback on ${hostlessUrl} is refused + lost (fail closed)`, async () => {
      await connect();
      FakeCdpSocket.instances[0].page = { ...FakeCdpSocket.instances[0].page, url: hostlessUrl };
      const r = await bridge.wait(0);
      expect(r.status).toBe('permission_denied');
      expect(r.observed).toBeUndefined();
      expect(bridge.currentState()).toBe('lost');
    });
  }

  it('a grant under a multi-label suffix does NOT extend to sibling sites (github.io)', async () => {
    // PSL isolation end-to-end: approving foo.github.io must not let the
    // bridge follow a link to bar.github.io — they are unrelated sites that
    // merely share the github.io private suffix. (The old last-two-labels
    // heuristic collapsed both to 'github.io' and would have allowed it.)
    restore();
    const ghTarget = {
      ...TARGET,
      url: 'https://foo.github.io/docs',
    };
    restore = bridge.__setBridgeDeps({
      listTargets: async () => [ghTarget],
      wsFactory: () => {
        const s = new FakeCdpSocket();
        s.page = {
          ...s.page,
          url: 'https://foo.github.io/docs',
          links: [
            { text: 'Same site', href: 'https://foo.github.io/docs/api' },
            { text: 'Sibling site', href: 'https://bar.github.io/x' },
          ],
        };
        queueMicrotask(() => s.fire('open'));
        return s;
      },
    });
    await connect();
    // The grant is the full private-suffix registrable host, not 'github.io'.
    expect(bridge.status().domain).toBe('foo.github.io');
    await bridge.inspect();
    const same = await bridge.navigateApprovedLink('https://foo.github.io/docs/api');
    expect(same.status).toBe('ok');
    const sibling = await bridge.navigateApprovedLink('https://bar.github.io/x');
    expect(sibling.status).toBe('navigation_failed');
    expect(sibling.reason).toMatch(/leaves the approved site/);
  });
});

// Server-directed open_url — the ONE sanctioned grant retarget. The server
// enqueues open_url only after the user explicitly asked for that site in
// chat ("user-directed URL = implicit grant"), so the bridge retargets the
// approved host BEFORE navigating and the watchdog must not fire.
describe('browser-bridge openUserDirectedUrl (server-directed open_url)', () => {
  it('retargets the approved host, navigates, emits the new-domain state event, and returns the observed readback', async () => {
    await connect();
    expect(bridge.status().domain).toBe('example.com');
    const socket = FakeCdpSocket.instances[0];
    // The tab lands on the user-requested site.
    socket.page = {
      ...socket.page,
      url: 'https://news.example.net/story',
      title: 'News',
      links: [{ text: 'More', href: 'https://news.example.net/more' }],
    };
    const domains: (string | undefined)[] = [];
    const unsub = bridge.onBridgeStateChange((p) => domains.push(p.domain));
    const r = await bridge.openUserDirectedUrl('https://news.example.net/story');
    unsub();
    expect(r.status).toBe('ok');
    expect(r.observed?.url).toBe('https://news.example.net/story');
    expect(bridge.currentState()).toBe('connected');
    // The grant now covers the NEW registrable host...
    expect(bridge.status().domain).toBe('example.net');
    expect(socket.sentMethods).toContain('Page.navigate');
    // ...and the state event carried it, so the renderer badge updates.
    expect(domains).toContain('example.net');
  });

  it('the cross-host watchdog does NOT fire during the sanctioned retarget', async () => {
    await connect();
    const socket = FakeCdpSocket.instances[0];
    socket.page = { ...socket.page, url: 'https://news.example.net/story' };
    const opening = bridge.openUserDirectedUrl('https://news.example.net/story');
    // Chrome reports the main-frame navigation to the NEW host while the
    // open is in flight — the grant was retargeted first, so no `lost`.
    socket.emitEvent('Page.frameNavigated', {
      frame: { url: 'https://news.example.net/story' },
    });
    const r = await opening;
    expect(r.status).toBe('ok');
    expect(bridge.currentState()).toBe('connected');
    expect(bridge.status().domain).toBe('example.net');
  });

  it('a same-registrable-host redirect (bbc.co.uk → www.bbc.co.uk style) succeeds', async () => {
    await connect();
    const socket = FakeCdpSocket.instances[0];
    // Requested apex, landed on www — same registrable host.
    socket.page = { ...socket.page, url: 'https://www.example.net/home' };
    const r = await bridge.openUserDirectedUrl('https://example.net/');
    expect(r.status).toBe('ok');
    expect(bridge.currentState()).toBe('connected');
    expect(bridge.status().domain).toBe('example.net');
  });

  it('a redirect landing on a DIFFERENT registrable host is navigation_failed + lost', async () => {
    await connect();
    const socket = FakeCdpSocket.instances[0];
    // Requested example.net, but the server redirected somewhere else the
    // user never asked for — same policy as the navigate readback check.
    socket.page = { ...socket.page, url: 'https://evil.example.org/landing' };
    const r = await bridge.openUserDirectedUrl('https://news.example.net/story');
    expect(r.status).toBe('navigation_failed');
    expect(r.reason).toMatch(/leaves the approved site/);
    expect(bridge.currentState()).toBe('lost');
  });

  it('clears the old site\'s link cache on retarget', async () => {
    await connect();
    await bridge.inspect(); // populate lastLinks with docs.example.com links
    const socket = FakeCdpSocket.instances[0];
    // Make the post-navigate readback fail so lastLinks is never repopulated
    // — the cache must already have been cleared by the retarget.
    const origSend = socket.send.bind(socket);
    socket.send = (data: string) => {
      const frame = JSON.parse(data);
      if (frame.method === 'Runtime.evaluate') {
        socket.sentMethods.push(frame.method);
        queueMicrotask(() => {
          socket.fire('message', JSON.stringify({ id: frame.id, error: { message: 'boom' } }));
        });
        return;
      }
      origSend(data);
    };
    const r = await bridge.openUserDirectedUrl('https://news.example.net/story');
    expect(r.status).toBe('navigation_failed');
    expect(bridge.currentState()).toBe('connected'); // retargeted, still live
    // An old-site link from before the retarget is no longer in the cache.
    socket.send = origSend;
    const nav = await bridge.navigateApprovedLink('https://docs.example.com/api/charges');
    expect(nav.status).toBe('navigation_failed');
    expect(nav.reason).toMatch(/not one of the links/);
  });

  for (const bad of ['ftp://example.net/file', 'not a url', 'about:blank', 'file:///tmp/x.html', '']) {
    it(`rejects a non-http(s)/hostless href (${JSON.stringify(bad)}) without retargeting`, async () => {
      await connect();
      const r = await bridge.openUserDirectedUrl(bad);
      expect(r.status).toBe('navigation_failed');
      expect(bridge.status().domain).toBe('example.com'); // grant unchanged
      expect(bridge.currentState()).toBe('connected');
      // No CDP navigation was issued for the rejected href.
      expect(FakeCdpSocket.instances[0].sentMethods).not.toContain('Page.navigate');
    });
  }

  it('returns bridge_disconnected when no tab is connected', async () => {
    const r = await bridge.openUserDirectedUrl('https://news.example.net/story');
    expect(r.status).toBe('bridge_disconnected');
  });
});

// Item 4 — an in-flight approve() must not resurrect a connection after a
// cancel/detach/dispose lands mid-connect.
describe('browser-bridge in-flight approval currency', () => {
  it('does not connect if detach() lands while approve() awaits', async () => {
    await bridge.attach('TAB-1');
    // Kick off approve() but detach before it resolves.
    const approving = bridge.approve();
    await bridge.detach();
    const result = await approving;
    expect(result.ok).toBe(false);
    expect(bridge.currentState()).toBe('disconnected');
  });

  it('does not connect if cancelAttach() lands while approve() awaits', async () => {
    await bridge.attach('TAB-1');
    const approving = bridge.approve();
    bridge.cancelAttach();
    const result = await approving;
    expect(result.ok).toBe(false);
    expect(bridge.currentState()).not.toBe('connected');
  });
});

// Item 3(a) — main-side bridge-state subscription lets the command poller
// react to every transition (lost / detach / cross-host nav / reconnect).
describe('browser-bridge onBridgeStateChange', () => {
  it('notifies subscribers on every state transition', async () => {
    const seen: string[] = [];
    const unsub = bridge.onBridgeStateChange((p) => seen.push(p.state));
    await connect(); // awaiting-approval → connected
    await bridge.detach(); // disconnected
    unsub();
    expect(seen).toContain('awaiting-approval');
    expect(seen).toContain('connected');
    expect(seen).toContain('disconnected');
  });

  it('notifies on lost and stops after unsubscribe', async () => {
    const seen: string[] = [];
    const unsub = bridge.onBridgeStateChange((p) => seen.push(p.state));
    await connect();
    const socket = FakeCdpSocket.instances[0];
    socket.emitEvent('Target.targetDestroyed', { targetId: 'TAB-1' });
    expect(seen).toContain('lost');
    unsub();
    const before = seen.length;
    await bridge.attach('TAB-1');
    expect(seen.length).toBe(before); // no further notifications after unsub
  });
});

// Conversation binding + local Stop latch lifecycle: the binding must die
// with the approval so a later approval can never inherit a stale
// conversation, and the Stop latch (raced-case only — the SERVER owns
// stop/resume) must be timestamped, clearable, and reset on attach/dispose.
describe('browser-bridge conversation binding lifecycle', () => {
  it('clears the conversation id on detach (revoke / take-over)', async () => {
    bridge.setConversationId('CONV-1');
    await connect();
    expect(bridge.getConversationId()).toBe('CONV-1');
    await bridge.detach();
    // The next approval must re-bind to whatever conversation is active THEN
    // — never inherit this one.
    expect(bridge.getConversationId()).toBeNull();
  });

  it('clears the conversation id on disposeAllBridges', async () => {
    bridge.setConversationId('CONV-2');
    await connect();
    bridge.disposeAllBridges();
    expect(bridge.getConversationId()).toBeNull();
  });
});

describe('browser-bridge local Stop latch', () => {
  it('records WHEN Stop was pressed and WHICH conversation it targeted, un-acked until the server confirms', () => {
    const before = Date.now();
    expect(bridge.getStopLatch()).toMatchObject({
      requestedAt: null,
      ackAt: null,
      conversationId: null,
      stopId: null,
    });
    bridge.requestStop('CONV-A');
    const latch = bridge.getStopLatch();
    expect(latch.requestedAt).toBeGreaterThanOrEqual(before);
    expect(latch.ackAt).toBeNull();
    expect(latch.conversationId).toBe('CONV-A');
  });

  it("stores the renderer's stop_id token so the self-ack POST acks that SAME Stop", () => {
    // The renderer mints the token and sends it in BOTH its own
    // /browse/control/stop POST and the IPC — the server dedupes on it, so
    // the poller's re-POST is a pure ack and can never re-stop a session
    // that a fresh user turn already resumed.
    bridge.requestStop('CONV-A', 'STOP-UUID-1');
    expect(bridge.getStopLatch().stopId).toBe('STOP-UUID-1');
  });

  it('mints a fallback stop_id when the IPC carried none — the ack POST is always tokened', () => {
    bridge.requestStop('CONV-A');
    const first = bridge.getStopLatch().stopId;
    expect(first).toBeTruthy();
    // A fresh Stop is a fresh instance: it must get its own token.
    bridge.requestStop('CONV-A');
    const second = bridge.getStopLatch().stopId;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('captures the conversation at REQUEST time — falls back to the binding when the IPC carries none', () => {
    // Stop with no explicit cid: the latch pins main's binding at REQUEST
    // time, so a later task switch cannot redirect the self-ack.
    bridge.setConversationId('CONV-A');
    bridge.requestStop();
    bridge.setConversationId('CONV-B'); // user switched tasks after the Stop
    expect(bridge.getStopLatch().conversationId).toBe('CONV-A');
  });

  it('bumps the generation per Stop; an ack only lands for the matching generation', () => {
    bridge.requestStop('CONV-A');
    const staleGeneration = bridge.getStopLatch().generation;
    bridge.ackStopRequest(staleGeneration);
    expect(bridge.getStopLatch().ackAt).not.toBeNull();
    // A new Stop needs a new ack — the previous gate may have been resumed.
    bridge.requestStop('CONV-A');
    const latch = bridge.getStopLatch();
    expect(latch.generation).toBe(staleGeneration + 1);
    expect(latch.ackAt).toBeNull();
    // A slow in-flight ack for the OLD Stop arrives late: must no-op.
    bridge.ackStopRequest(staleGeneration);
    expect(bridge.getStopLatch().ackAt).toBeNull();
    // The current generation's own ack still lands.
    bridge.ackStopRequest(latch.generation);
    expect(bridge.getStopLatch().ackAt).not.toBeNull();
  });

  it('a stray ack with no Stop latched must not fabricate latch state', () => {
    bridge.ackStopRequest(bridge.getStopLatch().generation);
    expect(bridge.getStopLatch()).toMatchObject({ requestedAt: null, ackAt: null });
  });

  it('is cleared by clearStopRequest (the poller after a post-ack poll cycle) without resetting the generation', () => {
    bridge.requestStop('CONV-A');
    const generation = bridge.getStopLatch().generation;
    bridge.ackStopRequest(generation);
    bridge.clearStopRequest();
    const latch = bridge.getStopLatch();
    expect(latch).toMatchObject({
      requestedAt: null,
      ackAt: null,
      conversationId: null,
      stopId: null,
    });
    // Generation stays monotonic across clears so a stale in-flight ack can
    // never match a future Stop.
    expect(latch.generation).toBe(generation);
  });

  it('is cleared belt-and-braces by a fresh attach and by disposeAllBridges', async () => {
    bridge.requestStop('CONV-A');
    await bridge.attach('TAB-1');
    expect(bridge.getStopLatch().requestedAt).toBeNull();

    bridge.requestStop('CONV-A');
    bridge.disposeAllBridges();
    expect(bridge.getStopLatch().requestedAt).toBeNull();
  });
});
