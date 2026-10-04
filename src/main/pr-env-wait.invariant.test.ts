import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Regression guard: the PR-environment wait looks for the value the PR build
// stamps.
//
// mindsdb/deployer serves a pull request's `development-head-<head sha>` image.
// GitHub builds a PR from a merge commit that it regenerates whenever the base
// moves, and a rebuild for the same head does not change the tag the deployer
// pins. So the environment keeps serving the earlier build, stamped with the
// earlier merge commit. A live PR environment did exactly that: it served a
// bundle stamped with a merge commit its pull request no longer had.
//
// build-deploy.yml therefore stamps the PR head as VITE_APP_VERSION, and
// dev-build-deploy.yml's pr-env-wait waits until the host serves that head. If
// either side goes back to the merge commit (`github.sha`, `env.SLUG`), every
// wait after a base move runs out, and the PR reports no environment while one
// is up.

const WORKFLOWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');
const read = (file: string): string => readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');

const PR_HEAD = 'github.event.pull_request.head.sha';

/** The expression build-deploy.yml bakes in as VITE_APP_VERSION. */
const stampedVersion = (): string | undefined =>
  /--build-arg VITE_APP_VERSION=\$\{\{\s*(.+?)\s*\}\}/.exec(read('build-deploy.yml'))?.[1];

/** The pr-env-wait job, up to the next job at the same indent. */
const waitJob = (): string | undefined => {
  const text = read('dev-build-deploy.yml');
  const start = text.indexOf('\n  pr-env-wait:\n');
  if (start === -1) return undefined;
  const job = text.slice(start + 1);
  const end = job.search(/\n {2}[a-z][a-z-]*:\n/);
  return end === -1 ? job : job.slice(0, end);
};

describe('the PR-environment wait looks for what the PR build stamps', () => {
  it('stamps the PR head, falling back to the branch head off a pull request', () => {
    expect(stampedVersion()).toBe(`${PR_HEAD} || env.SLUG`);
  });

  it('waits for the PR head in the served bundle', () => {
    const job = waitJob();
    expect(job, 'dev-build-deploy.yml must define pr-env-wait').toBeDefined();
    expect(job).toContain(`HEAD_SHA: \${{ ${PR_HEAD} }}`);
    expect(job).toContain('grep -qF "$HEAD_SHA"');
  });
});
