import { describe, it, expect, vi, beforeEach } from 'vitest';

// Check module-load service naming: prod must retain cowork-oauth for existing tokens; non-prod
// channels must isolate theirs.

const keytar = {
  getPassword: vi.fn().mockResolvedValue(null),
  setPassword: vi.fn().mockResolvedValue(undefined),
  deletePassword: vi.fn().mockResolvedValue(undefined),
};
vi.mock('keytar', () => ({ default: keytar }));

const buildKindMock = vi.fn();
vi.mock('./cowork-home', () => ({ buildKind: () => buildKindMock() }));

// Mock the separately tested file store so these tests verify service/account routing without
// filesystem or Electron access.
const fallback = {
  getFallbackPassword: vi.fn().mockReturnValue(null),
  setFallbackPassword: vi.fn(),
  deleteFallbackPassword: vi.fn(),
};
vi.mock('./keychain-fallback', () => fallback);

async function loadForKind(kind: string) {
  buildKindMock.mockReturnValue(kind);
  vi.resetModules(); // SERVICE_NAME is fixed at load, so re-import per kind
  return import('./keychain-service');
}

describe('keychain-service — per-channel service namespacing', () => {
  beforeEach(() => {
    keytar.getPassword.mockClear();
    keytar.setPassword.mockClear();
    keytar.deletePassword.mockClear();
    keytar.getPassword.mockResolvedValue(null);
    keytar.setPassword.mockResolvedValue(undefined);
    keytar.deletePassword.mockResolvedValue(undefined);
    fallback.getFallbackPassword.mockClear().mockReturnValue(null);
    fallback.setFallbackPassword.mockClear();
    fallback.deleteFallbackPassword.mockClear();
  });

  it('prod: keeps the historical unnamespaced "cowork-oauth" service', async () => {
    const svc = await loadForKind('prod');
    await svc.getRefreshToken('gmail', 'a@b.com');
    expect(keytar.getPassword).toHaveBeenCalledWith('cowork-oauth', 'gmail:a@b.com');
  });

  it.each(['dev', 'preview', 'stable'])(
    'non-prod %s: namespaces the service as cowork-oauth-<kind>',
    async (kind) => {
      const svc = await loadForKind(kind);
      await svc.setRefreshToken('gmail', 'a@b.com', 'tok');
      expect(keytar.setPassword).toHaveBeenCalledWith(`cowork-oauth-${kind}`, 'gmail:a@b.com', 'tok');
    },
  );

  it('delete routes through the same namespaced service', async () => {
    const svc = await loadForKind('preview');
    await svc.deleteRefreshToken('slack', 'x@y.com');
    expect(keytar.deletePassword).toHaveBeenCalledWith('cowork-oauth-preview', 'slack:x@y.com');
  });
});

// keytar throws when the secure-store backend is unavailable; exercise file fallback for tokens and
// static credentials alike.
describe('keychain-service — file fallback when keytar is unavailable', () => {
  beforeEach(() => {
    // Restore default implementations: mockClear only clears call history and would retain prior
    // rejected values.
    keytar.getPassword.mockClear().mockResolvedValue(null);
    keytar.setPassword.mockClear().mockResolvedValue(undefined);
    keytar.deletePassword.mockClear().mockResolvedValue(undefined);
    fallback.getFallbackPassword.mockClear().mockReturnValue(null);
    fallback.setFallbackPassword.mockClear();
    fallback.deleteFallbackPassword.mockClear();
  });

  it('getRefreshToken reads from the fallback when keytar.getPassword throws', async () => {
    keytar.getPassword.mockRejectedValue(new Error('no Secret Service provider'));
    fallback.getFallbackPassword.mockReturnValue('fallback-token');
    const svc = await loadForKind('prod');
    await expect(svc.getRefreshToken('gmail', 'a@b.com')).resolves.toBe('fallback-token');
    expect(fallback.getFallbackPassword).toHaveBeenCalledWith('cowork-oauth', 'gmail:a@b.com');
  });

  it('getRefreshToken checks the fallback when keytar succeeds but finds nothing', async () => {
    // After keytar recovers with null, it must still find a token saved to the fallback during the
    // outage.
    keytar.getPassword.mockResolvedValue(null);
    fallback.getFallbackPassword.mockReturnValue('written-during-outage');
    const svc = await loadForKind('prod');
    await expect(svc.getRefreshToken('gmail', 'a@b.com')).resolves.toBe('written-during-outage');
  });

  it('setRefreshToken writes to the fallback when keytar.setPassword throws', async () => {
    keytar.setPassword.mockRejectedValue(new Error('no Secret Service provider'));
    const svc = await loadForKind('prod');
    await svc.setRefreshToken('gmail', 'a@b.com', 'tok');
    expect(fallback.setFallbackPassword).toHaveBeenCalledWith('cowork-oauth', 'gmail:a@b.com', 'tok');
  });

  it('setRefreshToken clears a stale fallback entry once a real keytar write succeeds', async () => {
    const svc = await loadForKind('prod');
    await svc.setRefreshToken('gmail', 'a@b.com', 'tok');
    expect(fallback.deleteFallbackPassword).toHaveBeenCalledWith('cowork-oauth', 'gmail:a@b.com');
    expect(fallback.setFallbackPassword).not.toHaveBeenCalled();
  });

  it('deleteRefreshToken clears the fallback even when keytar.deletePassword throws', async () => {
    keytar.deletePassword.mockRejectedValue(new Error('no Secret Service provider'));
    const svc = await loadForKind('prod');
    await expect(svc.deleteRefreshToken('gmail', 'a@b.com')).resolves.toBeUndefined();
    expect(fallback.deleteFallbackPassword).toHaveBeenCalledWith('cowork-oauth', 'gmail:a@b.com');
  });

  it('the ENG-1241 static-credential exports share the same fallback plumbing', async () => {
    keytar.getPassword.mockRejectedValue(new Error('no Secret Service provider'));
    fallback.getFallbackPassword.mockReturnValue('client-secret-value');
    const svc = await loadForKind('prod');
    await expect(svc.getStaticCredential('GITHUB_CLIENT_SECRET')).resolves.toBe('client-secret-value');
    expect(fallback.getFallbackPassword).toHaveBeenCalledWith('cowork-oauth', 'GITHUB_CLIENT_SECRET');
  });

  it('getGenerationMarker falls back the same way as any other entry', async () => {
    keytar.getPassword.mockRejectedValue(new Error('no Secret Service provider'));
    fallback.getFallbackPassword.mockReturnValue('generation-hash');
    const svc = await loadForKind('prod');
    await expect(svc.getGenerationMarker()).resolves.toBe('generation-hash');
    expect(fallback.getFallbackPassword).toHaveBeenCalledWith('cowork-oauth', '__generation__');
  });
});
