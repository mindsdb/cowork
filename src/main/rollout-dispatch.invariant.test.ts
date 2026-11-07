import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

// Regression guard: the rollout hands the deploy repository the digest this
// build pushed, names no AWS account and no private repository, and treats a
// rollout refused because a newer commit took the branch as superseded.
//
// The deploy repository deploys only the branch head. Two merges inside one
// build window queue behind each other, so the older one finishes its build
// after the newer one is the head, and the deploy repository refuses it. That
// run used to go red and post a failure while the newer one deployed. The
// tests run the step's real script with `gh` and `git` faked.

const WORKFLOWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');
const read = (file: string): string => readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface Job {
  outputs?: Record<string, string>;
  steps: Step[];
}

const jobs = (yaml.load(read('build-deploy.yml')) as { jobs: Record<string, Job> }).jobs;
const stepNamed = (job: Job, name: string): Step => {
  const steps = job.steps.filter((step) => step.name === name);
  expect(steps).toHaveLength(1);
  return steps[0];
};
const stepUsing = (job: Job, action: string): Step => {
  const steps = job.steps.filter((step) => step.uses?.startsWith(`${action}@`));
  expect(steps).toHaveLength(1);
  return steps[0];
};
const ROLLOUT = stepNamed(jobs.deploy, 'Roll out through the deploy repository');

const SHA = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);
const DIGEST = `sha256:${'e5'.repeat(32)}`;
const RUN_URL = 'https://github.com/mindsdb/example-deploy/actions/runs/42';

interface Rollout {
  status: number | null;
  stdout: string;
  calls: string[];
}

/** Run the rollout script on a staging build of SHA, with the branch at `head`. */
function rollOut({ dispatchPrints, watchStatus, head }: { dispatchPrints: string; watchStatus: number; head: string }): Rollout {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rollout-'));
  const log = path.join(dir, 'calls.log');
  const stub = (name: string, body: string): void => {
    const file = path.join(dir, name);
    writeFileSync(file, `#!/usr/bin/env bash\nprintf '%s\\n' "${name} $*" >> "$STUB_LOG"\n${body}\n`);
    chmodSync(file, 0o755);
  };
  stub('gh', [
    'case "$1 $2" in',
    '  "workflow run") printf \'%s\\n\' "$STUB_DISPATCH" ;;',
    '  "run watch") exit "$STUB_WATCH_STATUS" ;;',
    '  "run view") echo failure ;;',
    '  *) echo "unexpected: gh $*" >&2; exit 2 ;;',
    'esac',
  ].join('\n'));
  stub('git', '[ "$1" = ls-remote ] || exit 2\nprintf \'%s\\trefs/heads/staging\\n\' "$STUB_HEAD"');
  const script = path.join(dir, 'step.sh');
  writeFileSync(script, ROLLOUT.run ?? '');
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      STUB_LOG: log,
      STUB_DISPATCH: dispatchPrints,
      STUB_WATCH_STATUS: String(watchStatus),
      STUB_HEAD: head,
      GH_TOKEN: 'app-token',
      DEPLOY_REPOSITORY: 'mindsdb/example-deploy',
      DIGEST,
      DEPLOY_ENV: 'staging',
      BRANCH: 'staging',
      GITHUB_SHA: SHA,
      GITHUB_REPOSITORY: 'mindsdb/cowork',
    },
  });
  let calls: string[] = [];
  try {
    calls = readFileSync(log, 'utf8').trim().split('\n');
  } catch {
    // No stub ran.
  }
  return { status: result.status, stdout: result.stdout, calls };
}

describe('the rollout dispatch', () => {
  it('hands the deploy repository the digest this build pushed', () => {
    expect(jobs.build.outputs?.digest).toBe('${{ steps.pushed.outputs.digest }}');
    expect(ROLLOUT.env?.DIGEST).toBe('${{ needs.build.outputs.digest }}');

    const run = rollOut({ dispatchPrints: RUN_URL, watchStatus: 0, head: SHA });

    expect(run.status).toBe(0);
    expect(run.calls[0]).toBe(
      `gh workflow run deploy.yml -R mindsdb/example-deploy --ref main -f repo=cowork -f env=staging -f sha=${SHA} -f digest=${DIGEST}`,
    );
  });

  it('fails when the rollout fails and this commit is still the branch head', () => {
    const run = rollOut({ dispatchPrints: RUN_URL, watchStatus: 1, head: SHA });

    expect(run.status).toBe(1);
    expect(run.stdout).not.toContain('::notice::');
  });

  it('passes with a notice when a newer commit took the branch while this run built', () => {
    const run = rollOut({ dispatchPrints: RUN_URL, watchStatus: 1, head: NEWER });

    expect(run.status).toBe(0);
    expect(run.calls).toContain('git ls-remote https://github.com/mindsdb/cowork.git refs/heads/staging');
    expect(run.stdout).toContain(`::notice::staging moved to ${NEWER}`);
  });

  it('fails when the dispatch reports no run to watch', () => {
    const run = rollOut({ dispatchPrints: '', watchStatus: 0, head: SHA });

    expect(run.status).toBe(1);
    expect(run.stdout).toContain('::error::gh workflow run did not report the deploy run it created');
  });

  it('names the deploy repository only through a secret', () => {
    expect(ROLLOUT.env?.DEPLOY_REPOSITORY).toBe('mindsdb/${{ secrets.DEPLOYER_REPOSITORY }}');
    expect(stepUsing(jobs.deploy, 'actions/create-github-app-token').with?.repositories).toBe(
      '${{ secrets.DEPLOYER_REPOSITORY }}',
    );
  });
});

describe('the image the scan reads', () => {
  // GitHub drops a job output that holds a secret, and the full image
  // reference starts with the account id the secret names.
  it('is rebuilt from the tag the build pushed, not passed as a full reference', () => {
    expect(Object.keys(jobs.build.outputs ?? {}).sort()).toEqual(['digest', 'tag']);
    expect(stepUsing(jobs.scan, 'mindsdb/github-actions/snyk-docker-scan').with?.image).toBe(
      '${{ secrets.AWS_DEV_ACCOUNT_ID }}.dkr.ecr.us-east-1.amazonaws.com/${{ env.ECR_REPOSITORY }}:${{ needs.build.outputs.tag }}',
    );
  });
});

describe('every workflow in this public repository', () => {
  const files = readdirSync(WORKFLOWS_DIR).filter((file) => /\.ya?ml$/.test(file));

  it.each(files)('%s names no AWS account', (file) => {
    expect(read(file)).not.toMatch(/arn:aws:[a-z0-9-]*:[a-z0-9-]*:[0-9]{12}:/);
  });
});
