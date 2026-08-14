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
