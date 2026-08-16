// Embedded Claude Code terminal (ENG-1656 follow-up): runs the `claude` CLI
// in a real PTY inside the app, keyed by task id, so each Claude-Code task
// is its own independent, reconnectable session — mirroring how this app
// ran Anton's CLI in its own pre-GUI days.
//
// node-pty is a native module and is listed only as an `optionalDependency`
// (see package.json) — its native build is not guaranteed on every platform/
// Node ABI combination. Loaded lazily and defensively so a machine where it
// failed to build degrades to a clear "not available" error instead of
// crashing the whole app at require time. node-pty itself supports macOS,
// Linux and Windows (via winpty) equally — nothing here is platform-gated;
// only the optional native build can make it unavailable.
import * as os from 'os';
import * as path from 'path';
import type { WebContents } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { detectClaudeCode, revealMindsApiKey } from './coding-mode';
import { getEnvPath } from './uv-paths';

const MINDSHUB_INFERENCE_BASE_URL = 'https://api.mindshub.ai';

interface CodingTerminalOptions {
  projectPath: string;
  message: string;
  model: string;
}

interface StartResult {
  ok: boolean;
  reason?: string;
}

// Minimal structural type for the bits of a node-pty `IPty` this file uses —
// avoids a hard type dependency on the optional package.
interface PtyProcess {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

type PtyModule = { spawn: (file: string, args: string[], opts: Record<string, unknown>) => PtyProcess };
let ptyModule: PtyModule | null | undefined;

/** Lazily import node-pty. Cached: undefined = not yet tried, null = tried
 *  and unavailable (missing optional dep, or its native build failed on
 *  this machine), object = loaded. Never throws. */
async function loadPty(): Promise<PtyModule | null> {
  if (ptyModule !== undefined) return ptyModule;
  try {
    ptyModule = await import('node-pty');
  } catch {
    ptyModule = null;
  }
  return ptyModule;
}

const sessions = new Map<string, PtyProcess>();

export function isCodingTerminalRunning(taskId: string): boolean {
  return sessions.has(taskId);
}

/** Start (or, if already running, no-op and reconnect to) the PTY for a
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

  const pty = await loadPty();
  if (!pty) {
    return { ok: false, reason: 'Embedded terminal is not available on this build.' };
  }

  const detection = await detectClaudeCode();
  if (!detection.installed || !detection.path) {
    return { ok: false, reason: 'Claude Code CLI not found on PATH.' };
  }

  const authToken = await revealMindsApiKey();
  if (!authToken) {
    return { ok: false, reason: 'No MindsHub API key configured — sign in with MindsHub or add a key in Settings before using coding mode.' };
  }

  let proc: PtyProcess;
  try {
    // The opening task message is NOT passed as a CLI argument — node-pty's
    // native argv builder (pty.cc) has been observed to crash the whole
    // process on a long/multi-byte positional arg (a heap-corruption abort
    // inside PtyFork, not a catchable JS error). Typing it into the PTY's
    // stdin after the CLI is up avoids that code path entirely, and is
    // closer to how a real terminal session works besides.
    proc = pty.spawn(detection.path, ['--model', opts.model], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: opts.projectPath,
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
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'Failed to start Claude Code.' };
  }

  sessions.set(taskId, proc);
  proc.onData((data) => {
    sender.send(IPC.CODING_TERMINAL_DATA, taskId, data);
  });
  proc.onExit(({ exitCode }) => {
    sessions.delete(taskId);
    sender.send(IPC.CODING_TERMINAL_EXIT, taskId, exitCode);
  });

  if (opts.message) proc.write(`${opts.message}\r`);

  return { ok: true };
}

export function writeToCodingTerminal(taskId: string, data: string): void {
  sessions.get(taskId)?.write(data);
}

export function resizeCodingTerminal(taskId: string, cols: number, rows: number): void {
  sessions.get(taskId)?.resize(cols, rows);
}

export function killCodingTerminal(taskId: string): void {
  const proc = sessions.get(taskId);
  if (!proc) return;
  sessions.delete(taskId);
  try { proc.kill(); } catch { /* already gone */ }
}

export function killAllCodingTerminals(): void {
  for (const taskId of Array.from(sessions.keys())) killCodingTerminal(taskId);
}
