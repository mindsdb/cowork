import { describe, it, expect, vi } from 'vitest';

// minds-auth transitively imports server-process, which statically imports
// `electron`. In the node test env `electron` resolves to a path string, so
// stub it before importing the module under test.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test', isPackaged: false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {},
}));

// minds-auth also transitively imports server-process → credential-provisioning
// (ENG-1241) → keychain-service, which loads the native `keytar` module at
// import time — fine on macOS/Windows, but it requires libsecret on Linux,
// which CI's runner doesn't have. Mocked here purely to make the import chain
// safe; this suite never calls anything credential-related.
vi.mock('./credential-provisioning', () => ({
  loadBundledServerCredentials: vi.fn().mockResolvedValue({}),
}));

import { buildMindsEnvContent, mindsSignInSettingWrites } from './minds-auth';

describe('buildMindsEnvContent (MindsHub sign-in .env)', () => {
  // ─── ENG-739 / ENG-597 regression: sign-in must not pin a model ─────
  it('writes no ANTON_PLANNING_MODEL / ANTON_CODING_MODEL on a fresh sign-in', () => {
    const out = buildMindsEnvContent('', 'mdb_abc', 'https://mdb.ai');
    expect(out).not.toMatch(/ANTON_PLANNING_MODEL=/);
    expect(out).not.toMatch(/ANTON_CODING_MODEL=/);
  });

  // ─── ENG-739 review: re-login must NOT wipe an intentional model line ─
  it('preserves a user-set model line in .env on re-login (does not strip it)', () => {
    const existing = [
      'ANTON_MINDS_API_KEY=mdb_old',
      // A value the user deliberately set for the standalone CLI. A `latest:`
      // prefix is not provable provenance, so we must not silently drop it.
      'ANTON_PLANNING_MODEL=latest:opus',
      'ANTON_CODING_MODEL=latest:opus',
      'SOME_OTHER_KEY=keepme',
    ].join('\n');
    const out = buildMindsEnvContent(existing, 'mdb_new', 'https://mdb.ai');
    // The intentional model lines survive verbatim.
    expect(out).toMatch(/ANTON_PLANNING_MODEL=latest:opus/);
    expect(out).toMatch(/ANTON_CODING_MODEL=latest:opus/);
    // Unrelated keys are preserved.
    expect(out).toMatch(/SOME_OTHER_KEY=keepme/);
    // …and the fresh credential still replaced the old one.
    expect(out).toMatch(/ANTON_MINDS_API_KEY=mdb_new/);
    expect(out).not.toMatch(/mdb_old/);
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

describe('mindsSignInSettingWrites (DB sync on sign-in)', () => {
  // ─── ENG-739 review: sign-in must never write a model row to the DB ──
  // The old path POSTed the full .env to /settings/raw, which re-syncs every
  // recognised key — so a legacy/stale .env model line could clobber a model
  // the user just fixed via the picker. We now write only these keys.
  it('writes exactly the credential + provider fields, and no model fields', () => {
    const writes = mindsSignInSettingWrites('mdb_abc', 'https://api.mindshub.ai');
    const keys = writes.map((w) => w.key);
    expect(keys).toEqual(['minds_api_key', 'minds_url', 'planning_provider', 'coding_provider']);
    // Ordering is load-bearing: the credential MUST be written first so a
    // failed key write can abort before the provider flips to minds-cloud
    // (avoids a "provider=minds-cloud + dead key" partial state). ENG-739 review.
    expect(keys[0]).toBe('minds_api_key');
    // The whole point: neither model row is ever touched on sign-in, so a
    // picker fix (mindshub_air) and an intentional latest:opus both survive.
    expect(keys).not.toContain('planning_model');
    expect(keys).not.toContain('coding_model');
  });

  it('uses the DB enum provider value (minds_cloud, underscore) — matching the picker', () => {
    const writes = mindsSignInSettingWrites('mdb_abc', 'https://api.mindshub.ai');
    const providers = writes.filter((w) => w.key.endsWith('_provider'));
    expect(providers.every((w) => w.value === 'minds_cloud')).toBe(true);
  });

  it('carries the freshly-minted key and host through', () => {
    const writes = mindsSignInSettingWrites('mdb_new', 'https://api.mindshub.ai');
    const byKey = Object.fromEntries(writes.map((w) => [w.key, w.value]));
    expect(byKey.minds_api_key).toBe('mdb_new');
    expect(byKey.minds_url).toBe('https://api.mindshub.ai');
  });
});
