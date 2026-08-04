import { describe, it, expect } from 'vitest';
import { parseUrlState, buildSearch, historyWriteKind, KNOWN_ROUTES } from './urlState';

const UUID = '11111111-2222-4333-8444-555555555555';

describe('parseUrlState', () => {
  it('empty / no params → home with no entities or settings', () => {
    expect(parseUrlState('')).toEqual({
      route: 'home', taskId: null, projectName: null, scheduleId: null, settingsPane: null,
    });
  });

  it('reads a conversation deep link', () => {
    const s = parseUrlState(`?view=task&c=${UUID}`);
    expect(s.route).toBe('task');
    expect(s.taskId).toBe(UUID);
  });

  it('reads a project by name (URL-decoded)', () => {
    const s = parseUrlState('?view=projects&p=My%20Project');
    expect(s.route).toBe('projects');
    expect(s.projectName).toBe('My Project');
  });

  it('reads a schedule-detail id', () => {
    expect(parseUrlState('?view=schedule-detail&s=sched_9')).toMatchObject({
      route: 'schedule-detail', scheduleId: 'sched_9',
    });
  });

  it('only surfaces an entity id for the route that owns it', () => {
    // a stray c= on a non-task route is ignored
    expect(parseUrlState('?view=projects&c=' + UUID).taskId).toBe(null);
  });

  it('settings: absent = closed, "on" = open no section, value = open at section', () => {
    expect(parseUrlState('').settingsPane).toBe(null);
    expect(parseUrlState('?settings=on').settingsPane).toBe('');
    expect(parseUrlState('?settings=backend').settingsPane).toBe('backend');
  });

  it('settings is orthogonal — it rides on top of any route', () => {
    expect(parseUrlState(`?view=task&c=${UUID}&settings=account`)).toMatchObject({
      route: 'task', taskId: UUID, settingsPane: 'account',
    });
  });

  it('an unknown view degrades to home', () => {
    expect(parseUrlState('?view=bogus').route).toBe('home');
  });
});

describe('buildSearch', () => {
  it('home → empty string (clean root)', () => {
    expect(buildSearch({ route: 'home' })).toBe('');
  });

  it('round-trips every known route', () => {
    for (const route of KNOWN_ROUTES) {
      const built = buildSearch({ route });
      expect(parseUrlState(built).route).toBe(route);
    }
  });

  it('round-trips a conversation link', () => {
    const built = buildSearch({ route: 'task', taskId: UUID });
    expect(built).toBe(`?view=task&c=${UUID}`);
    expect(parseUrlState(built)).toMatchObject({ route: 'task', taskId: UUID });
  });

  it('never writes a tmp- conversation id', () => {
    expect(buildSearch({ route: 'task', taskId: 'tmp-1699999999' })).toBe('?view=task');
  });

  it('encodes a project name with spaces and round-trips it', () => {
    const built = buildSearch({ route: 'projects', projectName: 'My Project' });
    expect(parseUrlState(built).projectName).toBe('My Project');
  });

  it('serialises the settings overlay', () => {
    expect(buildSearch({ route: 'home', settingsPane: '' })).toBe('?settings=on');
    expect(buildSearch({ route: 'home', settingsPane: 'backend' })).toBe('?settings=backend');
    expect(buildSearch({ route: 'home', settingsPane: null })).toBe('');
  });

  it('preserves non-managed params (e.g. a lingering Keycloak code)', () => {
    const built = buildSearch({ route: 'task', taskId: UUID }, '?code=abc&session_state=xyz');
    const q = new URLSearchParams(built.slice(1));
    expect(q.get('code')).toBe('abc');
    expect(q.get('session_state')).toBe('xyz');
    expect(q.get('view')).toBe('task');
  });

  it('is idempotent — building on its own output changes nothing', () => {
    const once = buildSearch({ route: 'projects', projectName: 'general' });
    const twice = buildSearch({ route: 'projects', projectName: 'general' }, once);
    expect(twice).toBe(once);
  });

  it('clears stale managed params when the route changes', () => {
    // navigating task -> home drops the c= that was there
    const fromTask = `?view=task&c=${UUID}`;
    expect(buildSearch({ route: 'home' }, fromTask)).toBe('');
  });
});

describe('historyWriteKind', () => {
  const base = { contentChanged: true, isFirst: false, route: 'home', prevTaskId: '', taskId: null };

  it('the first sync always replaces (never a phantom history entry)', () => {
    expect(historyWriteKind({ ...base, isFirst: true })).toBe('replace');
  });

  it('a settings-overlay-only change (no content change) replaces', () => {
    expect(historyWriteKind({ ...base, contentChanged: false })).toBe('replace');
  });

  it('a genuine content navigation pushes', () => {
    // clicking a conversation: home -> task with a real id
    expect(historyWriteKind({ contentChanged: true, isFirst: false, route: 'task', prevTaskId: '', taskId: UUID })).toBe('push');
    // switching between two real conversations
    expect(historyWriteKind({ contentChanged: true, isFirst: false, route: 'task', prevTaskId: 'aaaa', taskId: UUID })).toBe('push');
  });

  it('the tmp-→real id adoption replaces (starting a chat = one Back press)', () => {
    expect(historyWriteKind({
      contentChanged: true, isFirst: false, route: 'task',
      prevTaskId: 'tmp-1699999999', taskId: UUID,
    })).toBe('replace');
  });

  it('home -> task(tmp) still pushes (that first entry is wanted)', () => {
    expect(historyWriteKind({
      contentChanged: true, isFirst: false, route: 'task',
      prevTaskId: '', taskId: 'tmp-1699999999',
    })).toBe('push');
  });
});
