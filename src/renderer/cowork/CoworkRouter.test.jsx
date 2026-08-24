import { describe, it, expect, afterEach } from 'vitest';
import {
  pathForRoute,
  initialNavState,
  markOptimisticConversation,
  clearOptimisticConversation,
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

  it('keeps a temporary (tmp-) conversation out of the URL (ENG-1233 Major 1)', () => {
    // `null` = "don't drive the URL": a tmp- id must never be pushed as
    // `/c/tmp-*` (dead history entry + unrecoverable refresh). The canonical
    // server id drives the single push instead.
    expect(pathForRoute('task', 'tmp-1700000000000')).toBeNull();
  });

  it('mirrors non-migrated list routes as /<route>', () => {
    expect(pathForRoute('projects', null)).toBe('/projects');
    expect(pathForRoute('scheduled', null)).toBe('/scheduled');
    expect(pathForRoute('artifacts', null)).toBe('/artifacts');
  });

  it('maps the customize route key to the /connect slug (matches "Connect Apps and Data" label)', () => {
    // The view keeps the legacy `customize` route key internally, but its
    // user-facing web URL reads `/connect` to match the sidebar label.
    expect(pathForRoute('customize', null)).toBe('/connect');
  });

  it('nests detail routes under their list with the entity id (ENG-1233 v1)', () => {
    expect(pathForRoute('projects', null, 'proj-1')).toBe('/projects/proj-1');
    expect(pathForRoute('schedule-detail', null, null, 'sched-9')).toBe('/scheduled/sched-9');
    // no id → the list/grid form
    expect(pathForRoute('projects', null, null)).toBe('/projects');
    expect(pathForRoute('schedule-detail', null, null, null)).toBe('/scheduled');
  });
});

describe('initialNavState slug parsing (host.isWeb is true in the renderer test env)', () => {
  const setPath = (p) => window.history.replaceState({}, '', p);
  afterEach(() => setPath('/'));

  it('parses the /connect slug back to the customize route key', () => {
    setPath('/connect');
    expect(initialNavState().route).toBe('customize');
  });

  it('fails a legacy /customize URL safe to Home, matching the router redirect', () => {
    // The router registers `/connect`, not `/customize`, so the parser must not
    // resolve the raw key either — otherwise the two disagree on the same URL.
    setPath('/customize');
    expect(initialNavState().route).toBe('home');
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

  it('clears a marked id once the turn completes (ENG-1233 Minor 1)', () => {
    // After completion the conversation is persisted; dropping the flag lets a
    // future visit hydrate from the server instead of stale local state.
    const id = 'server-minted-clearable';
    markOptimisticConversation(id);
    expect(isOptimisticConversation(id)).toBe(true);
    clearOptimisticConversation(id);
    expect(isOptimisticConversation(id)).toBe(false);
  });

  it('still treats a cleared tmp- id as optimistic (prefix wins)', () => {
    // The `tmp-` prefix is intrinsic, not registry-driven: clearing it must
    // not make a still-temporary id look persistable.
    const id = 'tmp-xyz';
    markOptimisticConversation(id);
    clearOptimisticConversation(id);
    expect(isOptimisticConversation(id)).toBe(true);
  });

  it('ignores non-string / empty ids safely', () => {
    expect(isOptimisticConversation(undefined)).toBe(false);
    expect(isOptimisticConversation(null)).toBe(false);
    expect(() => markOptimisticConversation(undefined)).not.toThrow();
    expect(() => clearOptimisticConversation(undefined)).not.toThrow();
    expect(isOptimisticConversation('')).toBe(false);
  });
});
