import { describe, it, expect, vi } from 'vitest';

// Stub Electron before import; the Node test environment otherwise resolves it to a path string.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test', isPackaged: false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {},
}));

import { buildMindsEnvContent, mindsSignInSettingWrites, runsOwnEndpoint } from './minds-auth';

describe('buildMindsEnvContent (MindsHub sign-in .env)', () => {
  // Sign-in writes configuration only; hand the gateway credential to the sidecar at runtime.
  it('writes no credential at all', () => {
    const out = buildMindsEnvContent('', 'https://mdb.ai');
    expect(out).not.toMatch(/ANTON_MINDS_API_KEY/);
    expect(out).not.toMatch(/mdb_/);
  });

  it('strips a credential an earlier build left behind', () => {
    // Sign-in must remove legacy bearer-token lines from disk.
    const existing = 'ANTON_MINDS_API_KEY=mdb_old\nANTON_MINDS_ENABLED=true';
    const out = buildMindsEnvContent(existing, 'https://mdb.ai');
    expect(out).not.toMatch(/ANTON_MINDS_API_KEY/);
    expect(out).not.toMatch(/mdb_old/);
  });

  it('writes no ANTON_PLANNING_MODEL / ANTON_CODING_MODEL on a fresh sign-in', () => {
    const out = buildMindsEnvContent('', 'https://mdb.ai');
    expect(out).not.toMatch(/ANTON_PLANNING_MODEL=/);
    expect(out).not.toMatch(/ANTON_CODING_MODEL=/);
  });

  it('preserves a user-set model line in .env on re-login (does not strip it)', () => {
    const existing = [
      'ANTON_MINDS_API_KEY=mdb_old',
      // A value the user deliberately set for the standalone CLI. A `latest:`
      // prefix is not provable provenance, so we must not silently drop it.
      'ANTON_PLANNING_MODEL=latest:opus',
      'ANTON_CODING_MODEL=latest:opus',
      'SOME_OTHER_KEY=keepme',
    ].join('\n');
    const out = buildMindsEnvContent(existing, 'https://mdb.ai');
    expect(out).toMatch(/ANTON_PLANNING_MODEL=latest:opus/);
    expect(out).toMatch(/ANTON_CODING_MODEL=latest:opus/);
    expect(out).toMatch(/SOME_OTHER_KEY=keepme/);
  });

  it('sets minds-cloud as planning + coding provider', () => {
    const out = buildMindsEnvContent('', 'https://mdb.ai');
    expect(out).toMatch(/ANTON_MINDS_ENABLED=true/);
    expect(out).toMatch(/ANTON_MINDS_URL=https:\/\/mdb\.ai/);
    expect(out).toMatch(/ANTON_PLANNING_PROVIDER=minds-cloud/);
    expect(out).toMatch(/ANTON_CODING_PROVIDER=minds-cloud/);
  });

  it('replaces (does not duplicate) the URL on re-login', () => {
    const existing = 'ANTON_MINDS_URL=https://old.example\nANTON_MINDS_ENABLED=true';
    const out = buildMindsEnvContent(existing, 'https://mdb.ai');
    expect(out.match(/ANTON_MINDS_URL=/g)).toHaveLength(1);
    expect(out).toMatch(/ANTON_MINDS_URL=https:\/\/mdb\.ai/);
    expect(out).not.toMatch(/old\.example/);
  });
});

