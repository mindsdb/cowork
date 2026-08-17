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
import { detectClaudeCode, revealMindsApiKey } from './coding-mode';
import { getEnvPath } from './uv-paths';

const MINDSHUB_INFERENCE_BASE_URL = 'https://api.mindshub.ai';
const START_TIMEOUT_MS = 15_000;

function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/** Pre-seed the per-project Claude Code config dir so the CLI's first-run
 *  wizard (theme picker, security notice) never appears in the embedded
 *  terminal — there's no way to "skip ahead" once it's already streaming
 *  into an xterm the user is watching. `theme: 'dark'` matches
 *  CodingTerminal.jsx's fixed dark background; `hasCompletedOnboarding`
 *  is the flag Claude Code itself writes after a human clicks through the
 *  wizard once (confirmed empirically — it has no dedicated flag/env var).
 *  Merges into whatever's already there so later CLI-managed state (trust
 *  records, migration flags, etc.) is never clobbered. Best-effort: a
 *  filesystem error here just means the CLI falls back to prompting. */
function ensureClaudeConfigDefaults(configDir: string): void {
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
    if (!state.hasCompletedOnboarding) {
      state.hasCompletedOnboarding = true;
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
          if (opts.message) child.postMessage({ type: 'write', data: `${opts.message}\r` });
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

    // Per-project, not a single shared dir — keeps MindsHub Claude Code
    // sessions/config isolated per project and separate from the user's
    // own claude.ai profile (~/.claude).
    const claudeConfigDir = path.join(opts.projectPath, '.claude-mindshub');
    ensureClaudeConfigDefaults(claudeConfigDir);

    const startMsg = {
      type: 'start',
      claudePath: detection.path,
      args: ['--model', opts.model],
      cwd: opts.projectPath,
      cols,
      rows,
      env: {
        ...process.env,
        PATH: getEnvPath(),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        ANTHROPIC_BASE_URL: MINDSHUB_INFERENCE_BASE_URL,
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
