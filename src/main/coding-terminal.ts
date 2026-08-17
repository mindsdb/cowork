// Embedded Claude Code terminal (ENG-1656 follow-up): runs the `claude` CLI
// in a real PTY, keyed by task id, so each Claude-Code task is its own
// independent, reconnectable session — mirroring how this app ran Anton's
// CLI in its own pre-GUI days.
//
// The PTY itself lives in a separate `utilityProcess` (coding-pty-host.ts),
// not inline here — node-pty's native spawn crashed the whole app when
// called directly from Electron's main process (see that file for why).
// node-pty is a native module and is listed only as an `optionalDependency`
// (see package.json) — its native build is not guaranteed on every platform/
// Node ABI combination; the host process degrades to a clear "not available"
// error (via an `error` message) instead of crashing when it's missing.
import * as fs from 'fs';
import * as path from 'path';
import { utilityProcess } from 'electron';
import type { UtilityProcess, WebContents } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { detectClaudeCode, revealMindsApiKey, revealMindsBaseUrl } from './coding-mode';
import { ensureTaskWorktree, removeTaskWorktree } from './coding-workspace';
import { getEnvPath } from './uv-paths';

// Last-resort fallback only — real requests use revealMindsBaseUrl(), the
// actual host the stored key was minted against (dev/preview/stable builds
// mint against staging, not this). See coding-mode.ts for why hardcoding
// this unconditionally 401s on every non-prod build despite a valid key.
const MINDSHUB_INFERENCE_FALLBACK_URL = 'https://api.mindshub.ai';
const START_TIMEOUT_MS = 15_000;

// Vars Claude Code (or any nested Claude session, including a dev running
// this very app from inside one) sets on ITSELF and expects a *fresh*
// process not to inherit — e.g. CLAUDE_CODE_CHILD_SESSION makes a nested
// `claude` think it's a child of an outer session and disables transcript
// saving. If our own Electron process inherited any of these from its
// parent shell, the embedded CLI must not see them; ANTHROPIC_* is stripped
// too since ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN are set explicitly
// below and a stray inherited ANTHROPIC_API_KEY could otherwise compete
// with them for which credential the CLI picks.
function sanitizedParentEnv(): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CLAUDE_CODE_') || key === 'CLAUDECODE' || key.startsWith('ANTHROPIC_')) continue;
    clean[key] = value;
  }
  return clean;
}

function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/** Pre-seed the per-project Claude Code config dir so the CLI's first-run
 *  wizard (theme picker, security notice) and its per-directory "do you
 *  trust this folder?" prompt never appear in the embedded terminal —
 *  there's no way to "skip ahead" once it's already streaming into an
 *  xterm the user is watching. `theme: 'dark'` matches CodingTerminal.jsx's
 *  fixed dark background; `hasCompletedOnboarding` and a `projects[cwd]`
 *  entry with `hasTrustDialogAccepted: true` are exactly what Claude Code
 *  itself writes after a human clicks through the wizard once (confirmed
 *  empirically for both — neither has a dedicated flag/env var). The trust
 *  entry is keyed by the REAL (symlink-resolved) path — Claude Code
 *  resolves `cwd` before checking the map, so e.g. macOS's /tmp → /private/
 *  tmp means a raw, unresolved key silently never matches. Merges into
 *  whatever's already there so later CLI-managed state (other trust
 *  records, migration flags, etc.) is never clobbered. Best-effort: a
 *  filesystem error here just means the CLI falls back to prompting. */
function ensureClaudeConfigDefaults(configDir: string, cwd: string): void {
  try {
    fs.mkdirSync(configDir, { recursive: true });

    const settingsPath = path.join(configDir, 'settings.json');
    const settings = readJsonFile(settingsPath);
    if (!settings.theme) {
      settings.theme = 'dark';
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }

    const statePath = path.join(configDir, '.claude.json');
    const state = readJsonFile(statePath);
    let changed = false;
    if (!state.hasCompletedOnboarding) {
      state.hasCompletedOnboarding = true;
      changed = true;
    }
    const realCwd = fs.realpathSync(cwd);
    const projects = (state.projects && typeof state.projects === 'object' ? state.projects : {}) as Record<string, any>;
    if (!projects[realCwd]?.hasTrustDialogAccepted) {
      projects[realCwd] = { ...projects[realCwd], hasTrustDialogAccepted: true };
      state.projects = projects;
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    }
  } catch {
    // Non-fatal — worst case the CLI prompts as it would without this.
  }
}

