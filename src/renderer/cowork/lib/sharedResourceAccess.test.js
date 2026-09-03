import { describe, expect, it } from 'vitest';

import {
  OTHER_ACTOR_LABEL,
  UNKNOWN_ACTOR_LABEL,
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

  it('prefers an actor email, the only actor the server names', () => {
    expect(actorLabel({ userId: 'user-1', email: 'member@example.com' }))
      .toBe('member@example.com');
  });

  it('never shows the raw user id of an actor the server did not name', () => {
    const id = '6f0d2e4a-4d4a-4d0e-93f6-9c4a1f2b7e10';
    expect(actorLabel({ userId: id, email: null })).toBe(OTHER_ACTOR_LABEL);
    expect(actorLabel({ user_id: id })).toBe(OTHER_ACTOR_LABEL);
    expect(actorLabel({ userId: id, email: '' })).not.toContain(id);
  });

  it('labels an actor with neither an email nor an id as unknown', () => {
    expect(actorLabel({})).toBe(UNKNOWN_ACTOR_LABEL);
    expect(actorLabel({ userId: null, email: null })).toBe(UNKNOWN_ACTOR_LABEL);
  });

  it('reports no actor at all as empty so attribution can drop out', () => {
    expect(actorLabel(null)).toBe('');
    expect(actorLabel(undefined)).toBe('');
    expect(sharedResourceAttribution({
      attribution: { createdBy: null, lastModifiedBy: null, lastModifiedAt: null },
    })).toBeNull();
  });

  it('normalises nested attribution', () => {
    expect(sharedResourceAttribution({
      attribution: {
        createdBy: { userId: 'creator' },
        lastModifiedBy: { userId: 'editor', email: 'editor@example.com' },
        lastModifiedAt: '2026-08-29T10:00:00Z',
      },
    })).toEqual({
      createdBy: OTHER_ACTOR_LABEL,
      lastModifiedBy: 'editor@example.com',
      lastModifiedAt: '2026-08-29T10:00:00Z',
    });
  });

  it('resolves snake_case attribution the same as camelCase', () => {
    expect(sharedResourceAttribution({
      attribution: {
        created_by: { user_id: 'creator', email: 'creator@example.com' },
        last_modified_by: { user_id: 'editor', email: 'editor@example.com' },
        last_modified_at: '2026-08-29T10:00:00Z',
      },
    })).toEqual({
      createdBy: 'creator@example.com',
      lastModifiedBy: 'editor@example.com',
      lastModifiedAt: '2026-08-29T10:00:00Z',
    });
  });
});
