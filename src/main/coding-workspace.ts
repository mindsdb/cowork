// Per-task git worktree isolation for Claude Code tasks (ENG-1656 follow-up).
// Projects aren't git repos by default — cowork-server never runs `git init`
// anywhere (they're plain managed folders under ~/.cowork/projects/<name>/).
// Worktrees require a real repo with at least one commit to branch from, so
// the first time a repo needs a task worktree, this bootstraps one: `git
// init -b main`, a .gitignore covering the tool-owned dirs that shouldn't be
// versioned, and an initial commit. From then on every Claude Code task in
// that repo gets its own worktree under `<repo>/.claude-mindshub/tasks/
// <taskId>/` — a real, independent checkout on its own branch, so two
// concurrent tasks can never step on each other's uncommitted edits.
//
// Deliberately NOT `<repo>/.claude/` — this app's own `.claude/` (used
// elsewhere in this very monorepo, e.g. a `worktrees/` dir of its own)
// is Claude Code's real per-project state directory; reusing that name
// for our own tool-owned folder would collide with it. Everything
// MindsHub/coding-mode-owned lives under the one `.claude-mindshub/`
// directory instead — the CLI's config dir (`.claude-mindshub/config/`,
// set as CLAUDE_CONFIG_DIR by coding-terminal.ts) and task worktrees
// (`.claude-mindshub/tasks/<taskId>/`) side by side.
//
// Deliberately keyed by `repoPath`, not "the project" — a project that later
// links external sub-repos can call ensureTaskWorktree/removeTaskWorktree
// once per sub-repo for the same taskId; nothing here assumes there's only
// one repo per project.
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const MINDSHUB_DIRNAME = '.claude-mindshub';
const TASKS_SUBDIR = 'tasks';

// `.anton/` (project memory/artifacts, shared by Anton AND Hermes despite
// the name) and `skills/` (symlinks into the global skills store) are both
// live, harness-shared state — never git-tracked, so `ensureSharedLinks`
// below can point each worktree back at the one real copy instead of a
// frozen snapshot from whenever the repo happened to be initialized.
const SHARED_DIRS = ['.anton', 'skills'];
const GITIGNORE_ENTRIES = ['.anton/', 'skills/', `${MINDSHUB_DIRNAME}/`];

function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--is-inside-work-tree'], repoPath);
    return true;
  } catch {
    return false;
  }
}

/** Add any missing entries to the repo's .gitignore, preserving whatever's
 *  already there (a project may already have its own real .gitignore). */
function ensureGitignoreEntries(repoPath: string): void {
  const gitignorePath = path.join(repoPath, '.gitignore');
  let existing = '';
  try {
    existing = fs.readFileSync(gitignorePath, 'utf8');
  } catch { /* no .gitignore yet */ }
  const lines = existing.split('\n').map((l) => l.trim());
  const have = new Set(lines.filter(Boolean));
  const missing = GITIGNORE_ENTRIES.filter((e) => !have.has(e));
  if (missing.length === 0) return;
  const next = existing.length && !existing.endsWith('\n') ? `${existing}\n` : existing;
  fs.writeFileSync(gitignorePath, `${next}${missing.join('\n')}\n`);
}

async function ensureRepo(repoPath: string): Promise<void> {
  if (await isGitRepo(repoPath)) {
    ensureGitignoreEntries(repoPath);
    return;
  }
  await git(['init', '-b', 'main'], repoPath);
  ensureGitignoreEntries(repoPath);
  await git(['add', '-A'], repoPath);
  // --allow-empty: the whole repo may be covered by .gitignore (e.g. a
  // brand-new project with nothing in it yet) — HEAD still needs to exist
  // for `git worktree add -b` to have something to branch from.
  await git(['commit', '--allow-empty', '-m', 'Initial commit (auto-created for Claude Code task isolation)'], repoPath);
}

function tasksDir(repoPath: string): string {
  return path.join(repoPath, MINDSHUB_DIRNAME, TASKS_SUBDIR);
}

function taskWorktreePath(repoPath: string, taskId: string): string {
  return path.join(tasksDir(repoPath), taskId);
}

function taskBranchName(taskId: string): string {
  return `claude/${taskId}`;
}

/** Symlink `.anton/` and `skills/` from the worktree back to the real
 *  (project-level) directories, so a Claude Code task sees the exact same
 *  live project memory and skills Anton/Hermes do — not a git snapshot
 *  frozen at whenever the repo was first initialized. Idempotent and
 *  best-effort: skips a dir that doesn't exist yet in the repo (e.g. no
 *  harness has ever run there) and leaves anything already at the link
 *  path alone rather than overwriting it. */
function ensureSharedLinks(repoPath: string, worktreePath: string): void {
  for (const dir of SHARED_DIRS) {
    const target = path.join(repoPath, dir);
    const linkPath = path.join(worktreePath, dir);
    if (!fs.existsSync(target)) continue;
    try {
      fs.lstatSync(linkPath);
      continue; // something's already there (a prior link, most likely)
    } catch { /* nothing at linkPath yet — fall through and create it */ }
    try {
      fs.symlinkSync(target, linkPath, 'dir');
    } catch { /* best-effort — worst case the task just doesn't see it */ }
  }
}

export interface TaskWorktree {
  path: string;
  /** false when this worktree already existed — the task is reconnecting
   *  after its process died, not starting for the first time. */
  isNew: boolean;
}

/** Get (or lazily create) the worktree for a task in a given repo. Never
 *  throws — a git failure just means the caller falls back to running
 *  directly in `repoPath` (logged by the caller, not here). */
export async function ensureTaskWorktree(repoPath: string, taskId: string): Promise<TaskWorktree> {
  const worktreePath = taskWorktreePath(repoPath, taskId);
  if (fs.existsSync(worktreePath)) {
    ensureSharedLinks(repoPath, worktreePath);
    return { path: worktreePath, isNew: false };
  }
  await ensureRepo(repoPath);
  fs.mkdirSync(tasksDir(repoPath), { recursive: true });
  await git(['worktree', 'add', worktreePath, '-b', taskBranchName(taskId), 'main'], repoPath);
  ensureSharedLinks(repoPath, worktreePath);
  return { path: worktreePath, isNew: true };
}

/** Remove a task's worktree and its branch. Best-effort: if git doesn't
 *  know about the worktree (e.g. the repo was deleted/moved), falls back
 *  to a plain recursive delete so a stale directory doesn't linger. */
export async function removeTaskWorktree(repoPath: string, taskId: string): Promise<void> {
  const worktreePath = taskWorktreePath(repoPath, taskId);
  try {
    await git(['worktree', 'remove', worktreePath, '--force'], repoPath);
  } catch {
    try { fs.rmSync(worktreePath, { recursive: true, force: true }); } catch { /* already gone */ }
  }
  try {
    await git(['branch', '-D', taskBranchName(taskId)], repoPath);
  } catch { /* branch already gone, or repo itself is gone */ }
}
