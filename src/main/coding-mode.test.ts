import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./server-process', () => ({
  getServerPort: () => 26866,
}));
vi.mock('./server-auth', () => ({
  authHeader: () => ({}),
}));

const findOnPathMock = vi.hoisted(() => vi.fn());
vi.mock('./uv-paths', () => ({
  findOnPath: findOnPathMock,
}));

import { detectClaudeCode, revealMindsApiKey } from './coding-mode';

describe('detectClaudeCode', () => {
  beforeEach(() => findOnPathMock.mockReset());

  it('reports installed with the resolved path when found', async () => {
    findOnPathMock.mockResolvedValue('/usr/local/bin/claude');
    await expect(detectClaudeCode()).resolves.toEqual({
      installed: true,
      path: '/usr/local/bin/claude',
    });
  });

  it('reports not installed when absent from PATH', async () => {
    findOnPathMock.mockResolvedValue(null);
    await expect(detectClaudeCode()).resolves.toEqual({ installed: false, path: null });
  });
});

describe('revealMindsApiKey', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('returns the key when the server has one set', async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ value: 'mdb_test_token' }) });
    await expect(revealMindsApiKey()).resolves.toBe('mdb_test_token');
  });

  it('returns null when the server has no key set', async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ value: '' }) });
    await expect(revealMindsApiKey()).resolves.toBeNull();
  });

  it('returns null when the request fails', async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: false });
    await expect(revealMindsApiKey()).resolves.toBeNull();
  });

  it('returns null when the request throws (server unreachable)', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(revealMindsApiKey()).resolves.toBeNull();
  });
});
