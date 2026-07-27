import { describe, it, expect, vi } from 'vitest';

// minds-auth transitively imports server-process, which statically imports
// `electron`. In the node test env `electron` resolves to a path string, so
// stub it before importing the module under test.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test', isPackaged: false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {},
}));

import { shouldRenewKey } from './minds-auth';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-27T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

// ─── ENG-498: renewal decision ───────────────────────────────────────
//
// The window is derived from the key's own created/expiry_date (renew when
// under 25% of lifetime remains) so the client stays correct whatever TTL
// value ops picks server-side, with no client config knob.
describe('shouldRenewKey', () => {
  it('never renews a key with no expiry (TTL disabled — the current world)', () => {
    expect(shouldRenewKey(iso(NOW - 30 * DAY_MS), null, NOW)).toBe(false);
    expect(shouldRenewKey(iso(NOW - 30 * DAY_MS), undefined, NOW)).toBe(false);
  });

  it('does not renew far from expiry (90-day key, 60 days left)', () => {
    expect(shouldRenewKey(iso(NOW - 30 * DAY_MS), iso(NOW + 60 * DAY_MS), NOW)).toBe(false);
  });

  it('renews inside the 25% window (90-day key, 20 days left)', () => {
    expect(shouldRenewKey(iso(NOW - 70 * DAY_MS), iso(NOW + 20 * DAY_MS), NOW)).toBe(true);
  });

  it('does not renew exactly at the 25% boundary (90-day key, 22.5 days left)', () => {
    // Strict less-than: the boundary itself is "still ok" — pins the
    // comparison so a refactor to <= is caught.
    expect(shouldRenewKey(iso(NOW - 67.5 * DAY_MS), iso(NOW + 22.5 * DAY_MS), NOW)).toBe(false);
  });

  it('renews an already-expired key (heal after sleep/backfill)', () => {
    expect(shouldRenewKey(iso(NOW - 100 * DAY_MS), iso(NOW - 1 * DAY_MS), NOW)).toBe(true);
    expect(shouldRenewKey(iso(NOW - 100 * DAY_MS), iso(NOW), NOW)).toBe(true);
  });

  it('falls back to a 14-day window when created is missing or unparseable', () => {
    expect(shouldRenewKey(null, iso(NOW + 10 * DAY_MS), NOW)).toBe(true);
    expect(shouldRenewKey('not-a-date', iso(NOW + 10 * DAY_MS), NOW)).toBe(true);
    expect(shouldRenewKey(null, iso(NOW + 20 * DAY_MS), NOW)).toBe(false);
  });

  it('falls back to the 14-day window when created >= expiry (nonsense lifetime)', () => {
    expect(shouldRenewKey(iso(NOW + 20 * DAY_MS), iso(NOW + 10 * DAY_MS), NOW)).toBe(true);
  });

  it('never renews on an unparseable expiry', () => {
    expect(shouldRenewKey(iso(NOW - 30 * DAY_MS), 'garbage', NOW)).toBe(false);
  });
});
