// Teams and org-wide access on Cloud (ENG-3787): the access route answers
// `allowed_team_ids` and `org_wide`, and the hook carries them both ways.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { setOrgMode } from '../../../../lib/orgMode';

vi.mock('../../../api', () => ({
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  fetchArtifactStatus: vi.fn(),
  listArtifactVersions: vi.fn(),
  activateArtifactVersion: vi.fn(),
  publishTargetPath: (a) => a?.folder || a?.path || '',
}));
vi.mock('../../../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));

const sharing = vi.hoisted(() => ({
  useSharingCapabilities: vi.fn(),
  useHubTeams: vi.fn(),
}));
vi.mock('../../../hooks/useOrgSharing', () => sharing);
vi.mock('../../../hooks/useAccountEmail', () => ({ useAccountEmail: () => 'me@kinaxis.com' }));

const wsMock = vi.hoisted(() => ({
  canUseArtifactWorkspace: vi.fn(() => true),
  loadArtifactAccess: vi.fn(),
  setArtifactAccess: vi.fn(),
}));
vi.mock('../../../lib/artifactWorkspaceApi', () => wsMock);

import { usePublish } from './usePublish';

const ORG_ARTIFACT = {
  id: '7db94eb8f0a54c7e9c1d2b3a4f5e6d70',
  projectId: 'proj-1',
  publishedUrl: 'https://share/abc',
  accessMode: 'restricted',
  ownerOnly: true,
};
const TEAMS = { status: 'ready', reachable: true, teams: [{ id: 't-supply', display_name: 'Supply Planning' }] };

beforeEach(() => {
  vi.clearAllMocks();
  sharing.useSharingCapabilities.mockReturnValue({ enabled: true, can_share_org: false, org_name: 'Kinaxis' });
  sharing.useHubTeams.mockReturnValue(TEAMS);
  setOrgMode(true);
});

afterEach(() => setOrgMode(false));

describe('usePublish with org sharing', () => {
  it('reads the teams and org-wide flag from the access route', async () => {
    wsMock.loadArtifactAccess.mockResolvedValue({
      accessMode: 'restricted', accessEmails: [], orgAllowed: false, ownerOnly: false,
      allowed_team_ids: ['t-supply'], org_wide: true,
    });
    const onChange = vi.fn();
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: true, onChange }));

    await waitFor(() => expect(result.current.accessTeamIds).toEqual(['t-supply']));
    expect(result.current.orgAllowed).toBe(true);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ accessTeamIds: ['t-supply'], orgAllowed: true }));
  });

  it('sends team_ids and org_wide and keeps what the server answered', async () => {
    wsMock.loadArtifactAccess.mockResolvedValue({ accessMode: 'restricted', ownerOnly: true });
    wsMock.setArtifactAccess.mockResolvedValue({
      url: 'https://share/abc', accessMode: 'restricted', accessEmails: [], ownerOnly: false,
      allowed_team_ids: ['t-supply'], org_wide: false,
    });
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));

    const access = { mode: 'restricted', emails: [], org_allowed: false, owner_only: false, team_ids: ['t-supply'], org_wide: false };
    await act(async () => { await result.current.publish(access); });

    expect(wsMock.setArtifactAccess).toHaveBeenCalledWith(ORG_ARTIFACT, access);
    expect(result.current.accessTeamIds).toEqual(['t-supply']);
    expect(result.current.orgAllowed).toBe(false);
  });

  it('hands the panel the org name and teams', () => {
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));
    expect(result.current.orgSharing).toEqual({
      enabled: true, orgName: 'Kinaxis', teams: TEAMS, userEmail: 'me@kinaxis.com',
    });
  });
});
