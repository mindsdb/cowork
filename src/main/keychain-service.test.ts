import { describe, it, expect, vi, beforeEach } from 'vitest';

// keychain-service computes SERVICE_NAME at MODULE LOAD from buildKind(): prod
// keeps the historical unnamespaced 'cowork-oauth' (existing users' refresh
// tokens live there — changing it would orphan them), and every non-prod kind
// gets 'cowork-oauth-<kind>' so build kinds on one machine can't share tokens.
// That prod-vs-non-prod ternary is a safety-critical branch with no other test,
// so pin it directly: a flipped condition would either orphan prod tokens or
// leak tokens across channels.

const keytar = {
  getPassword: vi.fn().mockResolvedValue(null),
  setPassword: vi.fn().mockResolvedValue(undefined),
  deletePassword: vi.fn().mockResolvedValue(undefined),
};
vi.mock('keytar', () => ({ default: keytar }));

const buildKindMock = vi.fn();
vi.mock('./cowork-home', () => ({ buildKind: () => buildKindMock() }));

// keychain-fallback.ts has its own dedicated test file (keychain-fallback.test.ts)
// covering the real file-store behavior. Here it's mocked so these tests exercise
// only keychain-service's routing logic — whether it reaches for the fallback and
// with which (service, account) — without touching the filesystem or requiring a
// real `electron` module in this node-env test.
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

// keytar throws (rather than returning null) when the OS secure-store
// backend itself is unreachable — most commonly a Linux desktop with no
// Secret Service provider running. These pin the file-fallback behavior
// that covers that case for every export, refresh tokens and the ENG-1241
// static credentials/generation marker alike, since they all share the
// same getPassword/setPassword/deletePassword seam.
describe('keychain-service — file fallback when keytar is unavailable', () => {
  beforeEach(() => {
    // mockClear() alone would leave a mockRejectedValue set by a prior test
    // in place (it only clears call history, not the implementation), so
    // each mock's default resolution is restated explicitly here too.
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
    // Covers continuity across an outage: a token written to the fallback
    // while keytar was throwing must still be found once keytar recovers
    // and starts answering (with null, since it never received the write).
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
