// One reconnectable Claude PTY per task, hosted in coding-pty-host.ts to isolate native spawn.
// node-pty is optional; the host reports an unavailable error if its native build is missing.
import * as fs from 'fs';
import * as path from 'path';
import { utilityProcess } from 'electron';
import type { UtilityProcess, WebContents } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { detectClaudeCode, revealMindsApiKey, revealMindsBaseUrl } from './coding-mode';
import { ensureTaskWorktree, removeTaskWorktree } from './coding-workspace';
import { getEnvPath } from './uv-paths';

// Fallback only; prefer the host stored with the key so non-prod credentials reach the correct API.
const MINDSHUB_INFERENCE_FALLBACK_URL = 'https://api.mindshub.ai';
const START_TIMEOUT_MS = 15_000;

// Do not inherit parent Claude session state or competing Anthropic credentials.
// The embedded process receives its own auth and session configuration below.
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

/**
 * Seed onboarding and trust for the embedded CLI, preserving existing config.
 * Trust is keyed by realpath: Claude resolves symlinks before looking up the directory.
 * Best-effort; failures leave the CLI’s own prompts in place.
 */
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

/** Reconnect to an existing task PTY without replaying its opening prompt. */
export async function startCodingTerminal(
  taskId: string,
  opts: CodingTerminalOptions,
  cols: number,
  rows: number,
  sender: WebContents,
): Promise<StartResult> {
  if (sessions.has(taskId)) return { ok: true };

  if (typeof opts.model !== 'string' || !opts.model) {
    // Validate here so node-pty does not report an opaque argument-type error inside the host.
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

  // Use a worktree per task. Relaunches resume with --continue; only new tasks receive the opening
  // prompt.
  // Without git, fall back to the project directory without isolation.
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

  // Keep config separate from the user’s ~/.claude under .claude-mindshub/config.
  // Trust the resolved worktree cwd, not the project root.
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
      // The host waits for TUI readiness before typing. Reconnects resume history without replaying
      // the prompt.
      initialInput: isNewSession && opts.message ? `${opts.message}\r` : undefined,
      env: {
        ...sanitizedParentEnv(),
        PATH: getEnvPath(),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        ANTHROPIC_BASE_URL: inferenceBaseUrl,
        ANTHROPIC_AUTH_TOKEN: authToken,
        CLAUDE_CONFIG_DIR: claudeConfigDir,
        // MindsHub aliases are not in Claude’s built-in model list; suppress its unknown-model
        // warning.
        CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: '1',
      },
    };

    // Log argument types before the host’s native spawn can throw an opaque string-validation
    // error.
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

/** Stop the task PTY and remove its worktree and branch when the task is deleted. */
export async function removeCodingTask(taskId: string, projectPath: string): Promise<void> {
  killCodingTerminal(taskId);
  await removeTaskWorktree(projectPath, taskId);
}
