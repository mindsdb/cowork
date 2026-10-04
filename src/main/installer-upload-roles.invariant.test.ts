import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Regression guard: each installer upload path holds its own GitHub
// environment and assumes its own AWS role.
//
// A pull request uploads a preview, a push to staging uploads a stable build,
// and a push to main uploads a prod release. Each pipeline passes its build
// kind through build-installers.yml, and upload-installer-to-s3.yml picks the
// environment and the role from that kind. The environment sets the job's
// OIDC subject. Each role's trust policy (in the mindsdb/terraform repo)
// accepts only its own path's subject, so a path paired with another path's
// environment or role fails when it assumes the role. A pull request runs only
// the preview upload, and only with an installer label. So a wrong pair on the
// stable or prod path would first fail after the merge, on staging or main.
// This test fails the pull request instead.

const WORKFLOWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');
const read = (file: string): string => readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');

/** The installer roles live in the PROD account. */
const ROLE_ARN_PREFIX = 'arn:aws:iam::065786718370:role/';

interface UploadPath {
  /** The per-event pipeline that starts this path. */
  pipeline: string;
  /** The build_kind that pipeline passes to build-installers.yml. */
  buildKind: string;
  /** The GitHub environment the upload job holds, or '' for none. */
  environment: string;
  /** The name of the AWS role the upload job assumes. */
  role: string;
}

const UPLOAD_PATHS: UploadPath[] = [
  { pipeline: 'dev-build-deploy.yml', buildKind: 'preview', environment: '', role: 'gha-cowork-installer-preview' },
  { pipeline: 'staging-build-deploy.yml', buildKind: 'stable', environment: 'staging', role: 'gha-cowork-installer-staging' },
  { pipeline: 'prod-build-deploy.yml', buildKind: 'prod', environment: 'prod', role: 'gha-cowork-installer-prod' },
];

/** The value of every `<key>: <value>` line in a workflow, in file order. */
const valuesOf = (text: string, key: string): string[] =>
  [...text.matchAll(new RegExp(`^ +${key}: (.+)$`, 'gm'))].map((m) => m[1]);

/**
 * What GitHub makes of `${{ inputs.build_kind == 'a' && 'x' || ... || 'z' }}`
 * for one build kind: the value of the first arm whose kind matches, or else
 * the last value. An arm's value must not be empty, because GitHub skips an
 * empty one. Any other shape gives undefined, so rewriting the choice fails
 * this test instead of slipping past it.
 */
const resolve = (value: string, buildKind: string): string | undefined => {
  const terms = /^\$\{\{ (.+) \}\}$/.exec(value)?.[1].split(' || ') ?? [];
  const fallback = /^'([^']*)'$/.exec(terms.pop() ?? '');
  const arms = terms.map((term) => /^inputs\.build_kind == '(\w+)' && '([^']+)'$/.exec(term));
  if (!fallback || arms.includes(null)) return undefined;
  return arms.find((arm) => arm?.[1] === buildKind)?.[2] ?? fallback[1];
};

describe('each installer upload path holds its own environment and role', () => {
  const upload = read('upload-installer-to-s3.yml');
  const environments = valuesOf(upload, 'environment');
  const roles = valuesOf(upload, 'role-to-assume');

  // Anti-vacuous: a renamed key, or a second upload job, would leave the
  // pairing check below reading nothing or only part of the file.
  it('reads one environment choice and one role choice', () => {
    expect(environments).toHaveLength(1);
    expect(roles).toHaveLength(1);
  });

  it.each(UPLOAD_PATHS)('$pipeline uploads as build_kind $buildKind', ({ pipeline, buildKind }) => {
    expect(valuesOf(read(pipeline), 'build_kind')).toEqual([buildKind]);
  });

  // A literal here would send that platform's upload down another path,
  // whatever the pipeline asked for.
  it('build-installers.yml passes every call the build_kind it was given', () => {
    const kinds = valuesOf(read('build-installers.yml'), 'build_kind');
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.filter((kind) => kind !== '${{ inputs.build_kind }}')).toEqual([]);
  });

  it.each(UPLOAD_PATHS)(
    'a $buildKind upload holds environment $environment and assumes $role',
    ({ buildKind, environment, role }) => {
      expect(resolve(environments[0], buildKind)).toBe(environment);
      expect(resolve(roles[0], buildKind)).toBe(`${ROLE_ARN_PREFIX}${role}`);
    },
  );

  // Self-check, independent of the real files.
  it('resolves a choice the way GitHub does, and refuses any other shape', () => {
    const choice = "${{ inputs.build_kind == 'prod' && 'p' || inputs.build_kind == 'stable' && 's' || 'x' }}";
    expect(['preview', 'stable', 'prod'].map((kind) => resolve(choice, kind))).toEqual(['x', 's', 'p']);
    expect(resolve("${{ inputs.build_kind != 'prod' && 'p' || 'x' }}", 'stable')).toBeUndefined();
    expect(resolve("${{ inputs.build_kind == 'stable' && '' || 'x' }}", 'stable')).toBeUndefined();
  });
});
