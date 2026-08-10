import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// buildKindStrict() is the safety gate OTA enablement rides on (ENG-670): a
// packaged build is treated as prod ONLY when it carries an explicit, recognized
// build kind, and anything missing/malformed/unrecognized resolves to null
// (never prod) so a mispackaged build can't opt into production-only OTA. These
// tests pin exactly that, standing in for the "confirm buildKindStrict resolves
// prod in a real prod build" QA item at the logic level.
//
// The mock exposes a mutable `isPackaged` getter for buildKindStrict's
// packaging checks; the seeding suite below takes explicit paths and never
// touches `app`, so the same stub serves both.
const appState = { isPackaged: true };
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged;
    },
    getPath: () => '',
  },
}));

import { buildKindStrict, migrateLegacyHomeInto, readBuildConfigKind } from './cowork-home';

let resourcesDir: string;
let originalResourcesPath: string | undefined;

beforeEach(() => {
  delete process.env.COWORK_BUILD_KIND; // deterministic: ignore the dev's shell
  appState.isPackaged = true;
  resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-res-'));
  originalResourcesPath = process.resourcesPath;
  // process.resourcesPath is where a packaged build's build-config.json lives.
  Object.defineProperty(process, 'resourcesPath', { value: resourcesDir, configurable: true });
});

afterEach(() => {
  Object.defineProperty(process, 'resourcesPath', { value: originalResourcesPath, configurable: true });
  fs.rmSync(resourcesDir, { recursive: true, force: true });
  delete process.env.COWORK_BUILD_KIND;
});

function writeBuildConfig(contents: string) {
  fs.writeFileSync(path.join(resourcesDir, 'build-config.json'), contents);
}

describe('buildKindStrict', () => {
  it('resolves prod from a packaged build-config.json (the real prod-build path)', () => {
    writeBuildConfig(JSON.stringify({ buildKind: 'prod' }));
    expect(buildKindStrict()).toBe('prod');
  });

  it('resolves other recognized kinds from build-config.json', () => {
    writeBuildConfig(JSON.stringify({ buildKind: 'preview' }));
    expect(buildKindStrict()).toBe('preview');
    writeBuildConfig(JSON.stringify({ buildKind: 'STABLE' })); // case-insensitive
    expect(buildKindStrict()).toBe('stable');
  });

  it('fails safe to null (never prod) when packaged with no build-config.json', () => {
    expect(buildKindStrict()).toBeNull();
  });

  it('fails safe to null for a malformed build-config.json', () => {
    writeBuildConfig('{ not json');
    expect(buildKindStrict()).toBeNull();
  });

  it('fails safe to null for an unrecognized build kind', () => {
    writeBuildConfig(JSON.stringify({ buildKind: 'production' })); // not in BUILD_KINDS
    expect(buildKindStrict()).toBeNull();
    writeBuildConfig(JSON.stringify({ buildKind: '' }));
    expect(buildKindStrict()).toBeNull();
  });

  it('treats an unpackaged build as dev, not prod', () => {
    appState.isPackaged = false;
    expect(buildKindStrict()).toBe('dev');
  });

  it('honours the COWORK_BUILD_KIND override ahead of packaging/config', () => {
    process.env.COWORK_BUILD_KIND = 'prod';
    appState.isPackaged = false; // override wins even unpackaged
    expect(buildKindStrict()).toBe('prod');

    process.env.COWORK_BUILD_KIND = 'nonsense';
    appState.isPackaged = true;
    writeBuildConfig(JSON.stringify({ buildKind: 'prod' })); // ignored — env wins
    expect(buildKindStrict()).toBeNull();
  });
});

describe('buildKind (composed env → packaging → config resolver)', () => {
  // buildKindStrict/readBuildConfigKind above cover the pieces; this pins the
  // real function every consumer (coworkHome, minds-urls, server-source, …)
  // calls, end-to-end. buildKind() caches in a module-level `_buildKind`, so
  // each case re-imports a fresh module instance via vi.resetModules().
  async function freshBuildKind() {
    vi.resetModules();
    const mod = await import('./cowork-home');
    return mod.buildKind;
  }

  it('honours a valid COWORK_BUILD_KIND override', async () => {
    process.env.COWORK_BUILD_KIND = 'preview';
    const buildKind = await freshBuildKind();
    expect(buildKind()).toBe('preview');
  });

  it('THROWS on an unrecognized COWORK_BUILD_KIND (never silently prod)', async () => {
    process.env.COWORK_BUILD_KIND = 'prod-ish';
    const buildKind = await freshBuildKind();
    expect(() => buildKind()).toThrow(/invalid build kind/i);
  });

  it('treats a present-but-whitespace COWORK_BUILD_KIND as absent, resolving via config (not prod)', async () => {
    // A whitespace-only override (a CI templating slip) must NOT short-circuit to
    // prod: it falls through to the packaged config, which resolves the true kind.
    process.env.COWORK_BUILD_KIND = '   ';
    writeBuildConfig(JSON.stringify({ buildKind: 'stable' }));
    const buildKind = await freshBuildKind();
    expect(buildKind()).toBe('stable');
  });

  it('resolves prod from a packaged build with NO config (a legacy release)', async () => {
    // no COWORK_BUILD_KIND (cleared in beforeEach), packaged, empty resourcesDir
    const buildKind = await freshBuildKind();
    expect(buildKind()).toBe('prod');
  });

  it('THROWS on a packaged build with a broken config (fail closed, never prod)', async () => {
    writeBuildConfig('{ not json');
    const buildKind = await freshBuildKind();
    expect(() => buildKind()).toThrow(/not valid JSON/i);
  });

  it('resolves the configured kind from a well-formed packaged config', async () => {
    writeBuildConfig(JSON.stringify({ buildKind: 'preview' }));
    const buildKind = await freshBuildKind();
    expect(buildKind()).toBe('preview');
  });

  it('treats an unpackaged build as dev', async () => {
    appState.isPackaged = false;
    const buildKind = await freshBuildKind();
    expect(buildKind()).toBe('dev');
  });
});

