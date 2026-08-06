import { describe, it, expect } from 'vitest';
import { ROUTES, KNOWN_ROUTES, MANAGED_PARAMS, routeForView } from './routes';

describe('routes table', () => {
  it('a route has a param iff it has a field (both or neither)', () => {
    for (const r of Object.values(ROUTES)) {
      expect(Boolean(r.param)).toBe(Boolean(r.field));
    }
  });

  it('owned query params are unique', () => {
    expect(new Set(MANAGED_PARAMS).size).toBe(MANAGED_PARAMS.length);
  });

  it('routeForView maps a view to its id; unknown/absent -> home', () => {
    expect(routeForView('task')).toBe('task');
    expect(routeForView('schedule-detail')).toBe('schedule-detail');
    expect(routeForView('bogus')).toBe('home');
    expect(routeForView(null)).toBe('home');
    expect(routeForView('')).toBe('home');
  });

  it('KNOWN_ROUTES is the non-home routes', () => {
    expect(KNOWN_ROUTES.has('home')).toBe(false);
    expect(KNOWN_ROUTES.has('task')).toBe(true);
    expect([...KNOWN_ROUTES].every((id) => ROUTES[id].view)).toBe(true);
  });
});
