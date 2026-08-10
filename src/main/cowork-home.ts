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
import { BUILD_KINDS, CHANNELS, normalizeBuildKind, type BuildKind } from './channels';

const LEGACY_HOME = path.join(os.homedir(), '.anton');

export type { BuildKind };

// Build-kind isolation: dev/preview/stable builds each get their own config home
// (~/.cowork-<kind>) so switching builds never shares state — the desktop app
// writes everything (tokens, .env, state.json) under coworkHome() and hands the
// server the same path via COWORK_HOME. Critically this isolates the SQLite DB:
// an older build reopening a DB a newer build advanced fails on the unrecognized
// Alembic migration (ENG-324). Only prod uses ~/.cowork. The kind→home/API/branch
// mapping lives in channels.ts; this module only resolves WHICH kind we are.
//
// Build kind resolves (first match wins):
//   1. COWORK_BUILD_KIND env var (manual override)
//   2. Unpackaged Electron (npm run dev) → "dev"
//   3. build-config.json bundled in app resources (CI writes it pre-build)
//   4. Packaged, no override, no config → "prod" (a legacy release)
//
// Fail-closed: only a genuinely ABSENT signal degrades to prod; a present-but-
// broken config (unreadable / invalid JSON / no buildKind) or unrecognized kind
// THROWS — pointing a non-prod build at the prod home on a typo is the hazard.

let _buildKind: BuildKind | undefined;

// The build kind, resolved once and cached (it is fixed for the process, and
// coworkHome() is called on many hot paths).
export function buildKind(): BuildKind {
  if (_buildKind) return _buildKind;
  _buildKind = resolveBuildKind();
  return _buildKind;
}

function resolveBuildKind(): BuildKind {
  // A blank override (empty or whitespace-only — e.g. a CI templating slip
  // emitting `COWORK_BUILD_KIND=""`) is treated as ABSENT: it falls through to
  // config resolution rather than short-circuiting to prod. Only a non-blank
  // value is a real override, which normalizeBuildKind accepts or THROWS on.
  const envKind = process.env.COWORK_BUILD_KIND;
  if (envKind && envKind.trim() !== '') {
    return normalizeBuildKind(envKind, 'COWORK_BUILD_KIND');
  }
  // `app?.` (not `app.`): outside the Electron main process (tests, tooling)
  // `app` is undefined — treat as unpackaged/dev. In prod `app` is always set.
  if (!app?.isPackaged) return 'dev';
  // Absent config → prod (legacy release); present-but-broken or unrecognized
  // throws (readBuildConfigKind / normalizeBuildKind). See the module header.
  const configured = readBuildConfigKind();
  if (configured === undefined) return 'prod';
  return normalizeBuildKind(configured, 'build-config.json');
}

// Read `buildKind` from the bundled build-config.json. No file (ENOENT) →
// undefined (a legacy release; the caller maps it to prod); present but
// unreadable / invalid JSON / missing buildKind → THROW (a mispackaged build
// fails closed). Only distinguishes "no config" from "broken config"; recognized-
// kind validation is the caller's (normalizeBuildKind).
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

/** Strict build-kind resolver for safety gates (e.g. OTA enablement). Unlike
 *  buildKind(), a missing / malformed / unrecognized packaged config resolves to
 *  `null` ("unknown") instead of prod, so a mispackaged build can never opt into
 *  production-only behavior. */
export function buildKindStrict(): BuildKind | null {
  const strict = (raw: string): BuildKind | null => {
    const kind = raw.trim().toLowerCase();
    return (BUILD_KINDS as readonly string[]).includes(kind) ? (kind as BuildKind) : null;
  };
  // Same blank-is-absent handling as resolveBuildKind: a whitespace-only override
  // falls through rather than being treated as an (unrecognized → null) value.
  const envKind = process.env.COWORK_BUILD_KIND;
  if (envKind && envKind.trim() !== '') return strict(envKind);
  if (!app?.isPackaged) return 'dev';
  // Reuse the one config reader so parsing can't drift between the two resolvers;
  // strict never throws or defaults to prod — broken (throws) or absent both → null.
  try {
    const configured = readBuildConfigKind();
    return configured === undefined ? null : strict(configured);
  } catch {
    return null;
  }
}

export function coworkHome(): string {
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

// Copy the legacy `~/.anton/.env` and `~/.anton/cowork/state.json` to the
// current config home when they don't exist there yet, so existing installs
// keep their credentials + provider state. Idempotent and best-effort — never
// block startup on it.
export function migrateLegacyHome(): void {
  try {
    migrateLegacyHomeInto(buildKind(), coworkHome(), LEGACY_HOME);
  } catch {
    // best-effort migration; a failure here must not stop the app.
  }
}

// The testable body of migrateLegacyHome (explicit kind + paths, so it's
// unit-testable without Electron). Ensures the home dir exists for every kind,
// but seeds legacy files into the PROD home only: ~/.anton predates the channel
// split, so its .env carries prod-minted credentials and a prod ANTON_MINDS_URL —
// seeding a non-prod home with it would leak prod URLs/credentials across envs.
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
