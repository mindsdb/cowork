import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { forbiddenEntitlements } from './macos-setup-contract.mjs';
import { checkFuses } from './release-fuses.mjs';

/* The release checks that both the build and the setup smokes run: every fuse
   wire holds the release fuses, and on macOS neither the app nor a helper app
   holds an entitlement that lets code from outside the signed app load into
   it. The build runs them on the app it is about to upload, so a builder
   change that drops a fuse or grants such an entitlement fails the build
   rather than the setup smoke after the release ships.

   Usage: node scripts/release-app-check.mjs <app.app | app.exe>
   Exits with status 1, one line per problem on stderr, when a check fails. */

export { FORBIDDEN_ENTITLEMENTS } from './macos-setup-contract.mjs';

const execute = promisify(execFile);

/** What `codesign -d --entitlements - --xml` prints for one piece of signed code. */
export async function printEntitlements(code) {
  return (await execute('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', code], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })).stdout;
}

/** The code in a macOS app whose entitlements the check reads: the app and its helper apps. */
export async function signedCode(bundle) {
  const frameworks = join(bundle, 'Contents/Frameworks');
  const helpers = (await readdir(frameworks)).filter((name) => name.includes('Helper') && name.endsWith('.app')).sort().map((name) => join(frameworks, name));
  if (!helpers.length) throw new Error(`${bundle} has no helper apps to check.`);
  return [bundle, ...helpers];
}

/** One line for each forbidden entitlement the app or one of its helper apps holds. */
export async function heldEntitlements(bundle, print = printEntitlements) {
  const held = [];
  for (const code of await signedCode(bundle)) {
    for (const key of forbiddenEntitlements(await print(code))) held.push(`${basename(code)} holds ${key}`);
  }
  return held;
}

/** Both checks on a release app: a .app bundle on macOS, the executable elsewhere. */
export async function checkReleaseApp(app) {
  const fuses = await checkFuses(app);
  const entitlements = app.endsWith('.app') ? await heldEntitlements(app) : [];
  return { fuses, problems: [...fuses.mismatches, ...entitlements] };
}

/** The command line: returns the exit status. */
export async function main(argv) {
  if (argv.length !== 1 || !argv[0]) {
    console.error('Usage: node scripts/release-app-check.mjs <app.app | app.exe>');
    return 2;
  }
  const [app] = argv;
  const { fuses, problems } = await checkReleaseApp(app);
  console.log(JSON.stringify(fuses.states, null, 2));
  for (const problem of problems) console.error(`release-app-check: ${problem}`);
  if (problems.length) return 1;
  console.log(`release-app-check: ${app} holds the release fuses${app.endsWith('.app') ? ' and no forbidden entitlement' : ''}.`);
  return 0;
}

if (process.argv[1]?.endsWith('release-app-check.mjs')) {
  process.exitCode = await main(process.argv.slice(2));
}
