// Global Cowork config home; migrate legacy ~/.anton credentials and state on first run.
// Per-project .anton data is unrelated.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { BUILD_KINDS, CHANNELS, normalizeBuildKind, type BuildKind } from './channels';

const LEGACY_HOME = path.join(os.homedir(), '.anton');

export type { BuildKind };

// Non-prod channels use separate homes so credentials and database migrations cannot cross
// channels.
// Only prod uses ~/.cowork; channels.ts owns the mapping.
// Resolve env override, unpackaged dev, then bundled config; only an absent config defaults to
// prod.

let _buildKind: BuildKind | undefined;

// Build kind is fixed for the process; cache it for callers on hot paths.
export function buildKind(): BuildKind {
  if (_buildKind) return _buildKind;
  _buildKind = resolveBuildKind();
  return _buildKind;
}

function resolveBuildKind(): BuildKind {
  // Blank overrides fall through to config resolution; unknown non-blank values throw.
  const envKind = process.env.COWORK_BUILD_KIND;
  if (envKind && envKind.trim() !== '') {
    return normalizeBuildKind(envKind, 'COWORK_BUILD_KIND');
  }
  // `app?.` (not `app.`): outside the Electron main process (tests, tooling)
  // `app` is undefined — treat as unpackaged/dev. In prod `app` is always set.
  if (!app?.isPackaged) return 'dev';
  const configured = readBuildConfigKind();
  if (configured === undefined) return 'prod';
  return normalizeBuildKind(configured, 'build-config.json');
}

// Missing config means a legacy release; unreadable or malformed config throws.
// The caller validates the kind itself.
export function readBuildConfigKind(): string | undefined {
  const configPath = path.join(process.resourcesPath || '', 'build-config.json');
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(
      `[cowork-home] build-config.json is present but unreadable ` +
        `(${(err as NodeJS.ErrnoException).code ?? 'unknown'}); refusing to fall back to prod.`,
    );
  }
  let config: { buildKind?: unknown } | null;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error(
      '[cowork-home] build-config.json is present but not valid JSON; refusing to fall back to prod.',
    );
  }
  const kind = config?.buildKind;
  if (kind === undefined || kind === null || String(kind).trim() === '') {
    throw new Error(
      '[cowork-home] build-config.json is present but declares no buildKind; refusing to fall back to prod.',
    );
  }
  return String(kind);
}

/** For safety gates, missing or invalid packaged identity means unknown, never prod. */
export function buildKindStrict(): BuildKind | null {
  const strict = (raw: string): BuildKind | null => {
    const kind = raw.trim().toLowerCase();
    return (BUILD_KINDS as readonly string[]).includes(kind) ? (kind as BuildKind) : null;
  };
  const envKind = process.env.COWORK_BUILD_KIND;
  if (envKind && envKind.trim() !== '') return strict(envKind);
  if (!app?.isPackaged) return 'dev';
  // Strict resolution maps both missing and broken config to unknown.
  try {
    const configured = readBuildConfigKind();
    return configured === undefined ? null : strict(configured);
  } catch {
    return null;
  }
}

export function coworkHome(): string {
  // QA home overrides require an absolute path and are disabled in packaged apps.
  if (!app?.isPackaged) {
    const override = process.env.COWORK_DEV_HOME?.trim();
    if (override) {
      if (!path.isAbsolute(override)) {
        throw new Error('[cowork-home] COWORK_DEV_HOME must be an absolute path.');
      }
      return path.normalize(override);
    }
  }
  return path.join(os.homedir(), CHANNELS[buildKind()].homeDirName);
}

export function coworkEnvPath(): string {
  return path.join(coworkHome(), '.env');
}

export function coworkStatePath(): string {
  return path.join(coworkHome(), 'state.json');
}

export function readEnvFile(): Record<string, string> {
  const vars: Record<string, string> = {};
  const envPath = coworkEnvPath();
  if (!fs.existsSync(envPath)) return vars;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }
  return vars;
}

// Best-effort, idempotent migration of legacy credentials and provider state.
export function migrateLegacyHome(): void {
  try {
    migrateLegacyHomeInto(buildKind(), coworkHome(), LEGACY_HOME);
  } catch {
    // best-effort migration; a failure here must not stop the app.
  }
}

// Create every channel home, but migrate legacy files only into prod.
// Legacy ~/.anton files contain production credentials and URLs.
export function migrateLegacyHomeInto(kind: BuildKind, home: string, legacyHome: string): void {
  if (!fs.existsSync(home)) fs.mkdirSync(home, { recursive: true });
  if (kind !== 'prod') return;

  const newEnv = path.join(home, '.env');
  const oldEnv = path.join(legacyHome, '.env');
  if (!fs.existsSync(newEnv) && fs.existsSync(oldEnv)) {
    fs.copyFileSync(oldEnv, newEnv);
  }

  const newState = path.join(home, 'state.json');
  const oldState = path.join(legacyHome, 'cowork', 'state.json');
  if (!fs.existsSync(newState) && fs.existsSync(oldState)) {
    fs.copyFileSync(oldState, newState);
  }
}
