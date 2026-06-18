// Detect the current git branch and write it to src/main/build-branch.json
// so server-source.ts can bake the correct default ref into packaged builds.
// Runs as part of `npm run build:main`.
//
// CI priority:
//   1. GITHUB_BASE_REF — set on pull_request events; the *target* branch
//      (e.g. "staging" for a PR into staging). This is what matters: the
//      installer should pull cowork-server/anton from the branch the PR
//      is merging into, not the feature branch itself.
//   2. GITHUB_REF_NAME — set on push events; the branch that was pushed
//      (e.g. "main" on merge-to-main).
//   3. Local git — for developer builds.

const { execSync } = require('child_process');
const { writeFileSync } = require('fs');
const path = require('path');

let branch = 'main';
try {
  branch =
    process.env.GITHUB_BASE_REF ||
    process.env.GITHUB_REF_NAME ||
    execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
} catch {
  // No git available (e.g. clean tarball build) — fall back to main
}

const out = path.resolve(__dirname, '../src/main/build-branch.json');
writeFileSync(out, JSON.stringify({ branch }) + '\n');
console.log(`stamp-branch: ${branch} → ${out}`);
