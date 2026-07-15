import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

// Browser Control funnel analytics (WS5-T1). We assert the events are
// content-free: only host-only domain, os, and the shared id set — never
// page text, full URLs, paths, queries, cookies, or form values.

vi.mock('../../platform/host', () => ({
  host: { isElectron: true, isWeb: false },
  default: { isElectron: true, isWeb: false },
}));

// POSTHOG_KEY is read from import.meta.env at module-eval time, and capture()
// self-gates to a no-op without it. Stub a token, then import the module
// dynamically so the const picks it up.
let domainOf;
let trackBrowserBridgeConnected;
let trackBrowserTabApproved;
let trackBrowserBridgeReconnected;
let trackBrowserTaskStarted;
let trackBrowserTaskSucceeded;
let trackBrowserTaskFailed;
let trackBrowserTaskStopped;
let trackBrowserTaskTakeover;
let trackBrowserResultTime;

beforeAll(async () => {
  vi.stubEnv('VITE_POSTHOG_MINDSHUB_MAIN_PROJECT_TOKEN', 'phc_test_key');
  const mod = await import('./analytics');
  domainOf = mod.domainOf;
  trackBrowserBridgeConnected = mod.trackBrowserBridgeConnected;
  trackBrowserTabApproved = mod.trackBrowserTabApproved;
  trackBrowserBridgeReconnected = mod.trackBrowserBridgeReconnected;
  trackBrowserTaskStarted = mod.trackBrowserTaskStarted;
  trackBrowserTaskSucceeded = mod.trackBrowserTaskSucceeded;
  trackBrowserTaskFailed = mod.trackBrowserTaskFailed;
  trackBrowserTaskStopped = mod.trackBrowserTaskStopped;
  trackBrowserTaskTakeover = mod.trackBrowserTaskTakeover;
  trackBrowserResultTime = mod.trackBrowserResultTime;
});

// Capture the outbound PostHog request bodies so we can inspect properties.
let posts;

