import { describe, expect, it } from 'vitest';
import { liveAppKey, liveAppStateLine, liveAppStatesFrom } from './liveAppState';

const running = {
  projectId: 'p1', slug: 'table-counts', slot: 1, state: 'running',
  address: 'http://app1.view.localhost:8080/', startedAt: '2026-10-21T10:00:00Z',
  stoppedAt: null, stopReason: null, stopReasonText: null,
};
const stopped = {
  ...running, slug: 'orders', state: 'stopped',
  stoppedAt: '2026-10-21T12:04:00Z', stopReason: 'idle', stopReasonText: 'no requests for 2 h',
};

describe('liveAppStatesFrom', () => {
  it('keys each app by project and slug', () => {
    const states = liveAppStatesFrom([running, stopped]);
    expect(states.get(liveAppKey('p1', 'table-counts'))).toMatchObject({ state: 'running', address: running.address });
    expect(states.get(liveAppKey('p1', 'orders'))).toMatchObject({ state: 'stopped', stopReasonText: 'no requests for 2 h' });
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
  const lineOf = (item) => liveAppStateLine(liveAppStatesFrom([item]).values().next().value);

  it("names a running app's own address", () => {
    expect(lineOf(running)).toBe('Live at app1.view.localhost');
  });

  it('says when a stopped app stopped, why, and what to do', () => {
    expect(lineOf(stopped)).toBe('Stopped 12:04, no requests for 2 h. Ask your agent to relaunch it.');
  });

  it('still explains a stop the server gave no reason or time for', () => {
    expect(lineOf({ ...stopped, stopReasonText: '' })).toBe('Stopped 12:04. Ask your agent to relaunch it.');
    expect(lineOf({ ...stopped, stoppedAt: 'not a time', stopReasonText: '' })).toBe('Stopped. Ask your agent to relaunch it.');
  });

  it('says only "Live" for a running app with no readable address', () => {
    expect(lineOf({ ...running, address: '' })).toBe('Live');
  });

  it('has no line for an app with no launch on record', () => {
    expect(liveAppStateLine(undefined)).toBe(null);
  });
});
