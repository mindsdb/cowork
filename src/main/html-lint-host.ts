// Headless host for anton's HTML artifact checker (ENG-1204 Fix 3).
//
// Deliberately a dumb host: it only isolates the profile and hands control to
// the runner script anton ships, so the checker's logic stays in anton (which
// updates far more often than this shell) instead of being frozen here.
import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const RUNNER_ENV = 'ANTON_HTML_LINT_RUNNER';
const PROFILE_PREFIX = 'cowork-html-lint-';
const STALE_PROFILE_MS = 60 * 60 * 1000;

/* The runner ends the process with `app.exit()`, which skips every exit hook,
 * so profiles are collected on the next run instead of after their own. The
 * age cut keeps a concurrent run's profile (seconds old) out of the sweep. */
function sweepStaleProfiles(): void {
  const now = Date.now();
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    const dir = path.join(os.tmpdir(), name);
    try {
      if (now - fs.statSync(dir).mtimeMs > STALE_PROFILE_MS) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // another run may have swept it first
    }
  }
}

export function runHtmlLint(): void {
  const runner = process.env[RUNNER_ENV];
  if (!runner || !path.isAbsolute(runner) || !fs.existsSync(runner)) {
    process.stderr.write(`html-lint: ${RUNNER_ENV} must be an absolute path to an existing script\n`);
    app.exit(2);
    return;
  }

  // Own profile dir: this is a second process of the same binary while the
  // user's app is running, and it would otherwise contend with it on the
  // cookie/cache locks. Must be set before app is ready, i.e. before the
  // runner opens a window.
  sweepStaleProfiles();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  app.setPath('userData', profile);
  app.setPath('sessionData', profile); // cookies/caches: separate path, must also move before ready

  require(runner);
}
