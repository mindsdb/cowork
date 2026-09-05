// Code Mode's engine (the Codex runtime and its native binary, over 100 MB per
// platform) is the `code` extra of cowork-server, not a core dependency. A first
// install stays small; the extra is added when Code Mode is switched on, and
// every later reinstall must carry it again or the engine silently disappears.
// This module holds the pure pieces of that rule so they can be unit-tested.

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

export const CODE_EXTRA = 'code';
export const CODEX_DIST_NAME = 'openai_codex';

/** `cowork-server<rest>` → `cowork-server[code]<rest>`, for every spec shape uv accepts. */
export function withCodeExtra(spec: string): string {
  const trimmed = spec.trim();
  if (!trimmed) return trimmed;
  // Preserve existing extras while adding code exactly once.
  const extras = /^cowork-server\s*\[([^\]]*)\]/i.exec(trimmed);
  if (extras) {
    const names = extras[1].split(',').map((name) => name.trim()).filter(Boolean);
    if (names.some((name) => name.toLowerCase() === CODE_EXTRA)) return trimmed;
    return `cowork-server[${[...names, CODE_EXTRA].join(',')}]${trimmed.slice(extras[0].length)}`;
  }
  // Name with a version or URL suffix: cowork-server==1.2, cowork-server>=0.1, cowork-server @ git+…
  const named = /^cowork-server(?=\s|$|[=<>!~@;])/i.exec(trimmed);
  if (named) return `cowork-server[${CODE_EXTRA}]${trimmed.slice(named[0].length)}`;
  // A bare URL or path (the COWORK_SERVER_PACKAGE escape hatch): a wheel, a
  // source dir, or a git+ URL. Name it so the extra can be requested.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return `cowork-server[${CODE_EXTRA}] @ ${trimmed}`;
  // A filesystem path: POSIX, a Windows drive, or a UNC share. pathToFileURL
  // gets the Windows forms right (file:///C:/… and file://server/share/…).
  if (/^(\.|\/|~|[A-Za-z]:[\\/]|\\\\)/.test(trimmed)) {
    const expanded = trimmed.startsWith('~') ? path.join(process.env.HOME || process.env.USERPROFILE || '', trimmed.slice(1)) : trimmed;
    return `cowork-server[${CODE_EXTRA}] @ ${pathToFileURL(path.resolve(expanded)).href}`;
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
  /** One line shown under the label: what the user will be asked to do. */
  hint?: string;
}

/** What installing Git asks of the user on this platform, if anything. */
export function gitStepHint(platform: NodeJS.Platform): string | undefined {
  if (platform === 'darwin') return 'macOS will offer to install the Command Line Tools. Choose Install.';
  if (platform === 'win32') return 'Windows will ask to allow Git for Windows to make changes. Choose Yes.';
  return undefined;
}

/** The steps Code Mode setup shows. Git is only a step where it is missing. */
export function codeSetupSteps(needsGit: boolean, platform: NodeJS.Platform = process.platform): CodeSetupStep[] {
  const steps: CodeSetupStep[] = [];
  if (needsGit) steps.push({ id: 'git', label: 'Install Git', status: 'pending', hint: gitStepHint(platform) });
  steps.push(
    { id: 'components', label: 'Download Code Mode components', status: 'pending' },
    { id: 'restart', label: 'Restart the Cowork service', status: 'pending' },
    { id: 'verify', label: 'Check the coding agent', status: 'pending' },
  );
  return steps;
}

/**
 * Whether the components install itself needs Git. uv clones git+ sources
 * (the git channel, and the anton override that comes with it) and needs Git
 * on PATH for that; a wheel or a PyPI version does not, so on the release
 * channel Git and the components can install at the same time.
 */
export function installNeedsGit(spec: { args: string[]; env: NodeJS.ProcessEnv }): boolean {
  return spec.args.some((arg) => /\bgit\+/.test(arg)) || 'UV_OVERRIDE' in spec.env;
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
