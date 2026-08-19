import { describe, it, expect, vi } from 'vitest';

// minds-urls resolves the API host at module load via buildKind(), which reads
// the electron `app`. Stub it (unpackaged → dev) so the module loads; the pure
// resolver under test takes the kind explicitly, so these cases don't depend on
// the stub.
vi.mock('electron', () => ({ app: { isPackaged: false } }));

import { MINDS_PROBE_MODEL, isMindsHost, resolveApiHost } from './minds-urls';

describe('resolveApiHost (main-process MindsHub host resolution)', () => {
  it('an explicit MINDS_API_HOST wins over everything', () => {
    expect(resolveApiHost('https://api.staging.mindshub.ai', 'https://api.mindshub.ai', 'prod')).toBe(
      'https://api.staging.mindshub.ai',
    );
  });

  it('a baked build URL wins over the channel default', () => {
    expect(resolveApiHost('', 'https://api.mindshub.ai', 'dev')).toBe('https://api.mindshub.ai');
  });

  // The bug this fixes: `npm run dev` bakes nothing and sets no MINDS_API_HOST,
  // so the main process used to fall back to a hard-coded PROD host while the
  // renderer fell back to staging — a split brain. Now the dev channel (which
  // targets staging) drives the main process too, matching the renderer.
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
 * The probe model and the host test both exist to keep a valid MindsHub key from
 * reading as a broken one. MindsHub bills per model, so probing a paid model is
 * denied for an empty wallet and the denial is indistinguishable from a bad key.
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
    // The base URL is free text off the provider card, and this runs before the
    // caller's try/catch in the sidecar's equivalent, where an unguarded parse
    // turned a failed validation into a 500. Unbalanced brackets are what does it.
    for (const url of ['https://[', 'https://a[b].mindshub.ai/v1', '[', 'https://]']) {
      expect(isMindsHost(url), url).toBe(false);
    }
  });
});
