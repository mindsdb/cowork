import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mutable getter so the module-load test can toggle packaged state before reimport.
const appState = vi.hoisted(() => ({ isPackaged: false }));
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged;
    },
  },
}));

import { sanitizePackagedEnv, CHANNEL_SCOPING_ENV_VARS } from './sanitize-packaged-env';

describe('sanitizePackagedEnv (ENG-1353: packaged builds ignore ambient channel scope)', () => {
  function seed(): NodeJS.ProcessEnv {
    return {
      COWORK_HOME: '/tmp/other-channel',
      COWORK_SERVER_PORT: '27881',
      COWORK_LISTEN_PORT: '27881',
      ANTON_SERVER_PORT: '27881',
      COWORK_BUILD_KIND: 'stable',
      UV_TOOL_DIR: '/tmp/other-channel/uv/tools',
      UV_TOOL_BIN_DIR: '/tmp/other-channel/uv/bin',
      MINDS_API_HOST: 'https://api.staging.mindshub.ai',
      PATH: '/usr/bin', // unrelated var; must survive both modes
    };
  }

  it('strips every channel-scoping var when packaged, leaving unrelated vars', () => {
    const env = seed();
    sanitizePackagedEnv(env, true);
    for (const key of CHANNEL_SCOPING_ENV_VARS) expect(env[key]).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });

  it('leaves everything untouched when unpackaged (dev/web/tests keep their overrides)', () => {
    const env = seed();
    const before = { ...env };
    sanitizePackagedEnv(env, false);
    expect(env).toEqual(before);
  });

  it('is a no-op when the vars are already absent', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    sanitizePackagedEnv(env, true);
    expect(env).toEqual({ PATH: '/usr/bin' });
  });
});

// Guards the wiring: importing the module runs the scrub, gated on isPackaged.
describe('sanitize-packaged-env module-load side effect', () => {
  beforeEach(() => {
    for (const key of CHANNEL_SCOPING_ENV_VARS) delete process.env[key];
  });
  afterEach(() => {
    for (const key of CHANNEL_SCOPING_ENV_VARS) delete process.env[key];
    appState.isPackaged = false;
  });

  it('scrubs process.env on import when packaged', async () => {
    appState.isPackaged = true;
    process.env.COWORK_HOME = '/tmp/other-channel';
    process.env.MINDS_API_HOST = 'https://api.staging.mindshub.ai';
    vi.resetModules();
    await import('./sanitize-packaged-env');
    expect(process.env.COWORK_HOME).toBeUndefined();
    expect(process.env.MINDS_API_HOST).toBeUndefined();
  });

  it('leaves process.env untouched on import when unpackaged', async () => {
    appState.isPackaged = false;
    process.env.COWORK_HOME = '/tmp/dev-home';
    vi.resetModules();
    await import('./sanitize-packaged-env');
    expect(process.env.COWORK_HOME).toBe('/tmp/dev-home');
  });
});