describe('readBuildConfigKind (present-but-broken config must fail closed)', () => {
  // Re-review boundary: distinguish an ABSENT config (legacy release → prod)
  // from a PRESENT but broken one (mispackaged build → fail closed, never prod).
  it('returns undefined when there is no build-config.json (legacy → prod)', () => {
    // beforeEach points resourcesPath at a fresh empty dir, so no file exists.
    expect(readBuildConfigKind()).toBeUndefined();
  });

  it('returns the raw kind when present and well-formed (validation is the caller’s job)', () => {
    writeBuildConfig(JSON.stringify({ buildKind: 'stable' }));
    expect(readBuildConfigKind()).toBe('stable');
  });

  it('THROWS on a present but malformed (non-JSON) config', () => {
    writeBuildConfig('{ not json');
    expect(() => readBuildConfigKind()).toThrow(/not valid JSON/i);
  });

  it('THROWS on a present config with no buildKind key', () => {
    writeBuildConfig(JSON.stringify({ somethingElse: true }));
    expect(() => readBuildConfigKind()).toThrow(/no buildKind/i);
  });

  it('THROWS on a present config with an empty/whitespace buildKind', () => {
    writeBuildConfig(JSON.stringify({ buildKind: '   ' }));
    expect(() => readBuildConfigKind()).toThrow(/no buildKind/i);
  });
});

describe('migrateLegacyHomeInto (legacy ~/.anton seeding is PROD-ONLY)', () => {
  // ~/.anton predates the channel split, so its .env / state.json are prod-era
  // by definition (prod-minted MindsHub credentials, prod ANTON_MINDS_URL).
  // Seeding a non-prod channel's fresh home with it would leak prod
  // credentials/URLs into an isolated channel — the review-flagged gap.
  let root: string;
  let legacyHome: string;
  let home: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-legacy-test-'));
    legacyHome = path.join(root, '.anton');
    home = path.join(root, '.cowork-x');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function seedLegacy(): void {
    fs.mkdirSync(path.join(legacyHome, 'cowork'), { recursive: true });
    fs.writeFileSync(path.join(legacyHome, '.env'), 'ANTON_MINDS_URL=prod');
    fs.writeFileSync(path.join(legacyHome, 'cowork', 'state.json'), '{"from":"legacy"}');
  }

  it('prod: copies legacy .env and state.json into an empty home', () => {
    seedLegacy();

    migrateLegacyHomeInto('prod', home, legacyHome);

    expect(fs.readFileSync(path.join(home, '.env'), 'utf8')).toBe('ANTON_MINDS_URL=prod');
    expect(fs.readFileSync(path.join(home, 'state.json'), 'utf8')).toBe('{"from":"legacy"}');
  });

  it('prod: never overwrites files already present in the home', () => {
    seedLegacy();
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, '.env'), 'ANTON_MINDS_URL=current');

    migrateLegacyHomeInto('prod', home, legacyHome);

    expect(fs.readFileSync(path.join(home, '.env'), 'utf8')).toBe('ANTON_MINDS_URL=current');
    // The absent file is still filled in.
    expect(fs.existsSync(path.join(home, 'state.json'))).toBe(true);
  });

  it.each(['dev', 'preview', 'stable'] as const)(
    '%s: creates the home dir but copies NOTHING from the legacy home',
    (kind) => {
      seedLegacy();

      migrateLegacyHomeInto(kind, home, legacyHome);

      expect(fs.existsSync(home)).toBe(true); // dir still ensured for every kind
      expect(fs.existsSync(path.join(home, '.env'))).toBe(false);
      expect(fs.existsSync(path.join(home, 'state.json'))).toBe(false);
    },
  );

  it('prod with no legacy files: just ensures the home dir', () => {
    migrateLegacyHomeInto('prod', home, legacyHome);

    expect(fs.existsSync(home)).toBe(true);
    expect(fs.readdirSync(home)).toEqual([]);
  });
});
