// Create one worktree per task and repo, bootstrapping an initial commit when needed.
// Keep worktrees and CLI config under .claude-mindshub; .claude belongs to Claude itself.
// Key by repoPath so a task can span multiple linked repos.
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const MINDSHUB_DIRNAME = '.claude-mindshub';
const TASKS_SUBDIR = 'tasks';

// Keep .anton/ and skills/ untracked: worktrees link to live shared memory and skills.
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
  // Even an empty or fully ignored repo needs a HEAD for git worktree add.
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

/**
 * Link live project memory and skills into the worktree. Skip missing sources and existing
 * destinations.
 */
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

/**
 * Get or create the task worktree. The caller handles git failures by falling back to the project
 * directory.
 */
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

/**
 * Remove the worktree and branch; fall back to recursive deletion if git no longer knows the
 * worktree.
 */
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
