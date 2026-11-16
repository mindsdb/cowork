import { describe, it, expect } from 'vitest';
import { NON_PROD_POSTHOG_KEY, posthogKeyForBuildKind } from './analytics-project';

const PROD = 'phc_prod';

describe('posthogKeyForBuildKind', () => {
  it.each(['stable', 'preview', 'dev'])('routes %s to the non-production project', (kind) => {
    expect(posthogKeyForBuildKind(kind, PROD)).toBe(NON_PROD_POSTHOG_KEY);
  });

  it('keeps prod on the production key', () => {
    expect(posthogKeyForBuildKind('prod', PROD)).toBe(PROD);
  });

  it.each([null, undefined, ''])('keeps the production key when the kind is unknown (%s)', (kind) => {
    expect(posthogKeyForBuildKind(kind, PROD)).toBe(PROD);
  });
});
