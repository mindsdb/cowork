import { describe, it, expect } from 'vitest';
import { getInstallSpec } from './server-source';
import { withEnv } from '../../test/helpers/env';

// The env is scrubbed before each test (test/setup-env.ts), so "no env set"
// is the true default install path.
describe('getInstallSpec', () => {
  it('default git install does NOT add a --with arg (regression: the "conflicting URLs" bug)', () => {
    // On the default git channel with anton on `main`, uv must receive NO
    // `--with anton-agent @ ...` — a second URL requirement for the same
    // package makes uv abort with "conflicting URLs" and broke every fresh
    // install. This is the guard for that regression.
    const spec = getInstallSpec();

    expect(spec.channel).toBe('git');
    expect(spec.package).toBe('git+https://github.com/mindsdb/cowork-server.git@main');
    expect(spec.withArgs).toEqual([]);
  });

  it('injects exactly one --with pair when ANTON_REF is non-default', () => {
    withEnv({ ANTON_REF: 'feat/x' }, () => {
      const spec = getInstallSpec();
      expect(spec.channel).toBe('git');
      expect(spec.withArgs).toEqual([
        '--with',
        'anton-agent @ git+https://github.com/mindsdb/anton.git@feat/x',
      ]);
    });
  });

  it('pypi channel pins the min version and adds no --with', () => {
    withEnv({ COWORK_SERVER_CHANNEL: 'pypi' }, () => {
      const spec = getInstallSpec();
      expect(spec.channel).toBe('pypi');
      expect(spec.package).toMatch(/^cowork-server>=/);
      expect(spec.withArgs).toEqual([]);
    });
  });
});
