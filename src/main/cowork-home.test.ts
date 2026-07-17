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

const appState = { isPackaged: true };
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged;
    },
    getPath: () => '',
  },
}));

import { buildKindStrict } from './cowork-home';

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
