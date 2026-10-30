// Teams, people in the org and org-wide access on Cloud (ENG-3787): the
// access route answers `allowed_team_ids`, `allowed_user_ids` and
// `org_allowed`, and the hook carries them both ways.
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
const TEAMS = { status: 'ready', reachable: true, teams: [{ id: 't-platform', display_name: 'Platform' }] };
const retryCapabilities = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  sharing.useSharingCapabilities.mockReturnValue({
    status: 'ready',
    capabilities: { enabled: true, can_share_org: false, org_name: 'Acme' },
    retry: retryCapabilities,
  });
  sharing.useHubTeams.mockReturnValue(TEAMS);
  setOrgMode(true);
});

afterEach(() => setOrgMode(false));

describe('usePublish with org sharing', () => {
  it('reads the teams, people in the org and org flag from the access route', async () => {
    wsMock.loadArtifactAccess.mockResolvedValue({
      accessMode: 'restricted', accessEmails: ['zed@partner.io'], ownerOnly: false,
      allowed_team_ids: ['t-platform'], allowed_user_ids: ['u-ana'], org_allowed: true,
    });
    const onChange = vi.fn();
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: true, onChange }));

    await waitFor(() => expect(result.current.allowedTeamIds).toEqual(['t-platform']));
    expect(result.current.allowedUserIds).toEqual(['u-ana']);
    expect(result.current.accessEmails).toEqual(['zed@partner.io']);
    expect(result.current.orgAllowed).toBe(true);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      allowedTeamIds: ['t-platform'], allowedUserIds: ['u-ana'], orgAllowed: true,
    }));
  });

  it('reads the camelCase answer too', async () => {
    wsMock.loadArtifactAccess.mockResolvedValue({
      accessMode: 'restricted', accessEmails: [], ownerOnly: false, orgAllowed: false,
      allowedTeamIds: ['t-platform'], allowedUserIds: ['u-bo'],
    });
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: true }));

    await waitFor(() => expect(result.current.allowedUserIds).toEqual(['u-bo']));
    expect(result.current.allowedTeamIds).toEqual(['t-platform']);
    expect(result.current.orgAllowed).toBe(false);
  });

  it('sends the access as given and keeps what the server answered', async () => {
    wsMock.loadArtifactAccess.mockResolvedValue({ accessMode: 'restricted', ownerOnly: true });
    wsMock.setArtifactAccess.mockResolvedValue({
      url: 'https://share/abc', accessMode: 'restricted', accessEmails: ['zed@partner.io'], ownerOnly: false,
      allowedTeamIds: ['t-platform'], allowedUserIds: ['u-ana'], orgAllowed: false,
    });
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));

    const access = {
      mode: 'restricted', org_allowed: false, allowed_team_ids: ['t-platform'], allowed_user_ids: ['u-ana'],
      allowed_emails: ['zed@partner.io'], owner_only: false,
    };
    await act(async () => { await result.current.publish(access); });

    expect(wsMock.setArtifactAccess).toHaveBeenCalledWith(ORG_ARTIFACT, access);
    expect(result.current.allowedTeamIds).toEqual(['t-platform']);
    expect(result.current.allowedUserIds).toEqual(['u-ana']);
    expect(result.current.accessEmails).toEqual(['zed@partner.io']);
    expect(result.current.orgAllowed).toBe(false);
  });

  it('falls back to the request when the answer names no people', async () => {
    wsMock.loadArtifactAccess.mockResolvedValue({ accessMode: 'restricted', ownerOnly: true });
    wsMock.setArtifactAccess.mockResolvedValue({ url: 'https://share/abc', accessMode: 'restricted', ownerOnly: false });
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));

    await act(async () => {
      await result.current.publish({
        mode: 'restricted', org_allowed: false, allowed_team_ids: [], allowed_user_ids: ['u-ana'],
        allowed_emails: [], owner_only: false,
      });
    });

    expect(result.current.allowedUserIds).toEqual(['u-ana']);
  });

  // One spelling of what org sharing allows: the capabilities object as
  // useSharingCapabilities reads it, never a renamed copy of its fields.
  it('hands the panel the capabilities read as it answered, with the teams', () => {
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));
    expect(result.current.orgMode).toBe(true);
    expect(result.current.orgSharing).toEqual({
      status: 'ready',
      capabilities: { enabled: true, can_share_org: false, org_name: 'Acme' },
      retry: retryCapabilities,
      teams: TEAMS,
    });
  });

  it('passes on a capabilities read still loading or failed', () => {
    sharing.useSharingCapabilities.mockReturnValue({
      status: 'error', capabilities: { enabled: false, can_share_org: false, org_name: null }, retry: retryCapabilities,
    });
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: true }));
    expect(result.current.orgSharing).toEqual(expect.objectContaining({
      status: 'error', capabilities: expect.objectContaining({ enabled: false }), retry: retryCapabilities,
    }));
  });

  it('says it is not org mode, and never asks what org sharing allows, outside it', () => {
    setOrgMode(false);
    sharing.useSharingCapabilities.mockReturnValue({
      status: 'idle', capabilities: { enabled: false, can_share_org: false, org_name: null }, retry: retryCapabilities,
    });
    const { result } = renderHook(() => usePublish({ ...ORG_ARTIFACT, path: '/w/a.html' }, { enabled: true }));
    expect(result.current.orgMode).toBe(false);
    expect(sharing.useSharingCapabilities).toHaveBeenCalledWith(false);
    expect(result.current.orgSharing).toEqual(expect.objectContaining({
      status: 'idle', capabilities: { enabled: false, can_share_org: false, org_name: null },
    }));
  });

  it('never reads the retired org_wide from an answer', async () => {
    wsMock.loadArtifactAccess.mockResolvedValue({ accessMode: 'restricted', ownerOnly: true });
    wsMock.setArtifactAccess.mockResolvedValue({
      url: 'https://share/abc', accessMode: 'restricted', ownerOnly: false, org_wide: true,
    });
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));

    await act(async () => {
      await result.current.publish({
        mode: 'restricted', org_allowed: false, allowed_team_ids: [], allowed_user_ids: ['u-ana'],
        allowed_emails: [], owner_only: false,
      });
    });

    expect(result.current.orgAllowed).toBe(false);
  });
});
