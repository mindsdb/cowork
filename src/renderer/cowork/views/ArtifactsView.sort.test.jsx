import { describe, it, expect, vi } from 'vitest';

// Mock module-load API origin access.
vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  publishTargetPath: vi.fn(),
  artifactServeUrl: vi.fn(() => ''),
  openArtifactFile: vi.fn(),
}));
vi.mock('../../platform/host', () => ({
  host: { isWeb: false, isMac: () => false, isElectron: false, openExternal: vi.fn() },
}));
// Analytics reads the platform bridge at import time.
vi.mock('../lib/analytics', () => ({
  trackArtifactPublished: vi.fn(),
}));

import { timestampOf, titleCompare } from './ArtifactsView';

describe('timestampOf', () => {
  it('returns a.mtime when present', () => {
    expect(timestampOf({ mtime: 12345 })).toBe(12345);
  });

  it('returns 0 when mtime is absent', () => {
    expect(timestampOf({})).toBe(0);
  });

  it('a boolean `modified` never influences the result when mtime is 0 (Bug 3 regression)', () => {
    expect(timestampOf({ mtime: 0, modified: true })).toBe(0);
    expect(timestampOf({ mtime: 0, modified: false })).toBe(0);
  });
});

describe('titleCompare', () => {
  const file = (id, title, path) => ({ id, type: 'document', title, path });
  const webApp = (id, title, path) => ({ id, type: 'html-app', title, path });

  it('sorts by the displayed title, numeric-aware (v2 before v10)', () => {
    const items = [
      file('c', '2026 Forecast v10', '/p/c.xlsx'),
      file('a', '2026 Forecast v2', '/p/a.xlsx'),
      file('b', '2026 Forecast v1', '/p/b.xlsx'),
    ];
    const sorted = [...items].sort(titleCompare).map((a) => a.id);
    expect(sorted).toEqual(['b', 'a', 'c']);
  });

  it('breaks a title tie by the (visible) filename, numeric-aware', () => {
    const items = [
      file('c', '2026 Forecast', '/p/report10.csv'),
      file('a', '2026 Forecast', '/p/report2.csv'),
      file('b', '2026 Forecast', '/p/report1.csv'),
    ];
    const sorted = [...items].sort(titleCompare).map((a) => a.id);
    expect(sorted).toEqual(['b', 'a', 'c']);
  });

  it('does not consult the filename to break a tie between two web-app artifacts (Bug 1 regression)', () => {
    const a = webApp('a', 'Dashboard', '/p/aaa/index.html');
    const b = webApp('b', 'Dashboard', '/p/zzz/index.html');
    // A filename-based tie-break would order these by 'aaa' vs 'zzz' —
    // asserting exactly 0 proves the comparator never looked at the path.
    expect(titleCompare(a, b)).toBe(0);
  });

  it('yields the exact same order as the mixed file + web-app fixture below', () => {
    // Use literal expected ordering so the assertion cannot reproduce a comparator bug.
    const items = [
      webApp('dash', 'Weather Dashboard', '/p/dash/index.html'),
      file('a', '2026 Forecast', '/p/a/MindsHub_2026_Forecast.xlsx'),
      file('b', 'Alpha Report', '/p/b/zzz_report.xlsx'),
      file('c', '2026 Forecast', '/p/c/2026_Forecast_v2.xlsx'),
    ];
    const sorted = [...items].sort(titleCompare).map((a) => a.id);
    // Equal primary sort values must use filename ordering.
    expect(sorted).toEqual(['c', 'a', 'b', 'dash']);
  });
});
