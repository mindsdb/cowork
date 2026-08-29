import { describe, expect, it } from 'vitest';

import {
  actorLabel,
  canUseSharedResource,
  isReservedProjectName,
  sharedResourceAttribution,
} from './sharedResourceAccess';

describe('shared resource access', () => {
  it('honours explicit server capability decisions', () => {
    const resource = { capabilities: { canEdit: false, canDelete: true } };
    expect(canUseSharedResource(resource, 'canEdit', false)).toBe(false);
    expect(canUseSharedResource(resource, 'canDelete', true)).toBe(true);
  });

  it('fails closed without a capability in web mode and preserves desktop', () => {
    expect(canUseSharedResource({}, 'canEdit', true)).toBe(false);
    expect(canUseSharedResource({}, 'canEdit', false)).toBe(true);
  });

  it('reserves only General in hosted Cowork while preserving desktop default', () => {
    expect(isReservedProjectName('general', true)).toBe(true);
    expect(isReservedProjectName('default', true)).toBe(false);
    expect(isReservedProjectName('default', false)).toBe(true);
  });

  it('prefers an actor email while retaining user-id-only actors', () => {
    expect(actorLabel({ userId: 'user-1', email: 'member@example.com' }))
      .toBe('member@example.com');
    expect(actorLabel({ userId: 'user-1', email: null })).toBe('user-1');
  });

  it('normalises nested attribution', () => {
    expect(sharedResourceAttribution({
      attribution: {
        createdBy: { userId: 'creator' },
        lastModifiedBy: { userId: 'editor', email: 'editor@example.com' },
        lastModifiedAt: '2026-08-29T10:00:00Z',
      },
    })).toEqual({
      createdBy: 'creator',
      lastModifiedBy: 'editor@example.com',
      lastModifiedAt: '2026-08-29T10:00:00Z',
    });
  });
});
