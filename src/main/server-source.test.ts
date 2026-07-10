import { describe, it, expect, vi } from 'vitest';
import {
  getChannel,
  getCoworkRef,
  getAntonRef,
  getInstallSpec,
  getAppDisplayVersion,
  COWORK_SERVER_MIN_VERSION,
} from './server-source';
import { withEnv } from '../../tests/helpers/env';

// getAppDisplayVersion lazily requires electron via bare CJS `require()`,
// which vi.mock cannot intercept (in Node the electron package resolves to a
// binary-path string, not the runtime API). Seed the CJS require cache with a
// stub before the lazy require fires.
import { createRequire } from 'node:module';
const cjsRequire = createRequire(import.meta.url);
const electronId = cjsRequire.resolve('electron');
cjsRequire.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: { app: { getVersion: () => '9.9.9' } },
} as never;

// The env is scrubbed before each test (tests/setup-env.ts), so "no env set"
// is the true default install path. The build-ref fallback (_buildRef) is
// exercised implicitly: ./build-channel.gen does not exist in the test env,
// so the catch path (→ '') runs on every default-ref assertion below.

describe('getChannel', () => {
  it('defaults to git when unset', () => {
    expect(getChannel()).toBe('git');
  });

  it('returns pypi when COWORK_SERVER_CHANNEL=pypi', () => {
    withEnv({ COWORK_SERVER_CHANNEL: 'pypi' }, () => {
      expect(getChannel()).toBe('pypi');
    });
  });

  it('is case-insensitive', () => {
    withEnv({ COWORK_SERVER_CHANNEL: 'PyPI' }, () => {
      expect(getChannel()).toBe('pypi');
    });
  });

  it('falls back to git on a garbage value', () => {
    withEnv({ COWORK_SERVER_CHANNEL: 'not-a-channel' }, () => {
      expect(getChannel()).toBe('git');
    });
  });
});

describe('getAppDisplayVersion', () => {
  it('falls back to app.getVersion() when no build-time version is baked', () => {
    // build-channel.gen doesn't exist in the test env, so the baked-value
    // branch is empty and electron's package.json version wins.
    expect(getAppDisplayVersion()).toBe('9.9.9');
  });
});

describe('getCoworkRef / getAntonRef', () => {
  it('default to main', () => {
    expect(getCoworkRef()).toBe('main');
    expect(getAntonRef()).toBe('main');
  });

  it('honour env overrides', () => {
    withEnv({ COWORK_SERVER_REF: 'v1.2.3', ANTON_REF: 'abc123' }, () => {
      expect(getCoworkRef()).toBe('v1.2.3');
      expect(getAntonRef()).toBe('abc123');
    });
  });

  it('fall back to main on whitespace-only values', () => {
    withEnv({ COWORK_SERVER_REF: '   ', ANTON_REF: '\t' }, () => {
      expect(getCoworkRef()).toBe('main');
      expect(getAntonRef()).toBe('main');
    });
  });
});

describe('getInstallSpec', () => {
  it('default git install adds NO anton override (regression: the "conflicting URLs" bug)', () => {
    // On the default git channel with anton on `main`, uv must receive NO
    // anton-agent override — cowork-server's own [tool.uv.sources] pin decides
    // the anton version. A second URL requirement for the same package makes uv
    // abort with "conflicting URLs" and broke every fresh install. This is the
    // guard for that regression.
    const spec = getInstallSpec();

    expect(spec.channel).toBe('git');
    expect(spec.package).toBe('git+https://github.com/mindsdb/cowork-server.git@main');
    expect(spec.overrides).toEqual([]);
  });

  it('non-default ANTON_REF repoints anton via a uv override (not a flag)', () => {
    // Overrides replace cowork-server's [tool.uv.sources] anton-agent pin
    // cleanly (no "conflicting URLs") and are honoured by every uv version —
    // unlike the per-package `--no-sources-package` flag, which older uv builds
    // reject with "unexpected argument".
    withEnv({ ANTON_REF: 'feat/x' }, () => {
      const spec = getInstallSpec();
      expect(spec.channel).toBe('git');
      expect(spec.overrides).toEqual([
        'anton-agent @ git+https://github.com/mindsdb/anton.git@feat/x',
      ]);
    });
  });

  it('COWORK_SERVER_REF changes the git ref in the package spec', () => {
    withEnv({ COWORK_SERVER_REF: 'feat/y' }, () => {
      const spec = getInstallSpec();
      expect(spec.package).toBe('git+https://github.com/mindsdb/cowork-server.git@feat/y');
      expect(spec.overrides).toEqual([]); // anton still default → no override
    });
  });

  it('pypi channel pins the min version and adds no override', () => {
    withEnv({ COWORK_SERVER_CHANNEL: 'pypi' }, () => {
      const spec = getInstallSpec();
      expect(spec.channel).toBe('pypi');
      expect(spec.package).toBe(`cowork-server>=${COWORK_SERVER_MIN_VERSION}`);
      expect(spec.overrides).toEqual([]);
    });
  });

  it('pypi channel ignores ANTON_REF (wheel pins its own anton dependency)', () => {
    withEnv({ COWORK_SERVER_CHANNEL: 'pypi', ANTON_REF: 'feat/x' }, () => {
      const spec = getInstallSpec();
      expect(spec.channel).toBe('pypi');
      expect(spec.overrides).toEqual([]);
    });
  });

  describe('COWORK_SERVER_PACKAGE escape hatch', () => {
    it('wins over the channel and refs', () => {
      withEnv(
        {
          COWORK_SERVER_PACKAGE: '/local/path/cowork-server',
          COWORK_SERVER_CHANNEL: 'pypi',
          COWORK_SERVER_REF: 'feat/ignored',
        },
        () => {
          const spec = getInstallSpec();
          expect(spec.package).toBe('/local/path/cowork-server');
          // channel still reports what the env says, but the package is literal
          expect(spec.channel).toBe('pypi');
        },
      );
    });

    it('honours ANTON_PACKAGE only alongside COWORK_SERVER_PACKAGE', () => {
      withEnv(
        {
          COWORK_SERVER_PACKAGE: '/local/cowork-server',
          ANTON_PACKAGE: '/local/anton',
        },
        () => {
          expect(getInstallSpec().overrides).toEqual(['anton-agent @ /local/anton']);
        },
      );
    });

    it('ignores ANTON_PACKAGE when COWORK_SERVER_PACKAGE is not set', () => {
      withEnv({ ANTON_PACKAGE: '/local/anton' }, () => {
        const spec = getInstallSpec();
        // falls through to the normal git path: no override, git package
        expect(spec.package).toBe('git+https://github.com/mindsdb/cowork-server.git@main');
        expect(spec.overrides).toEqual([]);
      });
    });
  });

  describe('explicit ref opts (rollback path)', () => {
    it('override env refs', () => {
      withEnv({ COWORK_SERVER_REF: 'env-ref', ANTON_REF: 'env-anton' }, () => {
        const spec = getInstallSpec({ coworkRef: 'rollback-sha', antonRef: 'anton-sha' });
        expect(spec.package).toBe('git+https://github.com/mindsdb/cowork-server.git@rollback-sha');
        expect(spec.overrides).toEqual([
          'anton-agent @ git+https://github.com/mindsdb/anton.git@anton-sha',
        ]);
      });
    });

    it('opts antonRef=main suppresses the override even when env ANTON_REF is set', () => {
      withEnv({ ANTON_REF: 'feat/x' }, () => {
        const spec = getInstallSpec({ antonRef: 'main' });
        expect(spec.overrides).toEqual([]);
      });
    });
  });
});
