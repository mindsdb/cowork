import { describe, it, expect, vi } from 'vitest';

// ArtifactsView.jsx's module-level import of '../api' calls
// host.getApiOrigin() at import time — mock both so importing the module
// for its pure functions doesn't touch the real platform bridge.
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
// ArtifactsView.jsx imports trackArtifactPublished from '../lib/analytics'
// at module scope, and that module reads `host.isElectron` at its own
// module scope (line 44) — mock it too so this file's import of
// ArtifactsView doesn't depend on that read resolving a particular way.
vi.mock('../lib/analytics', () => ({
  trackArtifactPublished: vi.fn(),
}));

import { timestampOf } from './ArtifactsView';

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
