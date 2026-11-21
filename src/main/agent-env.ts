/*
 * The environment desktop main hands a process that runs an agent's or a
 * repository's commands: the embedded Claude Code CLI (coding-terminal.ts),
 * and the git calls in a task's repository (coding-workspace.ts), whose hooks
 * the agent can write. It is this app's own environment minus the families
 * below, so whatever the app was launched with stays out of them:
 *
 * - CLAUDE_CODE_*, CLAUDECODE: set by a Claude Code session on itself. A dev
 *   running this app from inside one would otherwise make the embedded CLI
 *   think it is a child session, which disables its transcript saving.
 * - ANTHROPIC_*: coding-terminal.ts sets the CLI's base URL and token itself,
 *   and a stray inherited ANTHROPIC_API_KEY would compete with them.
 * - COWORK_*, MINDSHUB_*, OPENAI_*: this app's and its server's configuration
 *   and provider keys.
 */

const DROPPED_PREFIXES = ['CLAUDE_CODE_', 'ANTHROPIC_', 'COWORK_', 'MINDSHUB_', 'OPENAI_'];
const DROPPED_NAMES = new Set(['CLAUDECODE']);

export function sanitizedParentEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parent)) {
    if (DROPPED_NAMES.has(key) || DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    clean[key] = value;
  }
  return clean;
}
