// Which audience read usePublish turns on: Desktop's "Everyone at ‹org›"
// (useDesktopOrgAudience) only outside MindsHub mode with the panel open.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { setOrgMode } from '../../../../lib/orgMode';
import { SHARING_OFF } from '../../../lib/orgSharing';

vi.mock('../../../api', () => ({
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  fetchArtifactStatus: vi.fn(async () => ({ publishedUrl: 'https://share/abc', accessMode: 'restricted', accessEmails: [] })),
  listArtifactVersions: vi.fn(async () => []),
  activateArtifactVersion: vi.fn(),
  publishTargetPath: (a) => a?.folder || a?.path || '',
}));
vi.mock('../../../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
vi.mock('../../../hooks/useOrgSharing', () => ({
  useSharingCapabilities: vi.fn(() => ({ status: 'idle', capabilities: SHARING_OFF, retry: vi.fn() })),
  useMindsHubTeams: vi.fn(() => null),
  useSharingOrgName: vi.fn(() => null),
}));
vi.mock('../../../lib/artifactWorkspaceApi', () => ({
  canUseArtifactWorkspace: vi.fn(() => true),
  loadArtifactAccess: vi.fn(async () => ({ accessMode: 'restricted', accessEmails: [], ownerOnly: true })),
  setArtifactAccess: vi.fn(),
}));
const audience = vi.hoisted(() => ({ useDesktopOrgAudience: vi.fn() }));
vi.mock('../../../hooks/useDesktopOrgAudience', () => audience);

import { usePublish } from './usePublish';

const ARTIFACT = {
  id: '7db94eb8f0a54c7e9c1d2b3a4f5e6d70',
  projectId: 'proj-1',
  path: '/p/a.html',
  publishedUrl: 'https://share/abc',
  accessMode: 'restricted',
  ownerOnly: true,
};
const ORG_AUDIENCE = {
  status: 'ready',
  orgName: 'Acme',
  capabilities: { ...SHARING_OFF, orgAudience: true, canShareArtifactsOrg: true, permissionsKnown: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  audience.useDesktopOrgAudience.mockReturnValue(ORG_AUDIENCE);
});

afterEach(() => setOrgMode(false));

describe('usePublish and the desktop organization audience', () => {
  it('never reads it in MindsHub mode', () => {
    setOrgMode(true);
    renderHook(() => usePublish(ARTIFACT, { enabled: true }));
    expect(audience.useDesktopOrgAudience).toHaveBeenCalledWith(false);
    expect(audience.useDesktopOrgAudience).not.toHaveBeenCalledWith(true);
  });

  it('reads it on Desktop with the panel open and hands it on as orgAudience', () => {
    setOrgMode(false);
    const { result } = renderHook(() => usePublish(ARTIFACT, { enabled: true }));
    expect(audience.useDesktopOrgAudience).toHaveBeenCalledWith(true);
    expect(result.current.orgAudience).toBe(ORG_AUDIENCE);
  });

  it('does not read it on Desktop while the panel is closed', () => {
    setOrgMode(false);
    renderHook(() => usePublish(ARTIFACT, { enabled: false }));
    expect(audience.useDesktopOrgAudience).not.toHaveBeenCalledWith(true);
  });
});
