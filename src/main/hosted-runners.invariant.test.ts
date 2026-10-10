import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Regression guard: no workflow in this repo may run on a self-hosted runner.
//
// This repo is public. A same-repo branch runs its own edited workflows with no
// approval, and a fork runs its edits once anyone with write access approves the
// run. So jobs here run on GitHub-hosted runners and assume AWS roles through
// OIDC.
//
// actionlint already rejects a literal `runs-on: mdb-dev`, because
// .github/actionlint.yaml declares no self-hosted labels. It still accepts
// GitHub's generic `self-hosted` label, and it cannot see a label passed to a
// reusable workflow as an input (`runs-on:` under `with:`), which is how the
// shared notify and release workflows take their runner. This test catches both.

const WORKFLOWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');

/** The org's self-hosted runner labels, plus GitHub's generic one. */
const SELF_HOSTED_LABEL = /\b(?:mdb-dev|mdb-prod|self-hosted)\b/;

interface LabelUse {
  file: string;
  line: number;
  text: string;
}

/** Lines naming a self-hosted label. Whole-line comments are skipped, so a
 *  workflow can still explain in prose why it does not use one. */
const selfHostedUses = (file: string, text: string): LabelUse[] =>
  text.split('\n').flatMap((line, index) =>
    !line.trimStart().startsWith('#') && SELF_HOSTED_LABEL.test(line)
      ? [{ file, line: index + 1, text: line.trim() }]
      : [],
  );

const workflowFiles = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

describe('no workflow runs on a self-hosted runner', () => {
  // Anti-vacuous: reading the wrong directory would pass the check below.
  it('reads the workflows that used to run on one', () => {
    expect(workflowFiles).toEqual(expect.arrayContaining(['build-deploy.yml', 'upload-installer-to-s3.yml']));
  });

  it('names no self-hosted label outside a comment', () => {
    const uses = workflowFiles.flatMap((file) =>
      selfHostedUses(file, readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8')),
    );
    expect(uses, 'a public repo job must run on a GitHub-hosted runner').toEqual([]);
  });

  // Self-check, independent of the real files.
  it('flags a label passed as an input and skips a comment', () => {
    const text = ['    # mdb-prod used to run this upload', '    with:', '      runs-on: mdb-prod'].join('\n');
    expect(selfHostedUses('example.yml', text)).toEqual([
      { file: 'example.yml', line: 3, text: 'runs-on: mdb-prod' },
    ]);
  });
});
