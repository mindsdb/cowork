import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/* The checks the setup smokes run on the installed app itself, before they copy
   it: the app opens its window under the release's signature and fuses, the
   launch guard refuses a denied switch, ELECTRON_RUN_AS_NODE does not turn the
   app into Node, and lint mode runs the bundled HTML lint runner on real pages.
   The installed app keeps Node's inspector off, so Playwright cannot drive it.
   Each launch starts the executable with a throwaway profile, reads what the
   app writes to stdout and stderr, and kills the app and its child processes
   before the next launch starts. */

const execute = promisify(execFile);

/* The failing-step names the smokes report for these checks. */
export const LAUNCH_STEP = 'Launch installed app';
export const LINT_STEP = 'Lint pages';

/* Main writes each diagnostic as a JSON line (src/shared/diagnostics.ts), an
   INFO one to stdout and only under LOG_LEVEL=INFO. app.ts writes
   MODULES_LOADED_EVENT when it loads, and RENDERER_LOAD_EVENT once it has
   created the main window and starts loading the renderer into it. */
export const MODULES_LOADED_EVENT = 'boot_modules_loaded';
export const RENDERER_LOAD_EVENT = 'main_loading_renderer_from';
const DIAGNOSTICS_ENV = Object.freeze({ LOG_LEVEL: 'INFO' });

/* One switch the launch guard refuses (src/main/launch-guard.ts), and the line
   the entry point writes to stderr before it exits with status 1. */
export const DENIED_LAUNCH = Object.freeze({
  args: Object.freeze(['--host-rules=MAP * 127.0.0.1']),
  stderrLine: 'launch-guard: a packaged build does not start with --host-rules',
});

/* A launch that a plain Node runtime answers by printing `marker` and exiting.
   The release turns the runAsNode fuse off, so the app ignores the variable
   and starts as the app. */
export const RUN_AS_NODE = Object.freeze({
  env: Object.freeze({ ELECTRON_RUN_AS_NODE: '1' }),
  args: Object.freeze(['-e', 'console.log("node-ran")']),
  marker: 'node-ran',
});

/* The pages the lint step checks, each in a folder of its own. */
export const LINT_FIXTURES = fileURLToPath(new URL('./smoke-fixtures/lint/', import.meta.url));

/* Every lint launch names this script in ANTON_HTML_LINT_RUNNER. A packaged
   build runs the runner bundled in its app.asar and never this script, which
   prints FOREIGN_RUNNER_MARKER and exits with status 3. */
export const FOREIGN_LINT_RUNNER = fileURLToPath(new URL('./smoke-fixtures/foreign-lint-runner.cjs', import.meta.url));
export const FOREIGN_RUNNER_MARKER = 'foreign-lint-runner-ran';

/**
 * What the bundled runner must report for a page.
 * - `passes`: no console error, no failed request, no crash, not empty.
 * - `console-error`: a console error whose message holds `message`.
 * - `failed-request`: a request for `path` on the page's origin answered with HTTP 404.
 * @typedef {{ kind: 'passes' } | { kind: 'console-error', message: string } | { kind: 'failed-request', path: string }} LintExpectation
 */
/** @typedef {{ name: string, page: string, expect: LintExpectation }} LintCase */

/** @type {readonly LintCase[]} */
export const LINT_CASES = Object.freeze([
  { name: 'clean', page: 'clean/index.html', expect: { kind: 'passes' } },
  // A module script that imports a file beside the page and fetches a JSON file beside it.
  { name: 'module', page: 'module/index.html', expect: { kind: 'passes' } },
  { name: 'script-error', page: 'script-error/index.html', expect: { kind: 'console-error', message: 'lint smoke: script error' } },
  /* Cowork's viewer serves a page below the server root, so `/app.js` misses
     the app.js beside the page. The lint serves the page's folder below the
     origin root, so it misses it too. */
  { name: 'root-absolute', page: 'root-absolute/index.html', expect: { kind: 'failed-request', path: '/app.js' } },
]);