describe('mindsSignInSettingWrites (DB sync on sign-in)', () => {
  it('never writes the credential as a setting', () => {
    // The sidecar's settings table is one of the three places the key used to
    // land. It gets the value over the runtime hand-over instead.
    const keys = mindsSignInSettingWrites('https://api.mindshub.ai').map((w) => w.key);
    expect(keys).not.toContain('minds_api_key');
  });

  // Sign-in must write only configuration keys; bulk .env synchronization could overwrite a
  // deliberate model selection.
  it('writes exactly the provider fields, and no model fields', () => {
    const writes = mindsSignInSettingWrites('https://api.mindshub.ai');
    const keys = writes.map((w) => w.key);
    // Persist router_provider too; an absent row exposes the server's anthropic default and can
    // trigger unwanted model pinning on a later save.
    expect(keys).toEqual([
      'minds_url', 'planning_provider', 'coding_provider', 'router_provider',
    ]);
    // The whole point: no model row is ever touched on sign-in, so a picker
    // fix (mindshub_air) and an intentional latest:opus both survive.
    expect(keys).not.toContain('planning_model');
    expect(keys).not.toContain('coding_model');
    expect(keys).not.toContain('router_model');
  });

  it('uses the DB enum provider value (minds_cloud, underscore) — matching the picker', () => {
    const writes = mindsSignInSettingWrites('https://api.mindshub.ai');
    const providers = writes.filter((w) => w.key.endsWith('_provider'));
    expect(providers.every((w) => w.value === 'minds_cloud')).toBe(true);
  });

  it('carries the host through', () => {
    const writes = mindsSignInSettingWrites('https://api.mindshub.ai');
    const byKey = Object.fromEntries(writes.map((w) => [w.key, w.value]));
    expect(byKey.minds_url).toBe('https://api.mindshub.ai');
  });
});

// Connecting MindsHub is also how publishing and connectors are enabled, so it
// must not silently move a user's turns off the endpoint they chose.
describe('sign-in leaves a user-owned endpoint routing alone', () => {
  const LAN = [
    'ANTON_OPENAI_API_KEY=not-needed',
    'ANTON_OPENAI_BASE_URL=http://192.168.1.100:1234/v1',
    'ANTON_PLANNING_PROVIDER=openai-compatible',
    'ANTON_CODING_PROVIDER=openai-compatible',
  ].join('\n') + '\n';

  it('detects a LAN endpoint as the user\'s own', () => {
    expect(runsOwnEndpoint(LAN, 'https://api.mindshub.ai')).toBe(true);
  });

  it('does not treat a MindsHub base URL as the user\'s own', () => {
    const hosted = 'ANTON_OPENAI_BASE_URL=https://api.mindshub.ai/v1\n';
    expect(runsOwnEndpoint(hosted, 'https://api.mindshub.ai')).toBe(false);
  });

  it('does not treat the incoming MindsHub host as the user\'s own', () => {
    const other = [
      'ANTON_MINDS_URL=https://api.staging.mindshub.ai',
      'ANTON_OPENAI_BASE_URL=https://api.staging.mindshub.ai/v1',
    ].join('\n') + '\n';
    expect(runsOwnEndpoint(other, 'https://api.mindshub.ai')).toBe(false);
  });

  it('keeps the .env provider lines pointed at the local endpoint', () => {
    const out = buildMindsEnvContent(LAN, 'https://api.mindshub.ai');
    expect(out).toContain('ANTON_PLANNING_PROVIDER=openai-compatible');
    expect(out).toContain('ANTON_CODING_PROVIDER=openai-compatible');
    expect(out).not.toContain('ANTON_PLANNING_PROVIDER=minds-cloud');
    expect(out).toContain('ANTON_MINDS_URL=https://api.mindshub.ai');
    expect(out).toContain('ANTON_OPENAI_BASE_URL=http://192.168.1.100:1234/v1');
  });

  it('writes only the URL to the DB, never a provider repoint', () => {
    const keys = mindsSignInSettingWrites('https://api.mindshub.ai', true).map((w) => w.key);
    expect(keys).toEqual(['minds_url']);
  });

  it('still repoints when no endpoint of the user\'s own is configured', () => {
    const out = buildMindsEnvContent('ANTON_TERMS_CONSENT=true\n', 'https://api.mindshub.ai');
    expect(out).toContain('ANTON_PLANNING_PROVIDER=minds-cloud');
    const keys = mindsSignInSettingWrites('https://api.mindshub.ai').map((w) => w.key);
    expect(keys).toContain('planning_provider');
    expect(keys).toContain('router_provider');
  });
});
