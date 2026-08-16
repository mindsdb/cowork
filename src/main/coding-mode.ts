// Coding mode (MVP, ENG-1656 follow-up): detect a locally-installed `claude`
// CLI and launch a task with it in a real terminal window, instead of the
// in-app chat stream. Deliberately minimal — no in-app rendering of the
// session, macOS only for the launch step.
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { authHeader } from './server-auth';
import { getServerPort } from './server-process';
import { findOnPath } from './uv-paths';

const REQUEST_TIMEOUT_MS = 10_000;
const MINDS_INFERENCE_BASE_URL = 'https://api.mindshub.ai';

export interface ClaudeCodeDetection {
  installed: boolean;
  path: string | null;
}

export interface LaunchCodingTaskOptions {
  projectPath: string;
  message: string;
  model: string;
}

export interface LaunchCodingTaskResult {
  ok: boolean;
  reason?: string;
}

/** Is the `claude` CLI on this machine's PATH? Reuses the same probe the
 * installer uses for `uv` — `where`/`which` on an augmented PATH. */
export async function detectClaudeCode(): Promise<ClaudeCodeDetection> {
  const resolved = await findOnPath('claude');
  return { installed: resolved !== null, path: resolved };
}

/** Reveal the persisted MindsHub API key from cowork-server's own settings
 * store (`GET /settings/reveal-key/minds`) — loopback-gated, which a
 * main-process fetch to 127.0.0.1 satisfies. This is the same long-lived
 * `mdb_*` credential cowork-server itself uses to call MindsHub Inference;
 * no separate mint step is needed for the external CLI process. */
async function revealMindsApiKey(): Promise<string | null> {
  const port = getServerPort();
  if (!port) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/settings/reveal-key/minds`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { ...authHeader() },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { value?: unknown };
    const value = typeof data?.value === 'string' ? data.value : null;
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Single-quote a value for safe embedding in a POSIX shell script,
 * regardless of its contents (arbitrary task text, a secret token — no
 * assumptions about what characters it may contain). Standard escape: close
 * the quote, emit an escaped literal quote, reopen the quote. Exported for
 * direct unit testing (pure function) — the security-critical piece here. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Launch `claude` in a new Terminal window, cwd'd to the project folder,
 * seeded with the task message, authenticated against MindsHub Inference.
 *
 * Terminal.app's `do script` runs the command in a shell IT spawns — not a
 * child of this process — so env vars can't be handed down via `spawn`'s
 * `env` option; they have to be literal values inside the script text
 * itself. Every interpolated value (the secret, the task message, the
 * project path) goes through `shQuote` so nothing in them can break out of
 * its quoting, however it's phrased. The script deletes itself immediately
 * after exporting its values (before `exec`), so the secret doesn't sit on
 * disk any longer than it has to. */
export async function launchCodingTask(opts: LaunchCodingTaskOptions): Promise<LaunchCodingTaskResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'Coding mode terminal launch is only supported on macOS for now.' };
  }
  const { projectPath, message, model } = opts;
  if (!projectPath || !fs.existsSync(projectPath)) {
    return { ok: false, reason: 'Project folder not found on disk.' };
  }
  if (!message || !message.trim()) {
    return { ok: false, reason: 'Task message is empty.' };
  }

  const authToken = await revealMindsApiKey();
  if (!authToken) {
    return {
      ok: false,
      reason: 'No MindsHub API key configured — sign in with MindsHub or add a key in Settings before using coding mode.',
    };
  }

  const claudeConfigDir = path.join(os.homedir(), '.cowork', 'claude-code');
  const scriptPath = path.join(os.tmpdir(), `cowork-coding-task-${crypto.randomUUID()}.sh`);
  const script = [
    '#!/bin/sh',
    `export ANTHROPIC_BASE_URL=${shQuote(MINDS_INFERENCE_BASE_URL)}`,
    `export ANTHROPIC_AUTH_TOKEN=${shQuote(authToken)}`,
    `export CLAUDE_CONFIG_DIR=${shQuote(claudeConfigDir)}`,
    `cd ${shQuote(projectPath)} || exit 1`,
    // Best-effort cleanup: the script has already been read by the shell by
    // the time this line runs, so removing it here keeps the secret off
    // disk for as short a window as possible.
    `rm -f -- ${shQuote(scriptPath)}`,
    `exec claude --model ${shQuote(model)} ${shQuote(message)}`,
    '',
  ].join('\n');

  try {
    fs.writeFileSync(scriptPath, script, { mode: 0o600 });
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'Failed to write launch script.' };
  }

  // Only the script path (our own, UUID-generated) is embedded in the
  // AppleScript source; escape AppleScript's own string-special characters
  // defensively even though this path never contains user input.
  const escapedForAppleScript = scriptPath.replace(/(["\\])/g, '\\$1');
  const appleScript = `tell application "Terminal"
  activate
  do script "sh '${escapedForAppleScript}'"
end tell`;

  return new Promise((resolve) => {
    const child = spawn('osascript', ['-e', appleScript]);
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (err) => {
      resolve({ ok: false, reason: err.message });
    });
    child.on('exit', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, reason: stderr.trim() || `osascript exited with code ${code}` });
    });
  });
}
