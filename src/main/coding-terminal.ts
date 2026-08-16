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
import * as os from 'os';
import * as path from 'path';
import { utilityProcess } from 'electron';
import type { UtilityProcess, WebContents } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { detectClaudeCode, revealMindsApiKey } from './coding-mode';
import { getEnvPath } from './uv-paths';

const MINDSHUB_INFERENCE_BASE_URL = 'https://api.mindshub.ai';
const START_TIMEOUT_MS = 15_000;

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
          finish({ ok: false, reason: msg.reason });
          break;
      }
    });
    child.on('exit', () => {
      sessions.delete(taskId);
      finish({ ok: false, reason: 'Coding terminal process exited unexpectedly.' });
    });

    child.postMessage({
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
        CLAUDE_CONFIG_DIR: path.join(os.homedir(), '.cowork', 'claude-code'),
      },
    });
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
