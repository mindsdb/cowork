import { describe, it, expect } from 'vitest';
import { analyticsEnv, NON_PROD_POSTHOG_KEY } from './analytics-env';
import { BUILD_KINDS } from './channels';

// anton's own default, the production project. Written out so a change to the
// non-prod key that lands on this value fails here.
const PRODUCTION_POSTHOG_KEY = 'phc_ypFMKbvAwRsLuDCToox2AkEg5wx6ReBfkyi3kX2zw6VK';

describe('analyticsEnv', () => {
  it.each(['dev', 'preview', 'stable'] as const)(
    'sends a %s build to the non-production project', (kind) => {
      expect(analyticsEnv(kind, {}).ANTON_POSTHOG_KEY).toBe(NON_PROD_POSTHOG_KEY);
    });

  it('leaves prod on anton\'s production default', () => {
    expect(analyticsEnv('prod', {})).not.toHaveProperty('ANTON_POSTHOG_KEY');
  });

  it('never routes a build kind to the production project', () => {
    expect(NON_PROD_POSTHOG_KEY).not.toBe(PRODUCTION_POSTHOG_KEY);
  });

  it.each([
    ['dev', 'dev'], ['preview', 'preview'], ['stable', 'staging'], ['prod', 'prod'],
  ] as const)('labels a %s build\'s events as %s', (kind, label) => {
    expect(analyticsEnv(kind, {}).ANTON_DEPLOYMENT_ENV).toBe(label);
  });

  it('labels every build kind', () => {
    for (const kind of BUILD_KINDS) {
      expect(analyticsEnv(kind, {}).ANTON_DEPLOYMENT_ENV).toMatch(/^[a-z]+$/);
    }
  });

  it('leaves values the environment already sets to the environment', () => {
    const env = { ANTON_POSTHOG_KEY: 'phc_other', ANTON_DEPLOYMENT_ENV: 'eval' };
    expect(analyticsEnv('stable', env)).toEqual({});
  });

  // An empty key is how anton's direct PostHog sink is switched off, so it is
  // a value, not an absence.
  it.each(['dev', 'preview', 'stable'] as const)(
    'leaves values the environment sets to empty on a %s build', (kind) => {
      const env = { ANTON_POSTHOG_KEY: '', ANTON_DEPLOYMENT_ENV: '' };
      expect(analyticsEnv(kind, env)).toEqual({});
    });
});