/** @typedef {{ message: string, line: number }} LintConsoleError */
/** @typedef {{ url: string, error: string }} LintFailedRequest */
/**
 * The JSON the bundled runner prints between RESULT_JSON_START and
 * RESULT_JSON_END (HtmlLintResult in src/main/html-lint-runner.ts).
 * @typedef {object} LintResult
 * @property {LintConsoleError[]} consoleErrors
 * @property {LintFailedRequest[]} failedRequests
 * @property {boolean} crashed
 * @property {unknown} crashDetails
 * @property {boolean} emptyPage
 */

/**
 * A throwaway profile for one launch.
 * @typedef {object} LaunchProfile
 * @property {Record<string, string>} env  An allowlisted environment whose home, app-data and temporary folders sit in a fresh folder.
 * @property {string} userDataDir  A fresh Chromium profile folder.
 */
/**
 * The installed app and what a smoke supplies to launch it on its platform.
 * @typedef {object} InstalledApp
 * @property {string} executable  The installed app's executable.
 * @property {(purpose: string) => Promise<LaunchProfile>} profile  Makes a throwaway profile; `purpose` names its folder.
 * @property {(pid: number) => Promise<boolean>} showsWindow  Whether the process shows a window on screen.
 * @property {(name: string, value: string) => void} save  Writes a file of evidence into the smoke's output folder.
 */
/** @typedef {{ code: number | null, signal: string | null }} Exit */
/**
 * What one launch wrote and how it ended.
 * @typedef {object} LaunchOutput
 * @property {string} stdout
 * @property {string} stderr
 * @property {Exit | null} exit  Null while the process or one of its children still holds its output open.
 */
/** @typedef {LaunchOutput & { pid: number | undefined, exited: Promise<Exit> }} Launch */
/**
 * @typedef {object} LaunchOptions
 * @property {readonly string[]} [args]
 * @property {Readonly<Record<string, string>>} [env]  Added to the profile's environment.
 * @property {boolean} [lint]  Starts lint mode the way anton does, from the environment alone, with no `--user-data-dir`.
 */

// Every wait is bounded. A fresh profile's first launch on a hosted runner takes the longest.
const START_MS = 90_000;
const WINDOW_MS = 60_000;
const EXIT_MS = 60_000;
const STOP_MS = 30_000;
const POLL_MS = 1_000;

function lines(text) {
  return text.split(/\r?\n/).map((line) => line.trim());
}

/** Whether `marker` is a whole line of what the launch wrote. @param {LaunchOutput} output */
function printed(output, marker) {
  return lines(output.stdout).includes(marker) || lines(output.stderr).includes(marker);
}

/** @param {Exit | null} exit */
function describeExit(exit) {
  if (!exit) return 'no exit';
  return exit.signal ? `signal ${exit.signal}` : `status ${exit.code}`;
}

function throwIfAny(problems) {
  if (problems.length) throw new Error(problems.join(' '));
}

