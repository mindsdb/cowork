import { describe, it, expect, vi } from 'vitest';

// minds-auth transitively imports server-process, which statically imports
// `electron`. In the node test env `electron` resolves to a path string, so
// stub it before importing the module under test.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test', isPackaged: false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {},
}));

import { buildMindsEnvContent } from './minds-auth';

describe('buildMindsEnvContent (MindsHub sign-in .env)', () => {
  // ─── ENG-739 / ENG-597 regression: sign-in must not pin a model ─────
  it('writes no ANTON_PLANNING_MODEL / ANTON_CODING_MODEL', () => {
    const out = buildMindsEnvContent('', 'mdb_abc', 'https://mdb.ai');
    expect(out).not.toMatch(/ANTON_PLANNING_MODEL=/);
    expect(out).not.toMatch(/ANTON_CODING_MODEL=/);
  });

  it('strips a stale `latest:` model pin left over from a prior sign-in', () => {
    const existing = [
      'ANTON_MINDS_API_KEY=mdb_old',
      'ANTON_PLANNING_MODEL=latest:sonnet',
      'ANTON_CODING_MODEL=latest:haiku',
      'SOME_OTHER_KEY=keepme',
    ].join('\n');
    const out = buildMindsEnvContent(existing, 'mdb_new', 'https://mdb.ai');
    expect(out).not.toMatch(/ANTON_PLANNING_MODEL=/);
    expect(out).not.toMatch(/ANTON_CODING_MODEL=/);
    // Unrelated keys are preserved.
    expect(out).toMatch(/SOME_OTHER_KEY=keepme/);
  });

  it('sets minds-cloud as planning + coding provider with the fresh key', () => {
    const out = buildMindsEnvContent('', 'mdb_abc', 'https://mdb.ai');
    expect(out).toMatch(/ANTON_MINDS_ENABLED=true/);
    expect(out).toMatch(/ANTON_MINDS_API_KEY=mdb_abc/);
    expect(out).toMatch(/ANTON_MINDS_URL=https:\/\/mdb\.ai/);
    expect(out).toMatch(/ANTON_PLANNING_PROVIDER=minds-cloud/);
    expect(out).toMatch(/ANTON_CODING_PROVIDER=minds-cloud/);
  });

  it('replaces (does not duplicate) the credential on re-login', () => {
    const existing = 'ANTON_MINDS_API_KEY=mdb_old\nANTON_MINDS_ENABLED=true';
    const out = buildMindsEnvContent(existing, 'mdb_new', 'https://mdb.ai');
    expect(out.match(/ANTON_MINDS_API_KEY=/g)).toHaveLength(1);
    expect(out).toMatch(/ANTON_MINDS_API_KEY=mdb_new/);
    expect(out).not.toMatch(/mdb_old/);
  });
});
