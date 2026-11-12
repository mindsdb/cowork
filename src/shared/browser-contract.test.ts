import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  BRIDGE_ERROR_STATUS,
  BRIDGE_URL_PATTERN,
  type BridgeErrorCode,
  bridgeUrl,
  electronHostsInAppBrowser,
  ELEMENTS_PER_FRAME,
  FRAME_MIN_READ_PX,
  FRAMES_READ,
  MAX_CONTROL_REASON,
  MAX_SAVED_TABS_PER_PROJECT,
  MIN_IN_APP_BROWSER_ELECTRON_MAJOR,
  parseControlRequest,
  parseNewTab,
  parseNoteSite,
  parseOpenSession,
  parseSaveTab,
  parseStageBounds,
  parseStepRequest,
  PAYMENT_FRAME_HOSTS,
  SESSION_ID_PATTERN,
  SETTLE_MAX_MS,
  SETTLE_QUIET_MS,
  SIGN_IN_FRAME_HOSTS,
  TEXT_PER_FRAME,
  type Parsed,
} from './browser-contract';
import {
  errorShape,
  type FixtureExample,
  type FixtureFile,
  problems,
  RESPONSE_SHAPES,
} from '../../tests/browser-contract-shapes';

const FIXTURES = path.resolve(__dirname, '../main/__fixtures__/browser-contract');

function fixtures(): Array<[string, string, FixtureExample]> {
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.json'))
    .flatMap((file) => {
      const parsed = JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf-8')) as FixtureFile;
      return Object.entries(parsed.examples).map(([name, example]): [string, string, FixtureExample] => [file, name, example]);
    });
}

/* Which guard checks each request, keyed by the fixture's `where`. */
const REQUEST_GUARDS: Record<string, (body: unknown) => Parsed<unknown>> = {
  'POST /sessions': parseOpenSession,
  'POST /sessions/{id}/action': parseStepRequest,
  'POST /sessions/{id}/control': parseControlRequest,
  'POST /sessions/{id}/tabs': parseNewTab,
  'POST /sessions/{id}/sites': parseNoteSite,
  'POST /saved-tabs': parseSaveTab,
};

/* Codes only the browser router or the web pod answers. The in-app host never
   sends them: it scopes no turn keys, checks no entitlement or allowance,
   starts no pod, holds no commit step and caps no calls in flight. anton maps
   each to its own reason. */
const ROUTER_ONLY = [
  'unscoped', 'out_of_scope', 'not_entitled', 'daily_limit', 'entitlements_unavailable',
  'browser_starting', 'approval_required', 'too_many_requests', 'tab_limit',
];