async function bounded(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

/** The `event` of each diagnostic line in `stdout`, in order. Other output is skipped. */
export function diagnosticEvents(stdout) {
  return lines(stdout).flatMap((line) => {
    if (!line.startsWith('{')) return [];
    try {
      const value = JSON.parse(line);
      return typeof value?.event === 'string' ? [value.event] : [];
    } catch {
      return [];
    }
  });
}

/** What is wrong with a launch the guard should have refused. @param {LaunchOutput} output */
export function refusalProblems({ exit, stdout, stderr }) {
  const problems = [];
  if (exit?.code !== 1) problems.push(`The app ended with ${describeExit(exit)}, not status 1.`);
  if (!lines(stderr).includes(DENIED_LAUNCH.stderrLine)) problems.push(`Its stderr lacks "${DENIED_LAUNCH.stderrLine}".`);
  const started = diagnosticEvents(stdout).filter((event) => event === MODULES_LOADED_EVENT || event === RENDERER_LOAD_EVENT);
  if (started.length) problems.push(`The app started before the guard ran: ${started.join(', ')}.`);
  return problems;
}

/** What is wrong with a launch under ELECTRON_RUN_AS_NODE=1. @param {LaunchOutput} output */
export function runAsNodeProblems(output) {
  const problems = [];
  if (printed(output, RUN_AS_NODE.marker)) problems.push(`ELECTRON_RUN_AS_NODE ran the app as Node: it printed ${RUN_AS_NODE.marker}.`);
  if (!diagnosticEvents(output.stdout).includes(RENDERER_LOAD_EVENT)) problems.push(`The app did not start as the app: it never wrote ${RENDERER_LOAD_EVENT}.`);
  return problems;
}

function isLintResult(value) {
  return value !== null && typeof value === 'object'
    && Array.isArray(value.consoleErrors) && value.consoleErrors.every((entry) => typeof entry?.message === 'string' && typeof entry?.line === 'number')
    && Array.isArray(value.failedRequests) && value.failedRequests.every((entry) => typeof entry?.url === 'string' && typeof entry?.error === 'string')
    && typeof value.crashed === 'boolean' && typeof value.emptyPage === 'boolean';
}

/** The result the runner printed between its markers in `stdout`. @returns {LintResult} */
export function lintResult(stdout) {
  const printedLines = lines(stdout);
  const start = printedLines.indexOf('RESULT_JSON_START');
  if (start === -1 || printedLines[start + 2] !== 'RESULT_JSON_END') throw new Error('The lint printed no result between RESULT_JSON_START and RESULT_JSON_END.');
  let value;
  try {
    value = JSON.parse(printedLines[start + 1]);
  } catch {
    throw new Error('The lint printed a result that is not JSON.');
  }
  if (!isLintResult(value)) throw new Error('The lint printed a result without the runner\'s fields.');
  return value;
}

function urlPath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** How `result` differs from what `lintCase` expects, one line each. @param {LintCase} lintCase @param {LintResult} result */
export function lintProblems({ name, expect }, result) {
  const problems = [];
  if (result.crashed) problems.push(`${name}: the page crashed its renderer.`);
  switch (expect.kind) {
    case 'passes':
      for (const error of result.consoleErrors) problems.push(`${name}: console error "${error.message}".`);
      for (const request of result.failedRequests) problems.push(`${name}: ${request.url} failed with ${request.error}.`);
      if (result.emptyPage) problems.push(`${name}: reported as an empty page.`);
      break;
    case 'console-error':
      if (!result.consoleErrors.some((error) => error.message.includes(expect.message))) problems.push(`${name}: no console error holds "${expect.message}".`);
      break;
    case 'failed-request':
      if (!result.failedRequests.some((request) => urlPath(request.url) === expect.path && request.error === 'HTTP 404')) problems.push(`${name}: no request for ${expect.path} failed with HTTP 404.`);
      break;
  }
  return problems;
}

/** Everything wrong with one finished lint launch. @param {LintCase} lintCase @param {LaunchOutput} output */
function lintLaunchProblems(lintCase, output) {
  const problems = [];
  if (printed(output, FOREIGN_RUNNER_MARKER)) problems.push(`${lintCase.name}: the app ran the script ANTON_HTML_LINT_RUNNER names.`);
  if (output.exit?.code !== 0) problems.push(`${lintCase.name}: the lint ended with ${describeExit(output.exit)}.`);
  try {
    return [...problems, ...lintProblems(lintCase, lintResult(output.stdout))];
  } catch (error) {
    return [...problems, `${lintCase.name}: ${error.message}`];
  }
}

/** Starts `executable` in a process group of its own, outside Windows, so stop() can kill its children too. @returns {Launch} */
function launch(executable, args, env) {
  const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  /** @type {LaunchOutput} */
  const output = { stdout: '', stderr: '', exit: null };
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output.stderr += chunk; });
  const exited = new Promise((resolve) => {
    // 'close' comes after the process exits and its output streams end, so a set `exit` means the output is complete.
    const finish = (code, signal) => {
      if (output.exit) return;
      output.exit = { code, signal };
      resolve(output.exit);
    };
    child.once('error', (error) => {
      output.stderr += `${error.message}\n`;
      if (child.pid === undefined) finish(null, null);
    });
    child.once('close', finish);
  });
  return Object.assign(output, { pid: child.pid, exited });
}

