import { diagnostic } from '../shared/diagnostics';
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
import { updateEnvFile } from './dotenv-update';
import { accountDataHome, readActiveAccount } from './account-data';
import { BUILD_KINDS, CHANNELS, normalizeBuildKind, type BuildKind } from './channels';
import { createPrivateAccountRoot, pinAccountRoots, pinPrivateDir, tightenHomeOnce, tightenLegacyHome, type PlatformOption } from './private-files';

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

/* Local desktop QA needs the same isolation guarantees as packaged channels,
 * without writing into a developer's real ~/.cowork-dev. Keep this override
 * deliberately unavailable to packaged applications and require an absolute
 * path so a changed working directory can never redirect credentials/state. */
function developmentHomeOverride(): string | null {
  if (app?.isPackaged) return null;
  const override = process.env.COWORK_DEV_HOME?.trim();
  if (!override) return null;
  if (!path.isAbsolute(override)) {
    throw new Error('[cowork-home] COWORK_DEV_HOME must be an absolute path.');
  }
  return path.normalize(override);
}

export function coworkHome(): string {
  return developmentHomeOverride() ?? path.join(os.homedir(), CHANNELS[buildKind()].homeDirName);
}

/**
 * Every Cowork home on this computer that the boot pin covers.
 *
 * With the development override set, only that folder, so a dev or test run
 * never touches the real homes. Otherwise each channel's home that exists,
 * named from the channel table and never found by a glob, so a folder such as
 * `~/.cowork-poc-x` that merely looks like a home is left alone.
 */
function privateHomePaths(): string[] {
  const override = developmentHomeOverride();
  if (override) return [override];
  return BUILD_KINDS.map((kind) => path.join(os.homedir(), CHANNELS[kind].homeDirName)).filter((home) =>
    fs.existsSync(home),
  );
}

/**
 * Pin each Cowork home and each of its account roots to 0700, and return the
 * homes it pinned. Synchronous, and run at boot before any sidecar can start:
 * this pin is what keeps other accounts out. A failure logs and never blocks
 * boot. An account root that cannot be pinned costs only itself: its home is
 * still returned, so the home still gets its one-time pass.
 */
export function pinPrivateHomes(options: PlatformOption = {}): string[] {
  const pinned: string[] = [];
  let homes: string[];
  try {
    homes = privateHomePaths();
  } catch (err) {
    diagnostic("main.cowork-home", "WARNING", "cowork_home_could_not_list_the_homes_to_pin", '[cowork-home] could not list the homes to pin', err);
    return pinned;
  }
  for (const home of homes) {
    try {
      pinPrivateDir(home, options);
    } catch (err) {
      diagnostic("main.cowork-home", "WARNING", "cowork_home_could_not_pin_a_home_to_its_owner", '[cowork-home] could not pin a home to its owner', err);
      continue;
    }
    pinned.push(home);
    try {
      pinAccountRoots(home, options);
    } catch (err) {
      diagnostic("main.cowork-home", "WARNING", "cowork_home_could_not_list_private_account_roots", '[cowork-home] could not pin account roots', err);
    }
  }
  return pinned;
}

/**
 * Run the one-time pass that strips group and other bits from every entry of
 * each home `pinPrivateHomes` pinned. One home at a time, after boot. Never
 * rejects, so the boot step can start it without awaiting it: a failure in one
 * home is logged, the next home still runs, and the pass runs again next
 * launch.
 */
export async function tightenPrivateHomes(homes: readonly string[], options: PlatformOption = {}): Promise<void> {
  for (const home of homes) {
    try {
      const result = await tightenHomeOnce(home, options);
      if (result.kind === 'tightened') {
        diagnostic("main.cowork-home", "INFO", "cowork_home_tightened_the_modes_in_a_home", '[cowork-home] tightened the modes in a home', { count: result.changed });
      }
    } catch (err) {
      diagnostic("main.cowork-home", "WARNING", "cowork_home_could_not_tighten_the_modes_in_a_home", '[cowork-home] could not tighten the modes in a home', err);
    }
  }
}

/**
 * The data root for the account currently signed in: `coworkHome()` itself for
 * the account that owns it, a subtree otherwise.
 *
 * `coworkHome()` stays the SHARED root and keeps everything that answers "who is
 * signed in" — the refresh token, the account record, the ownership claim, the
 * server owner token — because those cannot be per-account without a bootstrap
 * cycle. Everything an account OWNS hangs off this instead.
 */
export function accountDataRoot(): string {
  const shared = coworkHome();
  return accountDataHome(shared, readActiveAccount(shared));
}

/**
 * The account's data root, created if it is not there yet.
 *
 * Every writer of `coworkEnvPath()` or `coworkStatePath()` must go through this
 * rather than creating `coworkHome()`: a second account's root does not exist
 * until something makes it, and an atomic write puts its temp file in the target
 * directory, so writing first would fail with ENOENT and lose the value.
 */
export function ensureAccountDataRoot(): string {
  const home = coworkHome();
  const root = accountDataRoot();
  pinPrivateDir(home);
  if (root !== home) createPrivateAccountRoot(home, path.basename(root));
  return root;
}

