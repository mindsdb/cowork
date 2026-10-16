import { describe, expect, it } from 'vitest';

import {
  SKILL_SHARING_EVERYONE,
  SKILL_SHARING_OPTIONS,
  SKILL_SHARING_PRIVATE,
  canShareSkill,
  sharedFromValue,
  sharingValue,
} from './skillSharing';

describe('canShareSkill', () => {
  it('is true only for an explicit canShare true', () => {
    expect(canShareSkill({ capabilities: { canShare: true } })).toBe(true);
  });

  /* The desktop app talks to servers that predate sharing. Unlike the other
     capabilities, a missing key must never read as a grant there. */
  it.each([
    ['no skill', undefined],
    ['no capabilities', { label: 'x' }],
    ['capabilities without the key', { capabilities: { canEdit: true, canDelete: true, canDisable: true } }],
    ['canShare false', { capabilities: { canShare: false } }],
    ['a non-boolean canShare', { capabilities: { canShare: 'true' } }],
  ])('is false with %s', (_, skill) => {
    expect(canShareSkill(skill)).toBe(false);
  });
});

describe('sharingValue and sharedFromValue', () => {
  it('reads only an explicit shared true as Everyone', () => {
    expect(sharingValue({ shared: true })).toBe(SKILL_SHARING_EVERYONE);
    expect(sharingValue({ shared: false })).toBe(SKILL_SHARING_PRIVATE);
    expect(sharingValue({ shared: 'true' })).toBe(SKILL_SHARING_PRIVATE);
    expect(sharingValue({})).toBe(SKILL_SHARING_PRIVATE);
    expect(sharingValue(null)).toBe(SKILL_SHARING_PRIVATE);
  });

  it('maps a control value back to the API flag', () => {
    expect(sharedFromValue(SKILL_SHARING_EVERYONE)).toBe(true);
    expect(sharedFromValue(SKILL_SHARING_PRIVATE)).toBe(false);
    expect(sharedFromValue(undefined)).toBe(false);
  });

  it('round-trips every option', () => {
    for (const { value } of SKILL_SHARING_OPTIONS) {
      expect(sharingValue({ shared: sharedFromValue(value) })).toBe(value);
    }
  });

  it('offers Only me first, so a create preselects it', () => {
    expect(SKILL_SHARING_OPTIONS.map((option) => option.label))
      .toEqual(['Only me', 'Everyone (read-only)']);
  });
});