/** Kills the launch and its children, then waits for its output to close. Never throws. @param {Launch} run */
async function stop(run) {
  if (run.pid !== undefined) {
    if (process.platform === 'win32') {
      if (!run.exit) await execute('taskkill.exe', ['/PID', String(run.pid), '/T', '/F'], { windowsHide: true, timeout: STOP_MS }).catch(() => {});
    } else {
      try { process.kill(-run.pid, 'SIGKILL'); } catch { /* no process is left in its group */ }
    }
  }
  try {
    await bounded(run.exited, STOP_MS, 'timed out');
    return 'stopped';
  } catch {
    return `output still open ${STOP_MS / 1000} s after the kill`;
  }
}

/** Waits until `condition` holds, polling, and fails once the app exits or the time is up. @param {Launch} run */
async function until(run, condition, milliseconds, message) {
  const deadline = Date.now() + milliseconds;
  while (true) {
    // Read before the condition: once the app has exited, the condition sees all of its output.
    const exited = run.exit !== null;
    if (await condition()) return;
    if (exited) throw new Error(`${message}: the app ended with ${describeExit(run.exit)} first.`);
    if (Date.now() > deadline) throw new Error(`${message} within ${milliseconds / 1000} s.`);
    await delay(POLL_MS);
  }
}

/** Runs `body` against one launch with a fresh profile, then kills it and saves what it wrote as `<name>.log`.
    @param {InstalledApp} app @param {string} name @param {LaunchOptions} options @param {(run: Launch) => Promise<void>} body */
async function withLaunch(app, name, { args = [], env = {}, lint = false }, body) {
  const profile = await app.profile(name);
  const argv = lint ? [...args] : [`--user-data-dir=${profile.userDataDir}`, ...args];
  const run = launch(app.executable, argv, { ...profile.env, ...env });
  try {
    await body(run);
  } finally {
    const stopped = await stop(run);
    const command = ['$', ...Object.entries(env).map(([key, value]) => `${key}=${value}`), app.executable, ...argv].join(' ');
    app.save(`${name}.log`, `${command}\nexit: ${describeExit(run.exit)} (${stopped})\n--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}\n`);
  }
}

/** The launch step: the app opens its window, refuses a denied switch, and ignores ELECTRON_RUN_AS_NODE. @param {InstalledApp} app */
export async function checkLaunches(app) {
  await withLaunch(app, 'launch-plain', { env: DIAGNOSTICS_ENV }, async (run) => {
    await until(run, () => diagnosticEvents(run.stdout).includes(RENDERER_LOAD_EVENT), START_MS, `The installed app did not write ${RENDERER_LOAD_EVENT}`);
    await until(run, () => app.showsWindow(run.pid), WINDOW_MS, 'The installed app did not show its window');
  });
  await withLaunch(app, 'launch-denied-switch', { args: DENIED_LAUNCH.args, env: DIAGNOSTICS_ENV }, async (run) => {
    await bounded(run.exited, EXIT_MS, `The installed app still ran ${EXIT_MS / 1000} s after it started with ${DENIED_LAUNCH.args.join(' ')}.`);
    throwIfAny(refusalProblems(run));
  });
  await withLaunch(app, 'launch-run-as-node', { args: RUN_AS_NODE.args, env: { ...DIAGNOSTICS_ENV, ...RUN_AS_NODE.env } }, async (run) => {
    await until(run, () => printed(run, RUN_AS_NODE.marker) || diagnosticEvents(run.stdout).includes(RENDERER_LOAD_EVENT), START_MS, `The installed app did not write ${RENDERER_LOAD_EVENT} under ELECTRON_RUN_AS_NODE=1`);
    throwIfAny(runAsNodeProblems(run));
  });
}

/** The lint step: lint mode runs the bundled runner on each page in LINT_CASES and reports what each expects. @param {InstalledApp} app */
export async function checkLint(app) {
  const problems = [];
  for (const lintCase of LINT_CASES) {
    const env = { ANTON_HTML_LINT_TARGET: join(LINT_FIXTURES, lintCase.page), ANTON_HTML_LINT_RUNNER: FOREIGN_LINT_RUNNER };
    await withLaunch(app, `lint-${lintCase.name}`, { env, lint: true }, async (run) => {
      await bounded(run.exited, EXIT_MS, `The lint of the ${lintCase.name} page still ran after ${EXIT_MS / 1000} s.`);
      problems.push(...lintLaunchProblems(lintCase, run));
    });
  }
  throwIfAny(problems);
}
