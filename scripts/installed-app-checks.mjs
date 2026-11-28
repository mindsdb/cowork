import { execFile, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

/* The launches the setup smokes run on the installed app itself, before they
   copy it: the launch guard refuses a denied switch, ELECTRON_RUN_AS_NODE does
   not turn the app into Node, and a plain launch keeps running under the
   release's signature and fuses. The installed app keeps Node's inspector off,
   so Playwright cannot drive it. Each launch starts the executable with a
   throwaway profile, reads what the app writes to stdout and stderr, and kills
   the app and its child processes before the next launch starts. */

const execute = promisify(execFile);

/* The failing-step name the smokes report for these launches. */
export const LAUNCH_STEP = 'Launch installed app';

/* One switch the launch guard refuses (src/main/launch-guard.ts), and the line
   the entry point writes to stderr before it exits with status 1. */
export const DENIED_LAUNCH = Object.freeze({
  args: Object.freeze(['--host-rules=MAP * 127.0.0.1']),
  stderrLine: 'launch-guard: a packaged build does not start with --host-rules',
});

/* A launch that a plain Node runtime answers by printing `marker` and exiting.
   The release turns the runAsNode fuse off, so the app ignores the variable
   and never prints the marker. */
export const RUN_AS_NODE = Object.freeze({
  env: Object.freeze({ ELECTRON_RUN_AS_NODE: '1' }),
  args: Object.freeze(['-e', 'console.log("node-ran")']),
  marker: 'node-ran',
});

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
 * @property {(name: string, value: string) => void} save  Writes a file of evidence into the smoke's output folder.
 */
/** @typedef {{ code: number | null, signal: string | null }} Exit */
/**
 * What one launch wrote and how it ended.
 * @typedef {object} LaunchOutput
 * @property {string} stdout
 * @property {string} stderr
 * @property {Exit | null} exit  Null while the process runs.
 */
/** @typedef {LaunchOutput & { pid: number | undefined, closed: Promise<void> }} Launch */
/**
 * @typedef {object} LaunchOptions
 * @property {readonly string[]} [args]
 * @property {Readonly<Record<string, string>>} [env]  Added to the profile's environment.
 */

// Every wait is bounded. A fresh profile's first launch on a hosted runner takes the longest.
const EXIT_MS = 60_000;
// How long the run-as-node and plain launches run before the step stops them.
const RUN_MS = 20_000;
const STOP_MS = 30_000;

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

/** What is wrong with a launch the guard should have refused. @param {LaunchOutput} output */
export function refusalProblems({ exit, stderr }) {
  const problems = [];
  if (exit?.code !== 1) problems.push(`The app ended with ${describeExit(exit)}, not status 1.`);
  if (!lines(stderr).includes(DENIED_LAUNCH.stderrLine)) problems.push(`Its stderr lacks "${DENIED_LAUNCH.stderrLine}".`);
  return problems;
}

/** What is wrong with a launch under ELECTRON_RUN_AS_NODE=1. @param {LaunchOutput} output */
export function runAsNodeProblems(output) {
  return printed(output, RUN_AS_NODE.marker) ? [`ELECTRON_RUN_AS_NODE ran the app as Node: it printed ${RUN_AS_NODE.marker}.`] : [];
}

/** Starts `executable` in a process group of its own, outside Windows, so stop() can kill its children too. @returns {Launch} */
function launch(executable, args, env) {
  const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  /** @type {LaunchOutput} */
  const output = { stdout: '', stderr: '', exit: null };
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output.stderr += chunk; });
  child.once('exit', (code, signal) => { output.exit = { code, signal }; });
  // 'close' comes after the process exits and its output streams end, so the output is complete once `closed` settles.
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      output.exit ??= { code, signal };
      resolve();
    });
    child.once('error', (error) => {
      output.stderr += `${error.message}\n`;
      // A process that never started sends no 'exit'.
      if (child.pid === undefined) {
        output.exit ??= { code: null, signal: null };
        resolve();
      }
    });
  });
  return Object.assign(output, { pid: child.pid, closed });
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
    await bounded(run.closed, STOP_MS, 'timed out');
    return 'stopped';
  } catch {
    return `output still open ${STOP_MS / 1000} s after the kill`;
  }
}

/** Runs `body` against one launch with a fresh profile, then kills it and saves what it wrote as `<name>.log`.
    @param {InstalledApp} app @param {string} name @param {LaunchOptions} options @param {(run: Launch) => Promise<void>} body */
async function withLaunch(app, name, { args = [], env = {} }, body) {
  const profile = await app.profile(name);
  const argv = [`--user-data-dir=${profile.userDataDir}`, ...args];
  const run = launch(app.executable, argv, { ...profile.env, ...env });
  try {
    await body(run);
  } finally {
    const stopped = await stop(run);
    const command = ['$', ...Object.entries(env).map(([key, value]) => `${key}=${value}`), app.executable, ...argv].join(' ');
    app.save(`${name}.log`, `${command}\nexit: ${describeExit(run.exit)} (${stopped})\n--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}\n`);
  }
}

/** The launch step: the app refuses a denied switch, ignores ELECTRON_RUN_AS_NODE, and keeps running when started plainly.
    @param {InstalledApp} app @param {number} [runMs]  How long the run-as-node and plain launches run before the step stops them. */
export async function checkLaunches(app, runMs = RUN_MS) {
  await withLaunch(app, 'launch-denied-switch', { args: DENIED_LAUNCH.args }, async (run) => {
    await bounded(run.closed, EXIT_MS, `The installed app still ran ${EXIT_MS / 1000} s after it started with ${DENIED_LAUNCH.args.join(' ')}.`);
    throwIfAny(refusalProblems(run));
  });
  await withLaunch(app, 'launch-run-as-node', { args: RUN_AS_NODE.args, env: RUN_AS_NODE.env }, async (run) => {
    // A Node runtime prints the marker and exits at once, which ends the wait early.
    await Promise.race([run.closed, delay(runMs)]);
    throwIfAny(runAsNodeProblems(run));
  });
  await withLaunch(app, 'launch-plain', {}, async (run) => {
    await Promise.race([run.closed, delay(runMs)]);
    if (run.exit) throw new Error(`The installed app ended with ${describeExit(run.exit)} within ${runMs / 1000} s of its start.`);
  });
}
