import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveAppKey, liveAppLines, liveAppStateLine, liveAppStatesFrom, liveAppViewerNotice } from './liveAppState';

const running = {
  projectId: 'p1', slug: 'table-counts', slot: 1, state: 'running',
  address: 'http://app1.view.localhost:8080/', startedAt: '2026-10-21T10:00:00Z',
  stoppedAt: null, stopReason: null, stopReasonText: null,
};
const stopped = {
  ...running, slug: 'orders', state: 'stopped',
  stoppedAt: '2026-10-21T12:04:00Z', stopReason: 'idle', stopReasonText: 'no requests for 2 h',
};
// The same UTC day as `stopped`, so its line carries no date.
const NOW = new Date('2026-10-21T15:00:00Z');

describe('liveAppStatesFrom', () => {
  it('keys each app by project and slug', () => {
    const states = liveAppStatesFrom([running, stopped]);
    expect(states.get(liveAppKey('p1', 'table-counts'))).toMatchObject({ state: 'running', address: running.address });
    expect(states.get(liveAppKey('p1', 'orders'))).toMatchObject({ state: 'stopped', stopReasonText: 'no requests for 2 h' });
  });

  it('reads the null fields the server sends as empty', () => {
    expect(liveAppStatesFrom([{ ...stopped, stoppedAt: null, stopReasonText: null }]).get(liveAppKey('p1', 'orders')))
      .toMatchObject({ stoppedAt: '', stopReasonText: '' });
  });

  it('leaves out entries no card can match or in a state it does not know', () => {
    const states = liveAppStatesFrom([
      { ...running, projectId: '' },
      { ...running, slug: null },
      { ...running, slug: 'other', state: 'starting' },
    ]);
    expect(states.size).toBe(0);
  });

  it('reads anything but a list as no apps', () => {
    expect(liveAppStatesFrom({ detail: 'Not Found' }).size).toBe(0);
    expect(liveAppStatesFrom(null).size).toBe(0);
  });
});

describe('liveAppStateLine', () => {
  const lineOf = (item, now = NOW) => liveAppStateLine(liveAppStatesFrom([item]).values().next().value, { now });

  it("names a running app's address with its port, as a person types it", () => {
    expect(lineOf(running)).toBe('Live at app1.view.localhost:8080');
  });

  it('says when a stopped app stopped, in UTC, why, and what to do', () => {
    expect(lineOf(stopped)).toBe('Stopped 12:04 UTC, no requests for 2 h. Ask your agent to relaunch it.');
  });

  it('names the day of a stop before today', () => {
    expect(lineOf({ ...stopped, stoppedAt: '2026-10-19T12:04:00Z' }))
      .toBe('Stopped 19 Oct 12:04 UTC, no requests for 2 h. Ask your agent to relaunch it.');
  });

  it('compares UTC dates, not the last 24 hours', () => {
    expect(lineOf({ ...stopped, stoppedAt: '2026-10-20T23:30:00Z' }, new Date('2026-10-21T00:10:00Z')))
      .toBe('Stopped 20 Oct 23:30 UTC, no requests for 2 h. Ask your agent to relaunch it.');
  });

  it('writes the month as the server does, "Sep" and not "Sept"', () => {
    expect(lineOf({ ...stopped, stoppedAt: '2026-09-19T12:04:00Z' }))
      .toBe('Stopped 19 Sep 12:04 UTC, no requests for 2 h. Ask your agent to relaunch it.');
  });

  it('still explains a stop the server gave no reason or time for', () => {
    expect(lineOf({ ...stopped, stopReasonText: null })).toBe('Stopped 12:04 UTC. Ask your agent to relaunch it.');
    expect(lineOf({ ...stopped, stoppedAt: null, stopReasonText: null })).toBe('Stopped. Ask your agent to relaunch it.');
    expect(lineOf({ ...stopped, stoppedAt: 'not a time', stopReasonText: '' })).toBe('Stopped. Ask your agent to relaunch it.');
  });

  it('says only "Live" for a running app with no readable address', () => {
    expect(lineOf({ ...running, address: '' })).toBe('Live');
  });

  it('has no line for an app with no launch on record', () => {
    expect(liveAppStateLine(undefined)).toBe(null);
  });
});

