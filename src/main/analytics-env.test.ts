import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyticsEnv, antonDotenvNames, NON_PROD_POSTHOG_KEY } from './analytics-env';
import { BUILD_KINDS } from './channels';

// anton's own default, the production project. Written out so a change to the
// non-prod key that lands on this value fails here.
const PRODUCTION_POSTHOG_KEY = 'phc_ypFMKbvAwRsLuDCToox2AkEg5wx6ReBfkyi3kX2zw6VK';

describe('analyticsEnv', () => {
  it.each(['dev', 'preview', 'stable'] as const)(
    'sends a %s build to the non-production project', (kind) => {
      expect(analyticsEnv(kind, {}).ANTON_POSTHOG_KEY).toBe(NON_PROD_POSTHOG_KEY);
    });

  it('leaves prod on anton\'s production default', () => {
    expect(analyticsEnv('prod', {})).not.toHaveProperty('ANTON_POSTHOG_KEY');
  });

  it('never routes a build kind to the production project', () => {
    expect(NON_PROD_POSTHOG_KEY).not.toBe(PRODUCTION_POSTHOG_KEY);
  });

  it.each([
    ['dev', 'dev'], ['preview', 'preview'], ['stable', 'staging'], ['prod', 'prod'],
  ] as const)('labels a %s build\'s events as %s', (kind, label) => {
    expect(analyticsEnv(kind, {}).ANTON_DEPLOYMENT_ENV).toBe(label);
  });

  it('labels every build kind', () => {
    for (const kind of BUILD_KINDS) {
      expect(analyticsEnv(kind, {}).ANTON_DEPLOYMENT_ENV).toMatch(/^[a-z]+$/);
    }
  });

  it('leaves values the environment already sets to the environment', () => {
    const env = { ANTON_POSTHOG_KEY: 'phc_other', ANTON_DEPLOYMENT_ENV: 'eval' };
    expect(analyticsEnv('stable', env)).toEqual({});
  });

  // An empty key is how anton's direct PostHog sink is switched off, so it is
  // a value, not an absence.
  it.each(['dev', 'preview', 'stable'] as const)(
    'leaves values the environment sets to empty on a %s build', (kind) => {
      const env = { ANTON_POSTHOG_KEY: '', ANTON_DEPLOYMENT_ENV: '' };
      expect(analyticsEnv(kind, env)).toEqual({});
    });

  it('leaves values set in one of anton\'s dotenv files to that file', () => {
    const names = new Set(['ANTON_POSTHOG_KEY', 'ANTON_DEPLOYMENT_ENV']);
    expect(analyticsEnv('stable', {}, names)).toEqual({});
  });
});

describe('antonDotenvNames', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'anton-dotenv-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const write = (rel: string, text: string) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };

  it.each([
    'home/.cowork/.env', 'home/.anton/.env', 'cwd/.env', 'cwd/.anton/.env',
  ])('reads %s', (rel) => {
    write(rel, 'ANTON_POSTHOG_KEY=\n');
    expect(antonDotenvNames(path.join(root, 'cwd'), path.join(root, 'home')))
      .toContain('ANTON_POSTHOG_KEY');
  });

  it('matches the names anton matches: any case, with or without export', () => {
    write('home/.cowork/.env', '# ANTON_IGNORED=1\nexport anton_posthog_key=""\nAnton_Deployment_Env = eval\n');
    expect([...antonDotenvNames(path.join(root, 'cwd'), path.join(root, 'home'))].sort())
      .toEqual(['ANTON_DEPLOYMENT_ENV', 'ANTON_POSTHOG_KEY']);
  });

  it('reads a single-quoted name, as anton does', () => {
    write('home/.cowork/.env', "'ANTON_POSTHOG_KEY'=\"\"\n");
    expect(antonDotenvNames(path.join(root, 'cwd'), path.join(root, 'home')))
      .toContain('ANTON_POSTHOG_KEY');
  });

  // Each of these looks like a setting line but anton ignores it, so the
  // default still has to be injected.
  it.each([
    ['inside a multi-line quoted value', 'OTHER="a\nANTON_POSTHOG_KEY=\nb"\n'],
    ['with a double-quoted name', '"ANTON_POSTHOG_KEY"=""\n'],
    ['with no equals sign', 'ANTON_POSTHOG_KEY\n'],
    ['on a line anton cannot parse', 'ANTON_POSTHOG_KEY="" junk\n'],
    ['after a failed statement, on the line it failed on', "'a\nANTON_POSTHOG_KEY=1' z\n"],
  ])('skips a name %s', (_label, text) => {
    write('home/.cowork/.env', text);
    expect(antonDotenvNames(path.join(root, 'cwd'), path.join(root, 'home')))
      .not.toContain('ANTON_POSTHOG_KEY');
  });

  it('keeps reading after a line anton cannot parse', () => {
    write('home/.cowork/.env', 'OTHER="unterminated\nANTON_POSTHOG_KEY=\n');
    expect(antonDotenvNames(path.join(root, 'cwd'), path.join(root, 'home')))
      .toContain('ANTON_POSTHOG_KEY');
  });

  it('is empty when none of the files exist', () => {
    expect(antonDotenvNames(path.join(root, 'cwd'), path.join(root, 'home')).size).toBe(0);
  });
});