beforeEach(() => {
  posts = [];
  // A truthy POSTHOG_KEY is required for capture() to emit; force one and a
  // non-CI session by stubbing fetch + the query string.
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    posts.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 200 };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('domainOf', () => {
  it('reduces a full URL to its registrable host, dropping path/query/fragment', () => {
    expect(domainOf('https://shop.example.com/orders/42?token=secret#frag')).toBe('shop.example.com');
  });

  it('tolerates a bare host with no scheme', () => {
    expect(domainOf('example.com')).toBe('example.com');
  });

  it('strips userinfo and port', () => {
    expect(domainOf('https://user:pass@example.com:8443/path')).toBe('example.com');
  });

  it('returns empty string for empty / unparseable input', () => {
    expect(domainOf('')).toBe('');
    expect(domainOf(null)).toBe('');
    expect(domainOf(undefined)).toBe('');
  });
});

// Only these keys are ever allowed on a browser funnel event's custom props.
// capture() adds infra props (surface, is_internal, $lib, device_id) — those
// are audited separately; here we assert no CONTENT leaks in.
const FORBIDDEN_KEYS = ['text', 'url', 'href', 'path', 'query', 'title', 'cookie', 'value', 'selector'];

function lastEventProps() {
  // capture() is fire-and-forget; the fetch stub runs synchronously in the
  // promise microtask, so flush once.
  return posts.length ? posts[posts.length - 1].body : null;
}

describe('Browser Control funnel events', () => {
  it('bridge connected carries funnel + os + ids, no content', async () => {
    trackBrowserBridgeConnected('darwin', {
      installationId: 'aabbccddeeff0011',
      sessionId: 'sess-1',
      taskId: 'task-1',
    });
    await vi.waitFor(() => expect(lastEventProps()).toBeTruthy());
    const evt = lastEventProps();
    expect(evt.event).toBe('browser_bridge_connected');
    const p = evt.properties;
    expect(p.funnel).toBe('browser_control_m1');
    expect(p.os).toBe('darwin');
    expect(p.installation_id).toBe('aabbccddeeff0011');
    expect(p.session_id).toBe('sess-1');
    expect(p.task_id).toBe('task-1');
    for (const k of FORBIDDEN_KEYS) expect(p).not.toHaveProperty(k);
  });

  it('tab approved carries a host-only domain (never a full URL)', async () => {
    posts = [];
    trackBrowserTabApproved('https://shop.example.com/account/settings?x=1', {
      installationId: 'aabbccddeeff0011',
    });
    await vi.waitFor(() => expect(lastEventProps()).toBeTruthy());
    const p = lastEventProps().properties;
    expect(lastEventProps().event).toBe('browser_tab_approved');
    expect(p.domain).toBe('shop.example.com');
    expect(p.domain).not.toContain('/');
    expect(p.domain).not.toContain('?');
    for (const k of FORBIDDEN_KEYS) expect(p).not.toHaveProperty(k);
  });

  it('bridge reconnected reuses ids and stays content-free', async () => {
    posts = [];
    trackBrowserBridgeReconnected('win32', { taskId: 'task-1' });
    await vi.waitFor(() => expect(lastEventProps()).toBeTruthy());
    const evt = lastEventProps();
    expect(evt.event).toBe('browser_bridge_reconnected');
    expect(evt.properties.os).toBe('win32');
    expect(evt.properties.task_id).toBe('task-1');
    for (const k of FORBIDDEN_KEYS) expect(evt.properties).not.toHaveProperty(k);
  });

  it('omits undefined ids rather than sending empty dimensions', async () => {
    posts = [];
    trackBrowserBridgeConnected('linux', {});
    await vi.waitFor(() => expect(lastEventProps()).toBeTruthy());
    const p = lastEventProps().properties;
    expect(p).not.toHaveProperty('installation_id');
    expect(p).not.toHaveProperty('session_id');
    expect(p).not.toHaveProperty('task_id');
    expect(p).not.toHaveProperty('action_id');
  });
});

describe('Browser Control task lifecycle events (WS5-T2)', () => {
  it('task started is content-free with the funnel tag', async () => {
    posts = [];
    trackBrowserTaskStarted({ taskId: 'task-1' });
    await vi.waitFor(() => expect(lastEventProps()).toBeTruthy());
    const evt = lastEventProps();
    expect(evt.event).toBe('browser_task_started');
    expect(evt.properties.funnel).toBe('browser_control_m1');
    expect(evt.properties.task_id).toBe('task-1');
    for (const k of FORBIDDEN_KEYS) expect(evt.properties).not.toHaveProperty(k);
  });

  it('task succeeded carries a numeric action_count', async () => {
    posts = [];
    trackBrowserTaskSucceeded(3, { taskId: 'task-1' });
    await vi.waitFor(() => expect(lastEventProps()).toBeTruthy());
    const evt = lastEventProps();
    expect(evt.event).toBe('browser_task_succeeded');
    expect(evt.properties.action_count).toBe(3);
  });

  it('task failed carries the typed error_code enum only', async () => {
    posts = [];
    trackBrowserTaskFailed('navigation_failed', { taskId: 'task-1' });
    await vi.waitFor(() => expect(lastEventProps()).toBeTruthy());
    const evt = lastEventProps();
    expect(evt.event).toBe('browser_task_failed');
    expect(evt.properties.error_code).toBe('navigation_failed');
    for (const k of FORBIDDEN_KEYS) expect(evt.properties).not.toHaveProperty(k);
  });

  it('result time carries a rounded, non-negative duration_ms', async () => {
    posts = [];
    trackBrowserResultTime(1499.6, { taskId: 'task-1' });
    await vi.waitFor(() => expect(lastEventProps()).toBeTruthy());
    const evt = lastEventProps();
    expect(evt.event).toBe('browser_result_time');
    expect(evt.properties.duration_ms).toBe(1500);
  });

  it('stop and takeover are distinct events (mutually exclusive by name)', async () => {
    posts = [];
    trackBrowserTaskStopped({ taskId: 'task-1' });
    await vi.waitFor(() => expect(lastEventProps()).toBeTruthy());
    expect(lastEventProps().event).toBe('browser_task_stopped');

    posts = [];
    trackBrowserTaskTakeover({ taskId: 'task-1' });
    await vi.waitFor(() => expect(lastEventProps()).toBeTruthy());
    expect(lastEventProps().event).toBe('browser_task_takeover');
  });
});