describe('liveAppStateLine outside UTC', () => {
  /*
   * The suite pins TZ=UTC (tests/setup-env.ts), which hides a line formatted
   * in the browser's zone. The formatters are built when the module loads, so
   * load it fresh under another zone.
   */
  const savedTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = savedTz;
    vi.resetModules();
  });

  const lineIn = async (zone, stoppedAt, now = NOW) => {
    process.env.TZ = zone;
    vi.resetModules();
    const fresh = await import('./liveAppState');
    const state = fresh.liveAppStatesFrom([{ ...stopped, stoppedAt }]).get(fresh.liveAppKey('p1', 'orders'));
    return fresh.liveAppStateLine(state, { now });
  };

  it('gives the stop in UTC for a person in another zone', async () => {
    expect(await lineIn('America/Los_Angeles', '2026-10-21T12:04:00Z'))
      .toBe('Stopped 12:04 UTC, no requests for 2 h. Ask your agent to relaunch it.');
  });

  it("decides 'today' by the UTC date, not the person's local date", async () => {
    // 02:00 UTC on the 21st is still the 20th in Los Angeles.
    expect(await lineIn('America/Los_Angeles', '2026-10-21T02:00:00Z'))
      .toBe('Stopped 02:00 UTC, no requests for 2 h. Ask your agent to relaunch it.');
    // 03:00 UTC on the 19th is the 18th in Los Angeles.
    expect(await lineIn('America/Los_Angeles', '2026-10-19T03:00:00Z'))
      .toBe('Stopped 19 Oct 03:00 UTC, no requests for 2 h. Ask your agent to relaunch it.');
  });
});

describe('liveAppLines', () => {
  const states = liveAppStatesFrom([running]);
  const card = { type: 'fullstack-stateless-app', projectId: 'p1', slug: 'table-counts', receivedFrom: { email: 'ana@example.com' } };

  it("gives a full-stack card its state and whom it came from", () => {
    expect(liveAppLines(card, { liveApps: true, states })).toEqual({
      state: 'Live at app1.view.localhost:8080',
      received: 'Duplicated from ana@example.com',
    });
  });

  it('gives nothing with live apps off, or to a card that is not a full-stack app', () => {
    expect(liveAppLines(card, { liveApps: false, states })).toBe(null);
    expect(liveAppLines({ ...card, type: 'html-app' }, { liveApps: true, states })).toBe(null);
  });
});

describe('liveAppViewerNotice', () => {
  const ready = (item) => ({ status: 'ready', state: item && liveAppStatesFrom([item]).values().next().value });

  it('names a running app\'s address, and that is what the viewer opens', () => {
    expect(liveAppViewerNotice(ready(running), { now: NOW })).toEqual({
      address: 'http://app1.view.localhost:8080/',
      text: 'This live app runs at its own address.',
      canLaunch: false,
    });
  });

  it('says a stopped app is stopped, when, why and what to do, as its card does, with nothing to open', () => {
    expect(liveAppViewerNotice(ready(stopped), { now: NOW })).toEqual({
      address: '',
      text: 'Stopped 12:04 UTC, no requests for 2 h. Ask your agent to relaunch it.',
      canLaunch: true,
    });
  });

  it('says an app with no launch on record is not running, and how to launch it', () => {
    expect(liveAppViewerNotice(ready(undefined))).toEqual({
      address: '',
      text: "This live app isn't running. Ask your agent to launch it.",
      canLaunch: true,
    });
  });

  it('opens only an http(s) address', () => {
    for (const address of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url', '']) {
      expect(liveAppViewerNotice(ready({ ...running, address }))).toEqual({
        address: '',
        text: 'This live app is running. Ask your agent for its address.',
        canLaunch: false,
      });
    }
  });

  it("says it couldn't check when the read failed, never that the app isn't running", () => {
    expect(liveAppViewerNotice({ status: 'failed' })).toEqual({
      address: '',
      text: "Couldn't check whether this app is running. Reload to try again.",
      canLaunch: false,
    });
  });

  it('has nothing to show before the read answers', () => {
    expect(liveAppViewerNotice({ status: 'loading' })).toBe(null);
    expect(liveAppViewerNotice({ status: 'off' })).toBe(null);
  });
});
