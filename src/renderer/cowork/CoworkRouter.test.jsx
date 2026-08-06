import { describe, it, expect } from 'vitest';
import {
  pathForRoute,
  markOptimisticConversation,
  isOptimisticConversation,
} from './CoworkRouter';

describe('pathForRoute', () => {
  it('maps home to /', () => {
    expect(pathForRoute('home', null)).toBe('/');
    expect(pathForRoute('home', 'abc')).toBe('/'); // activeTaskId ignored on home
  });

  it('treats empty/unknown-falsey route as home', () => {
    expect(pathForRoute(null, null)).toBe('/');
    expect(pathForRoute(undefined, null)).toBe('/');
  });

  it('maps a task to /c/:id, falling back to / without an id', () => {
    expect(pathForRoute('task', 'conv-123')).toBe('/c/conv-123');
    expect(pathForRoute('task', null)).toBe('/');
  });

  it('mirrors non-migrated routes as /<route>', () => {
    expect(pathForRoute('projects', null)).toBe('/projects');
    expect(pathForRoute('scheduled', null)).toBe('/scheduled');
    expect(pathForRoute('schedule-detail', null)).toBe('/schedule-detail');
  });
});

describe('optimistic conversation registry', () => {
  it('treats tmp- ids as optimistic without marking', () => {
    expect(isOptimisticConversation('tmp-1700000000000')).toBe(true);
  });

  it('is false for an unknown real id', () => {
    expect(isOptimisticConversation('real-unmarked-id')).toBe(false);
  });

  it('returns true once a real id is marked (mints during send/adopt)', () => {
    const id = 'server-minted-abc';
    expect(isOptimisticConversation(id)).toBe(false);
    markOptimisticConversation(id);
    expect(isOptimisticConversation(id)).toBe(true);
  });

  it('ignores non-string / empty ids safely', () => {
    expect(isOptimisticConversation(undefined)).toBe(false);
    expect(isOptimisticConversation(null)).toBe(false);
    expect(() => markOptimisticConversation(undefined)).not.toThrow();
    expect(isOptimisticConversation('')).toBe(false);
  });
});