describe('the browser contract fixtures', () => {
  const all = fixtures();

  it('are all here', () => {
    expect(readdirSync(FIXTURES).filter((name) => name.endsWith('.json')).sort()).toEqual([
      'action.json', 'browser_config.json', 'commit_steps.json', 'control.json', 'error.json',
      'page.json', 'saved_tabs.json', 'session_event.json', 'sessions.json', 'sites.json', 'tabs.json',
    ]);
  });

  it("caps a project's saved tabs at the contract's number", () => {
    const savedTabs = JSON.parse(readFileSync(path.join(FIXTURES, 'saved_tabs.json'), 'utf-8')) as FixtureFile;
    expect(savedTabs.limits?.saved_tabs_per_project).toBe(MAX_SAVED_TABS_PER_PROJECT);
  });

  it("settles a step at the contract's numbers", () => {
    const action = JSON.parse(readFileSync(path.join(FIXTURES, 'action.json'), 'utf-8')) as FixtureFile;
    expect(action.limits).toEqual({ settle_max_ms: SETTLE_MAX_MS, settle_quiet_ms: SETTLE_QUIET_MS });
  });

  it("reads a page's frames at the contract's numbers, and never on its payment or sign-in hosts", () => {
    const page = JSON.parse(readFileSync(path.join(FIXTURES, 'page.json'), 'utf-8')) as FixtureFile;
    expect(page.limits).toEqual({
      frames_read: FRAMES_READ,
      elements_per_frame: ELEMENTS_PER_FRAME,
      text_per_frame: TEXT_PER_FRAME,
      frame_min_read_px: FRAME_MIN_READ_PX,
      payment_frame_hosts: [...PAYMENT_FRAME_HOSTS],
      sign_in_frame_hosts: [...SIGN_IN_FRAME_HOSTS],
      // For a host that reads frames apart from the page's own read; this one
      // reads them inside it, within PAGE_READ_TIMEOUT_MS.
      frames_phase_ms: expect.any(Number),
    });
  });

  it.each(all.filter(([, , e]) => e.kind === 'request'))('%s "%s": the request guard agrees', (_file, _name, example) => {
    const guard = REQUEST_GUARDS[example.where];
    expect(guard, `no guard for ${example.where}`).toBeDefined();
    expect(guard(example.body).ok).toBe(!example.refused);
  });

  it("reads into_frame on the fixture's one step the person approved into a frame, and on no other step", () => {
    const steps = all.filter(([file, , e]) => file === 'action.json' && e.kind === 'request');
    const approved = steps.filter(([, , e]) => 'into_frame' in (e.body as Record<string, unknown>)).map(([, name]) => name);
    expect(approved).toHaveLength(1);
    for (const [, name, example] of steps) {
      expect(parseStepRequest(example.body), name).toMatchObject({ ok: true, value: { intoFrame: approved.includes(name) } });
    }
  });

  it('refuses the take-back as person_only, not as a bad request', () => {
    const refused = parseControlRequest({ holder: 'agent', reason: '' });
    expect(refused).toMatchObject({ ok: false, personOnly: true });
    expect(parseControlRequest({ holder: 'nobody' })).not.toHaveProperty('personOnly');
  });

  it('refuses a hand-over reason over 300 characters instead of cutting it', () => {
    expect(MAX_CONTROL_REASON).toBe(300);
    const longest = 'r'.repeat(MAX_CONTROL_REASON);
    expect(parseControlRequest({ holder: 'human', reason: longest })).toEqual({ ok: true, value: { holder: 'human', reason: longest } });
    expect(parseControlRequest({ holder: 'human', reason: `${longest}r` })).toEqual({ ok: false, message: 'reason must be a string of at most 300 characters' });
  });

  it.each(all.filter(([file, , e]) => e.kind === 'response' && file !== 'error.json'))(
    '%s "%s": the answer fits its shape',
    (_file, _name, example) => {
      const check = RESPONSE_SHAPES[example.where];
      expect(check, `no shape for ${example.where}`).toBeDefined();
      expect(problems(check, example.body)).toEqual([]);
    },
  );

  it.each(all.filter(([file]) => file === 'error.json'))('error "%s" is {error, message}', (_file, name, example) => {
    expect(problems(errorShape, example.body)).toEqual([]);
    expect((example.body as { error: string }).error).toBe(name);
    if (ROUTER_ONLY.includes(name)) return;
    expect(BRIDGE_ERROR_STATUS[name as BridgeErrorCode], `${name} has no status here`).toBe(example.status);
  });

  it('names the router-only codes that the in-app host never sends', () => {
    const named = all.filter(([file]) => file === 'error.json').map(([, name]) => name);
    expect(named.filter((name) => !(name in BRIDGE_ERROR_STATUS)).sort()).toEqual([...ROUTER_ONLY].sort());
  });

  it("matches the in-app browser's address to anton's in-app form", () => {
    const constructors = all.filter(([, , e]) => e.kind === 'constructor');
    for (const [, name, example] of constructors) {
      const baseUrl = (example.body as { base_url: string }).base_url;
      const inApp = baseUrl.startsWith('http:') && !(name.includes('localhost') || name.includes('without its key'));
      if (inApp) expect(baseUrl, name).toMatch(BRIDGE_URL_PATTERN);
    }
    expect(bridgeUrl(51234)).toMatch(BRIDGE_URL_PATTERN);
    expect('http://localhost:51234').not.toMatch(BRIDGE_URL_PATTERN);
  });

  it("keeps the session event's id in the pattern the pane accepts", () => {
    const events = all.filter(([, , e]) => e.kind === 'event');
    expect(events).toHaveLength(1);
    expect((events[0][2].body as { session_id: string }).session_id).toMatch(SESSION_ID_PATTERN);
  });

  it('has a check for every example', () => {
    const unchecked = all.filter(([file, , e]) => {
      if (e.kind === 'request') return !(e.where in REQUEST_GUARDS);
      if (e.kind === 'response') return file !== 'error.json' && !(e.where in RESPONSE_SHAPES);
      // The commit list is the web pod's to enforce; the desktop holds no
      // step, so its examples are kept, not checked here.
      return !['turn_block', 'constructor', 'event', 'classification'].includes(e.kind);
    });
    expect(unchecked.map(([file, name]) => `${file}: ${name}`)).toEqual([]);
  });
});

