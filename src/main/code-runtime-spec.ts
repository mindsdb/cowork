// Code Mode's engine (the Codex runtime and its native binary, over 100 MB per
// platform) is the `code` extra of cowork-server, not a core dependency. A first
// install stays small; the extra is added when Code Mode is switched on, and
// every later reinstall must carry it again or the engine silently disappears.
// This module holds the pure pieces of that rule so they can be unit-tested.

import * as fs from 'fs';
import * as path from 'path';

export const CODE_EXTRA = 'code';
export const CODEX_DIST_NAME = 'openai_codex';

/** `cowork-server<rest>` → `cowork-server[code]<rest>`, for every spec shape uv accepts. */
export function withCodeExtra(spec: string): string {
  const trimmed = spec.trim();
  if (!trimmed) return trimmed;
  // Already carries extras: leave it.
  if (/^cowork-server\s*\[/i.test(trimmed)) return trimmed;
  // Name with a version or URL suffix: cowork-server==1.2, cowork-server>=0.1, cowork-server @ git+…
  const named = /^cowork-server(?=\s|$|[=<>!~@;])/i.exec(trimmed);
  if (named) return `cowork-server[${CODE_EXTRA}]${trimmed.slice(named[0].length)}`;
  // A bare URL or path (the COWORK_SERVER_PACKAGE escape hatch): a wheel, a
  // source dir, or a git+ URL. Name it so the extra can be requested.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return `cowork-server[${CODE_EXTRA}] @ ${trimmed}`;
  if (/^(\.|\/|~|[A-Za-z]:[\\/])/.test(trimmed)) {
    const url = trimmed.startsWith('file://') ? trimmed : `file://${path.resolve(trimmed)}`;
    return `cowork-server[${CODE_EXTRA}] @ ${url}`;
  }
  return trimmed;
}

/** Whether the Codex runtime is present in a tool venv, judged from its site-packages. */
export function codeRuntimeInstalledIn(sitePackages: string | null): boolean {
  if (!sitePackages) return false;
  try {
    return fs.readdirSync(sitePackages).some(
      (entry) => entry.startsWith(`${CODEX_DIST_NAME}-`) && entry.endsWith('.dist-info'),
    );
  } catch {
    return false;
  }
}

export type CodeSetupStepId = 'git' | 'components' | 'restart' | 'verify';
export type CodeSetupStatus = 'pending' | 'running' | 'done' | 'warning' | 'error' | 'skipped';

export interface CodeSetupStep {
  id: CodeSetupStepId;
  label: string;
  status: CodeSetupStatus;
}

/** The steps Code Mode setup shows. Git is only a step where it is missing. */
export function codeSetupSteps(needsGit: boolean): CodeSetupStep[] {
  const steps: CodeSetupStep[] = [];
  if (needsGit) steps.push({ id: 'git', label: 'Install Git', status: 'pending' });
  steps.push(
    { id: 'components', label: 'Download Code Mode components', status: 'pending' },
    { id: 'restart', label: 'Restart the Code service', status: 'pending' },
    { id: 'verify', label: 'Check the coding agent', status: 'pending' },
  );
  return steps;
}

/**
 * How Git is installed on this platform when it is missing. macOS ships a
 * `git` stub that only works once the Xcode Command Line Tools are present,
 * so the check must run `git --version`, not merely find the binary.
 */
export function gitInstallRoute(platform: NodeJS.Platform): 'xcode' | 'winget' | 'manual' {
  if (platform === 'darwin') return 'xcode';
  if (platform === 'win32') return 'winget';
  return 'manual';
}
