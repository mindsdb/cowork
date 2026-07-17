// Single source of truth for the global Cowork config home.
//
// History: the desktop app, cowork-server, and the agent used to scatter
// global config across `~/.anton` (the `.env` credentials + a state.json)
// AND `~/.cowork` (db, projects, files, …). Everything but the `.env` and
// state.json already lived under `~/.cowork`, so we consolidate the
// stragglers here and migrate them on first run. Per-project agent data
// stays workspace-relative (`<project>/.anton/…`) and is unrelated.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';

const LEGACY_HOME = path.join(os.homedir(), '.anton');

// Build-kind isolation: dev, preview, and stable builds each get their own
// config home (~/.cowork-<kind>) so switching between builds never shares
// state. This is the single knob for that — the desktop app writes everything
// (owner token, installation id, refresh token, .env, state.json) under
// coworkHome(), and the server subprocess is handed the same path via
// COWORK_HOME (see server-process.ts). Crucially it isolates the SQLite DB:
// an older build reopening a DB a newer build advanced fails to start on the
// unrecognized Alembic migration (ENG-324). Only prod uses ~/.cowork.
//
// Build kind resolves (first match wins):
//   1. COWORK_BUILD_KIND env var (manual override)
//   2. Unpackaged Electron (npm run dev) → "dev"
//   3. build-config.json bundled in app resources (CI writes it before
//      building — see .github/workflows/build-*.yml)
//   4. Fallback → "prod"
//
// Any value not in BUILD_KINDS (a typo, an unset CI input) resolves to "prod"
// so a mistake can never silently orphan a user onto a fresh, empty home that
// looks — to a confused tester — exactly like the ENG-324 symptom.
const BUILD_KINDS = ['dev', 'preview', 'stable', 'prod'] as const;
type BuildKind = (typeof BUILD_KINDS)[number];

function normalizeBuildKind(raw: string, source: string): BuildKind {
  const kind = raw.trim().toLowerCase();
  if ((BUILD_KINDS as readonly string[]).includes(kind)) return kind as BuildKind;
  console.warn(
    `[cowork-home] unrecognized build kind "${raw}" from ${source}; falling back ` +
      `to "prod". Expected one of: ${BUILD_KINDS.join(', ')}.`,
  );
  return 'prod';
}

let _buildKind: BuildKind | undefined;

// The build kind, resolved once and cached (it is fixed for the process, and
// coworkHome() is called on many hot paths).
export function buildKind(): BuildKind {
  if (_buildKind) return _buildKind;
  _buildKind = resolveBuildKind();
  return _buildKind;
}

function resolveBuildKind(): BuildKind {
  if (process.env.COWORK_BUILD_KIND) {
    return normalizeBuildKind(process.env.COWORK_BUILD_KIND, 'COWORK_BUILD_KIND');
  }
  if (!app.isPackaged) return 'dev';
  try {
    const configPath = path.join(process.resourcesPath || '', 'build-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config?.buildKind) return normalizeBuildKind(String(config.buildKind), 'build-config.json');
    }
  } catch { /* missing or malformed — fall through to prod */ }
  return 'prod';
}

/** Strict build-kind resolver for safety gates (e.g. OTA enablement).
 *  Unlike buildKind(), a missing / malformed / unrecognized packaged config
 *  resolves to `null` ("unknown") instead of defaulting to `prod`, so a
 *  mispackaged build can never accidentally opt into production-only behavior.
 *  A packaged build must carry an explicit, recognized build kind to be
 *  treated as prod. */
export function buildKindStrict(): BuildKind | null {
  const strict = (raw: string): BuildKind | null => {
    const kind = raw.trim().toLowerCase();
    return (BUILD_KINDS as readonly string[]).includes(kind) ? (kind as BuildKind) : null;
  };
  if (process.env.COWORK_BUILD_KIND) return strict(process.env.COWORK_BUILD_KIND);
  if (!app.isPackaged) return 'dev';
  try {
    const configPath = path.join(process.resourcesPath || '', 'build-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config?.buildKind) return strict(String(config.buildKind));
    }
  } catch { /* fall through to unknown */ }
  return null;
}

export function coworkHome(): string {
  const kind = buildKind();
  return path.join(os.homedir(), kind === 'prod' ? '.cowork' : `.cowork-${kind}`);
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

// Copy the legacy `~/.anton/.env` and `~/.anton/cowork/state.json` to the
// new `~/.cowork` location when they don't exist there yet, so existing
// installs keep their credentials + provider state. Idempotent and
// best-effort — never block startup on it.
export function migrateLegacyHome(): void {
  try {
    const home = coworkHome();
    if (!fs.existsSync(home)) fs.mkdirSync(home, { recursive: true });

    const newEnv = coworkEnvPath();
    const oldEnv = path.join(LEGACY_HOME, '.env');
    if (!fs.existsSync(newEnv) && fs.existsSync(oldEnv)) {
      fs.copyFileSync(oldEnv, newEnv);
    }

    const newState = coworkStatePath();
    const oldState = path.join(LEGACY_HOME, 'cowork', 'state.json');
    if (!fs.existsSync(newState) && fs.existsSync(oldState)) {
      fs.copyFileSync(oldState, newState);
    }
  } catch {
    // best-effort migration; a failure here must not stop the app.
  }
}
