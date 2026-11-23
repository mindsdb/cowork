import { describe, it, expect } from 'vitest';
import { artifactAuthorship, artifactOwnerUserId, UNKNOWN_OWNER_LABEL } from './artifactAuthorship';
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

  // ENG-4455: in MindsHub mode a reviewer's capabilities carry the owner's id,
  // and the caller passes the name MindsHub gave it.
  it('names the owner once the caller has their name', () => {
    expect(artifactAuthorship({ role: 'reviewer', ownerUserId: 'u-ana' }, { ownerName: 'Ana Ruiz' })).toEqual({
      kind: 'other',
      label: 'Ana Ruiz',
      description: 'Created by Ana Ruiz, another member of this project. You can review it but not change it.',
    });
  });

  it.each([
    ['no name yet', { role: 'reviewer', ownerUserId: 'u-ana' }, null],
    ['a blank name', { role: 'reviewer', ownerUserId: 'u-ana' }, '  '],
    ['a name but no owner id', { role: 'reviewer' }, 'Ana Ruiz'],
  ])('keeps "Another member" with %s', (_label, caps, ownerName) => {
    expect(artifactAuthorship(caps, { ownerName }).label).toBe(OTHER_ACTOR_LABEL);
  });

  it('never names an unknown owner', () => {
    expect(artifactAuthorship({ role: 'reviewer', ownerUnknown: true, ownerUserId: 'u-ana' }, { ownerName: 'Ana Ruiz' }).kind).toBe('unknown');
  });

  it('never names anyone on the viewer\'s own artifact', () => {
    expect(artifactAuthorship({ role: 'owner', ownerUserId: 'u-me' }, { ownerName: 'Me' })).toBeNull();
  });
});

describe('artifactOwnerUserId', () => {
  it('is the owner id of a reviewer\'s artifact', () => {
    expect(artifactOwnerUserId({ role: 'reviewer', ownerUserId: 'u-ana' })).toBe('u-ana');
  });

  it.each([
    [null],
    [{ role: 'owner', ownerUserId: 'u-me' }],
    [{ role: 'reviewer', ownerUnknown: true, ownerUserId: 'u-ana' }],
    [{ role: 'reviewer' }],
    [{ role: 'reviewer', ownerUserId: '' }],
    [{ role: 'reviewer', ownerUserId: 42 }],
  ])('is null for %j', (caps) => {
    expect(artifactOwnerUserId(caps)).toBeNull();
  });
});
