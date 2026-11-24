/*
 * The environment desktop main hands a process that runs an agent's or a
 * repository's commands: the embedded Claude Code CLI (coding-terminal.ts),
 * and the git calls in a task's repository (coding-workspace.ts), whose hooks
 * the agent can write. It is this app's own environment minus the families
 * Cowork sets or reads, so whatever the app was launched with for itself
 * stays out of them:
 *
 * - COWORK_*, MINDSHUB_*: this app's and its server's configuration. Dropped
 *   for every such process.
 * - CLAUDE_CODE_*, CLAUDECODE, ANTHROPIC_*: dropped for the Claude Code CLI
 *   only (`forClaudeCode`). A Claude Code session sets the first two on itself,
 *   and a dev running this app from inside one would otherwise make the
 *   embedded CLI think it is a child session, which disables its transcript
 *   saving. coding-terminal.ts sets the CLI's ANTHROPIC_BASE_URL and
 *   ANTHROPIC_AUTH_TOKEN itself, and a stray inherited ANTHROPIC_API_KEY would
 *   compete with them.
 *
 * Desktop main sets no OPENAI_* or ANTHROPIC_* variable, so those are the
 * user's own and stay in git's environment. On Windows, variable names are
 * case-insensitive, so the families match there whatever the case.
 */

const APP_PREFIXES = ['COWORK_', 'MINDSHUB_'];
const CLAUDE_CODE_PREFIXES = ['CLAUDE_CODE_', 'ANTHROPIC_'];
const CLAUDE_CODE_NAMES = new Set(['CLAUDECODE']);

export interface AgentEnvOptions {
  /* For the embedded Claude Code CLI: also drop Claude Code's own markers and
     ANTHROPIC_*, which coding-terminal.ts replaces with its own values. */
  readonly forClaudeCode?: boolean;
}

export function sanitizedParentEnv(parent: NodeJS.ProcessEnv = process.env, options: AgentEnvOptions = {}): NodeJS.ProcessEnv {
  const prefixes = options.forClaudeCode ? [...APP_PREFIXES, ...CLAUDE_CODE_PREFIXES] : APP_PREFIXES;
  const names = options.forClaudeCode ? CLAUDE_CODE_NAMES : new Set<string>();
  const caseInsensitive = process.platform === 'win32';
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parent)) {
    const name = caseInsensitive ? key.toUpperCase() : key;
    if (names.has(name) || prefixes.some((prefix) => name.startsWith(prefix))) continue;
    clean[key] = value;
  }
  return clean;
}
