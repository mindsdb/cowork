import { describe, it, expect, vi } from 'vitest';

// minds-urls resolves the API host at module load via buildKind(), which reads
// the electron `app`. Stub it (unpackaged → dev) so the module loads; the pure
// resolver under test takes the kind explicitly, so these cases don't depend on
// the stub.
vi.mock('electron', () => ({ app: { isPackaged: false } }));

import { resolveApiHost } from './minds-urls';

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
