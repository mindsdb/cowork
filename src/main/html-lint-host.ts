/* Headless host for anton's HTML artifact checker.
 *
 * It isolates the profile and hands control to a runner. A packaged build runs
 * the runner bundled with it (html-lint-runner.ts, a port of anton's) and
 * takes only the target from the environment: a script the environment named
 * would run as this signed binary's main process. An unpackaged run requires
 * the script ANTON_HTML_LINT_RUNNER names, so anton's developers can iterate
 * on anton's copy. */
import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { startCrashReporter } from './crash-reporter';
import { startHtmlLintRunner } from './html-lint-runner';
import type { PlatformOption } from './private-files';

const TARGET_ENV = 'ANTON_HTML_LINT_TARGET';
const RUNNER_ENV = 'ANTON_HTML_LINT_RUNNER';
const PROFILE_PREFIX = 'cowork-html-lint-';
const STALE_PROFILE_MS = 60 * 60 * 1000;

export interface HtmlLintHostOptions {
  /** From `isPackagedRun` in launch-guard.ts. */
  packaged: boolean;
}

type LintRunner = { kind: 'bundled' } | { kind: 'script'; path: string };

/* The runner's own target shapes, as anton/core/artifacts/html_lint.py passes
 * them: an http(s) URL (`lint_url`) or an absolute path (`lint_html`). */
function isLintTarget(target: string | undefined): target is string {
  if (!target) return false;
  if (/^https?:\/\//i.test(target)) return URL.canParse(target);
  return path.isAbsolute(target) && fs.existsSync(target);
}

function pickRunner(packaged: boolean): LintRunner | null {
  if (packaged) return { kind: 'bundled' };
  const script = process.env[RUNNER_ENV];
  if (!script || !path.isAbsolute(script) || !fs.existsSync(script)) return null;
  return { kind: 'script', path: script };
}

function refuse(message: string): void {
  process.stderr.write(`html-lint: ${message}\n`);
  app.exit(2);
}

/* The runner ends the process with `app.exit()`, which skips every exit hook,
 * so profiles are collected on the next run instead of after their own. The
 * age cut keeps a concurrent run's profile (seconds old) out of the sweep.
 *
 * On Linux os.tmpdir() is the shared /tmp, so an entry with the prefix may
 * belong to another account. Only a real folder this user owns is removed:
 * never a link, which the removal could follow into the user's own files, and
 * never another account's folder, whose contents that account controls.
 * Windows reports no user id, and its temp folder is per user anyway. */
export function sweepStaleProfiles({ platform = process.platform }: PlatformOption = {}): void {
  const now = Date.now();
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    const dir = path.join(os.tmpdir(), name);
    try {
      const seen = fs.lstatSync(dir);
      if (!seen.isDirectory()) continue;
      if (platform !== 'win32' && seen.uid !== process.getuid?.()) continue;
      if (now - seen.mtimeMs > STALE_PROFILE_MS) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // another run may have swept it first
    }
  }
}

export function runHtmlLint({ packaged }: HtmlLintHostOptions): void {
  const target = process.env[TARGET_ENV];
  if (!isLintTarget(target)) {
    refuse(`${TARGET_ENV} must be an http(s) URL or an absolute path to an existing file`);
    return;
  }
  const runner = pickRunner(packaged);
  if (!runner) {
    refuse(`${RUNNER_ENV} must be an absolute path to an existing script`);
    return;
  }

  /* Own profile dir: this is a second process of the same binary while the
   * user's app is running, and it would otherwise contend with it on the
   * cookie/cache locks. Must be set before app is ready, i.e. before the
   * runner opens a window. */
  sweepStaleProfiles();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  app.setPath('userData', profile);
  app.setPath('sessionData', profile); // cookies/caches: separate path, must also move before ready
  // After setPath: dumps go to the throwaway profile and are swept with it.
  startCrashReporter();

  if (runner.kind === 'bundled') {
    startHtmlLintRunner(target).catch((error: unknown) => {
      process.stderr.write(`html-lint: runner failed: ${String(error)}\n`);
      app.exit(1);
    });
  } else {
    require(runner.path);
  }
}
