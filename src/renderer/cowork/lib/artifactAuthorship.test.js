import { describe, it, expect } from 'vitest';
import { artifactAuthorship, UNKNOWN_OWNER_LABEL } from './artifactAuthorship';
import { OTHER_ACTOR_LABEL } from './sharedResourceAccess';

describe('artifactAuthorship', () => {
  it('marks nothing for the owner', () => {
    expect(artifactAuthorship({ role: 'owner', canEdit: true })).toBeNull();
  });

  it('keys on role, not canEdit', () => {
    // An owner without the artifact.manage product permission gets
    // canEdit: false from the server and is still the owner.
    expect(artifactAuthorship({ role: 'owner', canEdit: false })).toBeNull();
  });

  it('marks a reviewer as another member', () => {
    expect(artifactAuthorship({ role: 'reviewer', canEdit: false })).toEqual({
      kind: 'other',
      label: OTHER_ACTOR_LABEL,
      description: 'Created by another member of this project. You can review it but not change it.',
    });
  });

  it('prefers ownerUnknown over the reviewer role it arrives with', () => {
    expect(artifactAuthorship({ role: 'reviewer', canEdit: false, ownerUnknown: true })).toEqual({
      kind: 'unknown',
      label: UNKNOWN_OWNER_LABEL,
      description: "Nobody is recorded as this artifact's owner.",
    });
  });

  it('marks ownerUnknown even without a role', () => {
    expect(artifactAuthorship({ ownerUnknown: true })?.kind).toBe('unknown');
  });

  it('ignores a false ownerUnknown', () => {
    expect(artifactAuthorship({ role: 'owner', ownerUnknown: false })).toBeNull();
  });

  it.each([undefined, null])('marks nothing without capabilities (%s)', (caps) => {
    expect(artifactAuthorship(caps)).toBeNull();
  });

  it('labels the unknown owner verbatim', () => {
    expect(UNKNOWN_OWNER_LABEL).toBe('Unknown owner');
  });
});
