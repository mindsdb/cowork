import { afterEach, describe, it, expect, vi } from 'vitest';

// Stub Electron for module-load host resolution; pure resolver cases pass their own build kind.
vi.mock('electron', () => ({ app: { isPackaged: false } }));

import { MINDS_PROBE_MODEL, isMindsHost, resolveApiHost } from './minds-urls';

/*
 * Per-PR auth hosts retain auth's prefix while console hosts omit theirs.
 * Reimport module-level constants for each MINDS_API_HOST; renderer/lib/mindsUrls.test.ts covers
 * its separate copy.
 */
describe('derived auth and console hosts', () => {
  const load = async (apiHost: string) => {
    vi.stubEnv('MINDS_API_HOST', apiHost);
    vi.resetModules();
    return import('./minds-urls');
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('drops the service prefix entirely for the console on a PR host', async () => {
    const { MINDS_CONSOLE_HOST } = await load('https://api-pr-cowork-744.dev.mindshub.ai');

    // `console-pr-cowork-744.dev.mindshub.ai` does not resolve; this one does.
    expect(MINDS_CONSOLE_HOST).toBe('https://pr-cowork-744.dev.mindshub.ai');
  });

  it('keeps the console. label on a permanent env', async () => {
    const { MINDS_CONSOLE_HOST } = await load('https://api.staging.mindshub.ai');

    expect(MINDS_CONSOLE_HOST).toBe('https://console.staging.mindshub.ai');
  });

  it('leaves auth alone on a PR host: auth DOES keep its prefix there', async () => {
    const { MINDS_AUTH_HOST, MINDS_KEYCLOAK_BASE } = await load(
      'https://api-pr-cowork-744.dev.mindshub.ai',
    );

    expect(MINDS_AUTH_HOST).toBe('https://auth-pr-cowork-744.dev.mindshub.ai');
    expect(MINDS_KEYCLOAK_BASE).toBe('https://auth-pr-cowork-744.dev.mindshub.ai/auth');
  });

  it('reads the env slug out of a PR host, where the env is the label after the service', async () => {
    // Per-PR hosts must yield ENV or the sidecar falls back to prod while the client authenticates
    // elsewhere.
    const { MINDS_ENV_SLUG } = await load('https://api-pr-cowork-763.dev.mindshub.ai');

    expect(MINDS_ENV_SLUG).toBe('dev');
  });

  it('reads the env slug out of a permanent host', async () => {
    const { MINDS_ENV_SLUG } = await load('https://api.staging.mindshub.ai');

    expect(MINDS_ENV_SLUG).toBe('staging');
  });

  it('has no env slug on prod, so nothing is stamped', async () => {
    const { MINDS_ENV_SLUG } = await load('https://api.mindshub.ai');

    expect(MINDS_ENV_SLUG).toBe('');
  });

  it('derives auth on a permanent env the same way it always did', async () => {
    const { MINDS_AUTH_HOST } = await load('https://api.staging.mindshub.ai');

    expect(MINDS_AUTH_HOST).toBe('https://auth.staging.mindshub.ai');
  });
});

describe('resolveApiHost (main-process MindsHub host resolution)', () => {
  it('an explicit MINDS_API_HOST wins over everything', () => {
    expect(resolveApiHost('https://api.staging.mindshub.ai', 'https://api.mindshub.ai', 'prod')).toBe(
      'https://api.staging.mindshub.ai',
    );
  });

  it('a baked build URL wins over the channel default', () => {
    expect(resolveApiHost('', 'https://api.mindshub.ai', 'dev')).toBe('https://api.mindshub.ai');
  });

  // Unconfigured dev builds must resolve the same staging host in main and renderer.
  it('clean `npm run dev` (no env, nothing baked) resolves to the staging channel host, not prod', () => {
    expect(resolveApiHost('', '', 'dev')).toBe('https://api.staging.mindshub.ai');
  });

  it('prod is unchanged: an empty bake still resolves to the prod host', () => {
    expect(resolveApiHost('', '', 'prod')).toBe('https://api.mindshub.ai');
  });

  it('stable with no explicit/baked host resolves to the staging channel host', () => {
    expect(resolveApiHost('', '', 'stable')).toBe('https://api.staging.mindshub.ai');
  });

  it('normalizes a host carrying a path / trailing slash to a bare origin', () => {
    expect(resolveApiHost('', 'https://api.staging.mindshub.ai/v1/', 'stable')).toBe(
      'https://api.staging.mindshub.ai',
    );
  });
});

/*
 * Use an affordable probe model: paid-model denial on an empty wallet is indistinguishable from a
 * bad key.
 */
describe('MindsHub probe model and host detection', () => {
  it('probes the model the included allowance covers, not a wallet-billed one', () => {
    expect(MINDS_PROBE_MODEL).toBe('mindshub_air');
  });

  it('matches every MindsHub host shape, with or without a scheme', () => {
    for (const url of [
      'https://api.mindshub.ai/v1',
      'https://api.staging.mindshub.ai',
      'https://api-pr-12.dev.mindshub.ai/v1',
      'https://mindshub.ai',
      'https://mdb.ai/api/v1',
      'https://llm.mdb.ai',
      'api.mindshub.ai/v1',
    ]) {
      expect(isMindsHost(url), url).toBe(true);
    }
  });

  it('compares the hostname, so a lookalike domain or a redirect parameter does not match', () => {
    for (const url of [
      '',
      null,
      undefined,
      'https://api.openai.com/v1',
      'https://generativelanguage.googleapis.com/v1beta/openai/',
      'https://mindshub.ai.example.test/v1',
      'https://evil-mindshub.ai/v1',
      'https://example.test/r?u=https://api.mindshub.ai/v1',
    ]) {
      expect(isMindsHost(url), String(url)).toBe(false);
    }
  });

  it('answers false rather than throwing on a base URL that will not parse', () => {
    // Malformed free-text URLs must not throw before the caller's error handling.
    for (const url of ['https://[', 'https://a[b].mindshub.ai/v1', '[', 'https://]']) {
      expect(isMindsHost(url), url).toBe(false);
    }
  });
});
