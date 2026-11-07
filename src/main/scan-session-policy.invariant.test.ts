import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Regression guard: the image scan's AWS session can pull and cannot push.
//
// The scan in build-deploy.yml assumes the same ECR role as the build, and that
// role can push to its tier. The scan runs the Snyk CLI with those credentials
// in its environment. So its configure-aws-credentials step passes an inline
// session policy that allows only the registry login and the pull actions, and
// a session gets only what both that policy and the role's policy allow.
// Dropping the policy, or adding a push action to it, leaves the scan passing,
// so nothing else would notice.

const WORKFLOW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/build-deploy.yml');

interface PolicyStatement {
  Effect: 'Allow' | 'Deny';
  Action: string[];
  Resource: string;
}

interface SessionPolicy {
  Version: string;
  Statement: PolicyStatement[];
}

/** The only policy the scan's session may carry. */
const PULL_ONLY_POLICY: SessionPolicy = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchGetImage',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchCheckLayerAvailability',
      ],
      Resource: '*',
    },
  ],
};

/** The scan job, up to the next job at the same indent. */
const scanJob = (): string | undefined => {
  const text = readFileSync(WORKFLOW, 'utf8');
  const start = text.indexOf('\n  scan:\n');
  if (start === -1) return undefined;
  const job = text.slice(start + 1);
  const end = job.search(/\n {2}[a-z][a-z-]*:\n/);
  return end === -1 ? job : job.slice(0, end);
};

/** Every `inline-session-policy: |` block in the job, parsed as JSON. */
const sessionPolicies = (job: string): unknown[] =>
  [...job.matchAll(/^( +)inline-session-policy: \|\n((?:\1 {2}.*\n)+)/gm)].map((m) => JSON.parse(m[2]));

describe('the image scan cannot push', () => {
  // Anti-vacuous: a missing job would make every check below trivially pass or fail.
  it('reads the scan job', () => {
    expect(scanJob()).toContain('mindsdb/github-actions/snyk-docker-scan@');
  });

  it('assumes AWS credentials once', () => {
    expect(scanJob()?.match(/aws-actions\/configure-aws-credentials@/g)).toHaveLength(1);
  });

  it('narrows that session to the registry login and pulls', () => {
    expect(sessionPolicies(scanJob() ?? '')).toEqual([PULL_ONLY_POLICY]);
  });
});