describe('step requests', () => {
  it('reads a point over an element', () => {
    const parsed = parseStepRequest({ action: 'click', element: 3, x: 10, y: 20, coords: 'screenshot' });
    expect(parsed).toEqual({
      ok: true,
      value: { step: { action: 'click', target: { x: 10, y: 20 }, button: 'left', clicks: 1 }, coords: 'screenshot', includePage: false, intoFrame: false },
    });
  });

  it('reads into_frame, which anton sends true only for a step the person approved to land in a frame, and takes anything else as false', () => {
    expect(parseStepRequest({ action: 'click', x: 10, y: 20, into_frame: true })).toMatchObject({ ok: true, value: { intoFrame: true } });
    for (const into_frame of [undefined, false, 'true', 1, null]) {
      expect(parseStepRequest({ action: 'click', x: 10, y: 20, into_frame }), String(into_frame)).toMatchObject({ ok: true, value: { intoFrame: false } });
    }
  });

  it.each([
    [{ action: 'click', element: '7' }, 'a string id'],
    [{ action: 'click', element: 0 }, 'id 0'],
    [{ action: 'click', element: 1.5 }, 'a fraction'],
    [{ action: 'type', element: 1 }, 'no text'],
    [{ action: 'navigate', url: 'file:///etc/passwd' }, 'a file URL'],
    [{ action: 'navigate', url: 'javascript:alert(1)' }, 'a javascript URL'],
    [{ action: 'navigate', url: 'data:text/html,hi' }, 'a data URL'],
    [{ action: 'navigate', url: 'chrome://settings' }, 'a chrome URL'],
    [{ action: 'click', element: 1, clicks: 4 }, 'four clicks'],
    [{ action: 'scroll', direction: 'sideways' }, 'a bad direction'],
    [{ action: 'eval', code: '1' }, 'an unknown action'],
    [{ action: 'click', element: 1, coords: 'window' }, 'unknown coords'],
    [{ action: 'drag', from: { element: 1 } }, 'a drag with no end'],
  ] as Array<[Record<string, unknown>, string]>)('refuses %j (%s)', (body) => {
    expect(parseStepRequest(body).ok).toBe(false);
  });

  it('allows the LAN and caps a wait', () => {
    expect(parseStepRequest({ action: 'navigate', url: 'http://192.168.1.10:8080/admin' }).ok).toBe(true);
    expect(parseStepRequest({ action: 'wait', ms: 600_000 })).toMatchObject({ ok: true, value: { step: { ms: 30_000 } } });
  });

  it('refuses a deeply nested action without serializing it', () => {
    let action: unknown = 1;
    for (let i = 0; i < 200_000; i += 1) action = [action];
    const parsed = parseStepRequest({ action });
    expect(parsed).toMatchObject({ ok: false });
    expect(parsed.ok ? '' : parsed.message).toContain('of type object');
  });
});

describe('stage bounds', () => {
  it('accepts a rectangle and refuses anything else', () => {
    expect(parseStageBounds({ x: 1, y: 2, width: 300, height: 400 })).toEqual({ x: 1, y: 2, width: 300, height: 400 });
    expect(parseStageBounds({ x: -1, y: 2, width: 300, height: 400 })).toBeNull();
    expect(parseStageBounds({ x: 1, y: 2, width: Number.NaN, height: 400 })).toBeNull();
    expect(parseStageBounds({ x: 1, y: 2, width: 300 })).toBeNull();
    expect(parseStageBounds(null)).toBeNull();
  });
});

describe('the Electron floor for the in-app browser', () => {
  it('never drops under Electron 44', () => {
    expect(MIN_IN_APP_BROWSER_ELECTRON_MAJOR).toBeGreaterThanOrEqual(44);
  });

  it('refuses an unsupported or unknown Electron and takes 44 and later', () => {
    for (const version of ['39.8.10', '43.9.9', '4.4.0', '', 'v45.0.0', undefined]) {
      expect(electronHostsInAppBrowser(version)).toBe(false);
    }
    for (const version of ['44.0.0', '45.0.1', '46.0.0-beta.1']) {
      expect(electronHostsInAppBrowser(version)).toBe(true);
    }
  });
});