/**
 * The account's own dotenv, and below it its provider state.
 *
 * Per-account rather than shared, because these are written by whichever
 * account is signed in: a second account entering its own provider key would
 * otherwise write it into the owning account's file, and the owner would import
 * it on their next sign-in. It also puts the dotenv where the sidecar reads it,
 * since cowork-server derives its chain from COWORK_HOME.
 *
 * Accepted cost: terms consent, DEV_MODE and the keychain preference travel
 * with the account, so a second account on one machine accepts terms again.
 */
export function coworkEnvPath(): string {
  return coworkEnvPathIn(accountDataRoot());
}

export function coworkStatePath(): string {
  return coworkStatePathIn(accountDataRoot());
}

/** The account's dotenv under a given account root, for a caller that captured
 *  the root before the account record could change (sign-out). */
export function coworkEnvPathIn(accountRoot: string): string {
  return path.join(accountRoot, '.env');
}

/** The account's provider state under a given account root, for the same
 *  reason as `coworkEnvPathIn`. */
export function coworkStatePathIn(accountRoot: string): string {
  return path.join(accountRoot, 'state.json');
}

export function readEnvFile(): Record<string, string> {
  return readEnvFileAt(coworkEnvPath());
}

export function readEnvFileAt(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) return {};
  return parseEnv(fs.readFileSync(envPath, 'utf-8'));
}

function parseEnv(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }
  return vars;
}

/**
 * What a root the SAME account is starting fresh on inherits from the root it
 * just disclaimed.
 *
 * Only the terms answer, and only when the destination has none. Everything
 * else about a fresh root should be fresh — that is what the person asked for —
 * but consent is about the human, not the storage location, and this is the one
 * account that gave it, minutes earlier, in this session. Re-asking here is
 * indistinguishable from having been signed out, which is not what the dialog
 * offered.
 *
 * Deliberately NOT the general rule for a new account root: a SECOND account is
 * a second person and accepts terms itself. See `coworkEnvPath`.
 */
export function termsConsentToCarry(
  disclaimed: Record<string, string>,
  destination: Record<string, string>,
): Record<string, string> {
  if (destination.ANTON_TERMS_CONSENT) return {};
  return disclaimed.ANTON_TERMS_CONSENT === 'true' ? { ANTON_TERMS_CONSENT: 'true' } : {};
}

/**
 * Carry that answer onto the account's own root. Best-effort: a consent that
 * cannot be copied costs one extra screen, where failing the decision would
 * cost the person the answer they just gave.
 */
export async function carryTermsConsentToFreshRoot(disclaimedHome: string): Promise<void> {
  try {
    const envPath = path.join(ensureAccountDataRoot(), '.env');
    const source = readEnvFileAt(path.join(disclaimedHome, '.env'));
    await updateEnvFile(envPath, (content) => {
      const existing = content ?? '';
      const entries = Object.entries(termsConsentToCarry(source, parseEnv(existing)));
      if (!entries.length) return null;
      const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
      return existing + prefix + entries.map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
    });
  } catch (err) {
    diagnostic("main.cowork-home", "WARNING", "cowork_home_could_not_carry_the_terms_answer_onto_the_fresh_root", '[cowork-home] could not carry the terms answer onto the fresh root', err);
  }
}

// Copy the legacy `~/.anton/.env` and `~/.anton/cowork/state.json` to the
// current config home when they don't exist there yet, so existing installs
// keep their credentials + provider state. Idempotent and best-effort — never
// block startup on it.
export function migrateLegacyHome(): void {
  try {
    const home = coworkHome();
    if (developmentHomeOverride() !== null) {
      pinPrivateDir(home);
      return;
    }
    migrateLegacyHomeInto(buildKind(), home, LEGACY_HOME, { packaged: app?.isPackaged });
  } catch {
    // best-effort migration; a failure here must not stop the app.
  }
}

/** Publish a private, complete copy only if the destination is still absent. */
function copyLegacyFile(source: string, target: string): void {
  if (fs.existsSync(target) || !fs.existsSync(source)) return;
  const contents = fs.readFileSync(source);
  const staging = fs.mkdtempSync(path.join(path.dirname(target), '.legacy-copy-'));
  try {
    const file = path.join(staging, 'copy');
    fs.writeFileSync(file, contents, { mode: 0o600, flag: 'wx' });
    try {
      fs.linkSync(file, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** Packaged channels repair the legacy permissions. Only production imports
 * the old credentials and provider state into its private destination. */
export function migrateLegacyHomeInto(
  kind: BuildKind,
  home: string,
  legacyHome: string,
  options: PlatformOption & { packaged?: boolean } = {},
): void {
  if (options.packaged || kind === 'prod') {
    try {
      tightenLegacyHome(legacyHome, options);
    } catch (err) {
      diagnostic("main.cowork-home", "WARNING", "cowork_home_could_not_tighten_the_legacy_home", '[cowork-home] could not tighten the legacy home', err);
    }
  }
  pinPrivateDir(home, options);
  if (kind === 'prod') {
    copyLegacyFile(path.join(legacyHome, '.env'), path.join(home, '.env'));
    copyLegacyFile(path.join(legacyHome, 'cowork', 'state.json'), path.join(home, 'state.json'));
  }
}
