import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// credential-provisioning pulls in keychain-service, which imports the
// native `keytar` module at load time (see token-refresh.test.ts) — mocked
// here so these tests never touch a real OS keychain.
vi.mock('./keychain-service', () => ({
  getStaticCredential: vi.fn(),
  setStaticCredential: vi.fn(),
  getGenerationMarker: vi.fn(),
  setGenerationMarker: vi.fn(),
}));
vi.mock('fs');

import {
  computeGeneration,
  getCandidateStagingPaths,
  provisionCredentialsFromStaging,
  loadStaticCredentials,
  loadBundledServerCredentials,
  STATIC_CREDENTIAL_KEYS,
} from './credential-provisioning';
import {
  getStaticCredential,
  setStaticCredential,
  getGenerationMarker,
  setGenerationMarker,
} from './keychain-service';

const originalPlatform = process.platform;
function setPlatform(value: string) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

const SAMPLE: Record<string, string> = Object.fromEntries(
  STATIC_CREDENTIAL_KEYS.map((key, i) => [key, `value-${i}`]),
);

describe('computeGeneration', () => {
  it('is stable regardless of key order in the input object', () => {
    const shuffled = Object.fromEntries(Object.entries(SAMPLE).reverse());
    expect(computeGeneration(SAMPLE)).toBe(computeGeneration(shuffled));
  });

  it('changes when any single value changes', () => {
    const changed = { ...SAMPLE, GITHUB_CLIENT_SECRET: 'different' };
    expect(computeGeneration(SAMPLE)).not.toBe(computeGeneration(changed));
  });

  it('treats a missing key the same as an empty string', () => {
    const { GITHUB_CLIENT_SECRET, ...withoutOne } = SAMPLE;
    void GITHUB_CLIENT_SECRET;
    expect(computeGeneration(withoutOne)).toBe(computeGeneration({ ...withoutOne, GITHUB_CLIENT_SECRET: '' }));
  });

  it('is a 64-character hex sha256 digest', () => {
    expect(computeGeneration(SAMPLE)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('getCandidateStagingPaths', () => {
  const originalResourcesPath = process.resourcesPath;
  afterEach(() => {
    setPlatform(originalPlatform);
    Object.defineProperty(process, 'resourcesPath', { value: originalResourcesPath, configurable: true });
  });

  it('returns the two macOS locations, user path first', () => {
    setPlatform('darwin');
    const paths = getCandidateStagingPaths();
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('.cowork-provision/server-credentials.json');
    expect(paths[1]).toBe('/Library/Application Support/MindsHub Cowork/.provision/server-credentials.json');
  });

  it('returns a single resourcesPath-based location on Windows', () => {
    setPlatform('win32');
    Object.defineProperty(process, 'resourcesPath', { value: 'C:\\App\\resources', configurable: true });
    const paths = getCandidateStagingPaths();
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('server-credentials.json');
  });
});

describe('provisionCredentialsFromStaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('darwin');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(getGenerationMarker).mockResolvedValue(null);
    vi.mocked(setStaticCredential).mockResolvedValue(undefined);
    vi.mocked(setGenerationMarker).mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    setPlatform(originalPlatform);
    vi.restoreAllMocks();
  });

  it('does nothing when no staging file exists at either macOS location', async () => {
    await provisionCredentialsFromStaging();
    expect(setStaticCredential).not.toHaveBeenCalled();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('writes all 15 values and updates the marker when the generation is new', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('.cowork-provision'));
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(SAMPLE) as never);

    await provisionCredentialsFromStaging();

    expect(setStaticCredential).toHaveBeenCalledTimes(STATIC_CREDENTIAL_KEYS.length);
    for (const key of STATIC_CREDENTIAL_KEYS) {
      expect(setStaticCredential).toHaveBeenCalledWith(key, SAMPLE[key]);
    }
    expect(setGenerationMarker).toHaveBeenCalledWith(computeGeneration(SAMPLE));
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
  });

  it('skips writing but still deletes the file when the generation already matches', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('.cowork-provision'));
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(SAMPLE) as never);
    vi.mocked(getGenerationMarker).mockResolvedValue(computeGeneration(SAMPLE));

    await provisionCredentialsFromStaging();

    expect(setStaticCredential).not.toHaveBeenCalled();
    expect(setGenerationMarker).not.toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
  });

  it('leaves the file in place and does not update the marker if any write fails', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('.cowork-provision'));
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(SAMPLE) as never);
    vi.mocked(setStaticCredential).mockImplementation((key) =>
      key === 'GITHUB_CLIENT_SECRET' ? Promise.reject(new Error('keychain busy')) : Promise.resolve(),
    );

    await provisionCredentialsFromStaging();

    expect(setGenerationMarker).not.toHaveBeenCalled();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('leaves the file in place and never throws on invalid JSON', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('.cowork-provision'));
    vi.mocked(fs.readFileSync).mockReturnValue('not valid json' as never);

    await expect(provisionCredentialsFromStaging()).resolves.toBeUndefined();
    expect(setStaticCredential).not.toHaveBeenCalled();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('never throws when the secure store read/write itself fails', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('.cowork-provision'));
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(SAMPLE) as never);
    vi.mocked(getGenerationMarker).mockRejectedValue(new Error('keychain locked'));

    await expect(provisionCredentialsFromStaging()).resolves.toBeUndefined();
    expect(setStaticCredential).not.toHaveBeenCalled();
  });

  it('falls back to the shared Application Support path when the user path is absent', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('Application Support'));
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(SAMPLE) as never);

    await provisionCredentialsFromStaging();

    expect(setStaticCredential).toHaveBeenCalledTimes(STATIC_CREDENTIAL_KEYS.length);
  });
});

describe('loadStaticCredentials', () => {
  afterEach(() => vi.restoreAllMocks());

  it('omits keys that were never provisioned', async () => {
    vi.mocked(getStaticCredential).mockResolvedValue(null);
    const result = await loadStaticCredentials();
    expect(result).toEqual({});
  });

  it('includes keys that resolve to a value', async () => {
    vi.mocked(getStaticCredential).mockImplementation(async (key) => SAMPLE[key] ?? null);
    const result = await loadStaticCredentials();
    expect(result).toEqual(SAMPLE);
  });

  it('omits a key whose read throws, rather than failing the whole load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getStaticCredential).mockImplementation(async (key) =>
      key === 'GITHUB_CLIENT_SECRET' ? Promise.reject(new Error('boom')) : (SAMPLE[key] ?? null),
    );
    const result = await loadStaticCredentials();
    expect(result.GITHUB_CLIENT_SECRET).toBeUndefined();
    expect(result.GITHUB_CLIENT_ID).toBe(SAMPLE.GITHUB_CLIENT_ID);
  });
});

describe('loadBundledServerCredentials', () => {
  beforeEach(() => {
    setPlatform('darwin');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    setPlatform(originalPlatform);
    vi.restoreAllMocks();
  });

  it('still returns stored credentials even if provisioning throws unexpectedly', async () => {
    vi.mocked(fs.existsSync).mockImplementation(() => {
      throw new Error('unexpected fs error');
    });
    vi.mocked(getStaticCredential).mockImplementation(async (key) => SAMPLE[key] ?? null);

    const result = await loadBundledServerCredentials();
    expect(result).toEqual(SAMPLE);
  });
});
