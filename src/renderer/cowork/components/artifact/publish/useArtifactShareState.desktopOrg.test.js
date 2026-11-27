import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { SHARING_OFF } from '../../../lib/orgSharing';
import { useArtifactShareState } from './useArtifactShareState';

const ORG_AUDIENCE = {
  status: 'ready',
  orgName: 'Acme',
  capabilities: {
    enabled: false, orgAudience: true, canShareSkillsOrg: false, canWriteSkillsOrg: false,
    canShareArtifactsOrg: true, permissionsKnown: true, teamsKnown: true,
  },
};
const desktopPub = (over = {}) => ({
  orgMode: false,
  orgSharing: { status: 'idle', capabilities: SHARING_OFF, teams: null, orgName: null },
  orgAudience: ORG_AUDIENCE,
  publishedUrl: 'https://share/abc',
  accessMode: 'restricted',
  accessEmails: [],
  orgAllowed: true,
  ownerOnly: false,
  accessLoaded: true,
  ...over,
});

describe('useArtifactShareState on Desktop', () => {
  it('keeps sharing off and hands the organization audience apart', () => {
    const { result } = renderHook(() => useArtifactShareState(desktopPub()));
    expect(result.current.sharing).toBeNull();
    expect(result.current.orgAudience).toBe(ORG_AUDIENCE);
    expect(result.current.chooserSharing).toBe(ORG_AUDIENCE);
    expect(result.current.orgName).toBe('Acme');
    expect(result.current.shareState).toMatchObject({ shared: true, kind: 'org' });
    expect(result.current.permissionsUnreachable).toBe(false);
  });

  it('has no organization audience while it is off', () => {
    const off = { status: 'idle', capabilities: SHARING_OFF, orgName: null };
    const { result } = renderHook(() => useArtifactShareState(desktopPub({ orgAudience: off })));
    expect(result.current.orgAudience).toBeNull();
    expect(result.current.shareState.kind).toBe('specific');
  });
});