interface CodingTerminalOptions {
  projectPath: string;
  message: string;
  model: string;
}

interface StartResult {
  ok: boolean;
  reason?: string;
}

const sessions = new Map<string, UtilityProcess>();

export function isCodingTerminalRunning(taskId: string): boolean {
  return sessions.has(taskId);
}

function hostScriptPath(): string {
  return path.join(__dirname, 'coding-pty-host.js');
}

/** Start (or, if already running, no-op and reconnect to) the PTY host for a
 *  task. Reconnect is the common case — the user left the task view and
 *  came back; the session should keep running, not restart the prompt. */
export async function startCodingTerminal(
  taskId: string,
  opts: CodingTerminalOptions,
  cols: number,
  rows: number,
  sender: WebContents,
): Promise<StartResult> {
  if (sessions.has(taskId)) return { ok: true };

  if (typeof opts.model !== 'string' || !opts.model) {
    // node-pty's spawn() validates every argv entry is a string and throws
    // synchronously ("A string was expected") if not — a task created
    // before a model finished loading, or a caller passing the model
    // object instead of its id, would otherwise reach that throw inside
    // the host process instead of a clear, actionable error here.
    return { ok: false, reason: 'No model selected — pick a model before launching Claude Code.' };
  }

  const detection = await detectClaudeCode();
  if (!detection.installed || !detection.path) {
    return { ok: false, reason: 'Claude Code CLI not found on PATH.' };
  }

  const authToken = await revealMindsApiKey();
  if (!authToken) {
    return { ok: false, reason: 'No MindsHub API key configured — sign in with MindsHub or add a key in Settings before using coding mode.' };
  }
  const inferenceBaseUrl = (await revealMindsBaseUrl()) || MINDSHUB_INFERENCE_FALLBACK_URL;

  // Each task runs in its own git worktree so concurrent Claude Code tasks
  // in the same project can never step on each other's uncommitted edits.
  // `isNew` distinguishes a true first launch (type the opening message)
  // from reconnecting to a task whose process died since (resume its own
  // history with --continue instead of replaying the first line as a
  // brand-new prompt). Falls back to running directly in the project — no
  // isolation, always "new" — if git isn't available at all; that's still
  // strictly better than refusing to launch.
  let cwd = opts.projectPath;
  let isNewSession = true;
  try {
    const worktree = await ensureTaskWorktree(opts.projectPath, taskId);
    cwd = worktree.path;
    isNewSession = worktree.isNew;
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[coding-terminal] failed to set up task worktree, falling back to project dir', err?.message || err);
  }

  // Per-project, not a single shared dir — keeps MindsHub Claude Code
  // sessions/config isolated per project and separate from the user's own
  // claude.ai profile (~/.claude). Lives under .claude-mindshub/config/,
  // alongside .claude-mindshub/tasks/<taskId>/ (the worktrees) — everything
  // MindsHub/coding-mode-owned under one directory, deliberately not
  // `.claude/` (Claude Code's own real per-project state dir; see
  // coding-workspace.ts for why that name is reserved). Trust is recorded
  // against `cwd` (resolved above), not the project root, since that's the
  // CLI's actual working directory once worktrees are in play.
  const claudeConfigDir = path.join(opts.projectPath, '.claude-mindshub', 'config');
  ensureClaudeConfigDefaults(claudeConfigDir, cwd);

  const child = utilityProcess.fork(hostScriptPath(), [], { stdio: 'ignore' });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: StartResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      finish({ ok: false, reason: 'Timed out starting the coding terminal.' });
    }, START_TIMEOUT_MS);

    child.on('message', (msg: any) => {
      switch (msg?.type) {
        case 'started':
          sessions.set(taskId, child);
          finish({ ok: true });
          break;
        case 'data':
          sender.send(IPC.CODING_TERMINAL_DATA, taskId, msg.data);
          break;
        case 'exit':
          sessions.delete(taskId);
          sender.send(IPC.CODING_TERMINAL_EXIT, taskId, msg.exitCode);
          break;
        case 'error':
          // eslint-disable-next-line no-console
          console.error('[coding-terminal] host process error', msg.where, msg.reason, msg.stack);
          finish({ ok: false, reason: msg.reason });
          break;
      }
    });
    child.on('exit', () => {
      sessions.delete(taskId);
      finish({ ok: false, reason: 'Coding terminal process exited unexpectedly.' });
    });

    const startMsg = {
      type: 'start',
      claudePath: detection.path,
      args: isNewSession ? ['--model', opts.model] : ['--model', opts.model, '--continue'],
      cwd,
      cols,
      rows,
      // The host process (not here) delays typing this until the CLI's
      // first real output, so the PTY's own line-discipline echo doesn't
      // print it a second time above the TUI before claude switches into
      // raw/alt-screen mode. Undefined on reconnect — --continue resumes
      // the CLI's own history for this cwd instead of replaying it.
      initialInput: isNewSession && opts.message ? `${opts.message}\r` : undefined,
      env: {
        ...sanitizedParentEnv(),
        PATH: getEnvPath(),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        ANTHROPIC_BASE_URL: inferenceBaseUrl,
        ANTHROPIC_AUTH_TOKEN: authToken,
        CLAUDE_CONFIG_DIR: claudeConfigDir,
        // The model alias/id (e.g. "mindshub_air") isn't one Claude Code's
        // installed version recognizes by name, which otherwise surfaces a
        // wall-of-text warning on every session start — MindsHub-routed
        // models aren't meant to be in its hardcoded list.
        CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: '1',
      },
    };

    // Diagnostic-only (ENG-1656): every one of these must be a string or
    // node-pty's native spawn throws a bare, stackless "A string was
    // expected" with no indication of which field was wrong. Log any
    // offender's actual type/value before it ever reaches the host process.
    const badFields: string[] = [];
    if (typeof startMsg.claudePath !== 'string') badFields.push(`claudePath=${JSON.stringify(startMsg.claudePath)}`);
    if (typeof startMsg.cwd !== 'string') badFields.push(`cwd=${JSON.stringify(startMsg.cwd)}`);
    startMsg.args.forEach((a, i) => {
      if (typeof a !== 'string') badFields.push(`args[${i}]=${JSON.stringify(a)} (${typeof a})`);
    });
    for (const [k, v] of Object.entries(startMsg.env)) {
      if (typeof v !== 'string') badFields.push(`env.${k}=${JSON.stringify(v)} (${typeof v})`);
    }
    if (badFields.length) {
      // eslint-disable-next-line no-console
      console.error('[coding-terminal] non-string field(s) about to be sent to pty host:', badFields);
    }

    child.postMessage(startMsg);
  });
}

export function writeToCodingTerminal(taskId: string, data: string): void {
  sessions.get(taskId)?.postMessage({ type: 'write', data });
}

export function resizeCodingTerminal(taskId: string, cols: number, rows: number): void {
  sessions.get(taskId)?.postMessage({ type: 'resize', cols, rows });
}

export function killCodingTerminal(taskId: string): void {
  const child = sessions.get(taskId);
  if (!child) return;
  sessions.delete(taskId);
  try {
    child.postMessage({ type: 'kill' });
    child.kill();
  } catch { /* already gone */ }
}

export function killAllCodingTerminals(): void {
  for (const taskId of Array.from(sessions.keys())) killCodingTerminal(taskId);
}

/** Called when a Claude-Code task is deleted — stops its process (if still
 *  running) and removes its worktree/branch so `.claude-mindshub/tasks/`
 *  doesn't accumulate directories for tasks that no longer exist. */
export async function removeCodingTask(taskId: string, projectPath: string): Promise<void> {
  killCodingTerminal(taskId);
  await removeTaskWorktree(projectPath, taskId);
}
