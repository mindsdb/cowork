import { describe, it, expect, vi, beforeEach } from 'vitest';

/** The OS keychain as keytar sees it: service -> account -> password. */
const os = vi.hoisted(() => ({ entries: new Map<string, Map<string, string>>(), fail: null as null | 'get' | 'set' | 'delete' | 'find' }));
function service(name: string): Map<string, string> {
  if (!os.entries.has(name)) os.entries.set(name, new Map());
  return os.entries.get(name)!;
}
vi.mock('keytar', () => ({
  default: {
    getPassword: async (svc: string, account: string) => {
      if (os.fail === 'get') throw new Error('locked');
      return service(svc).get(account) ?? null;
    },
    setPassword: async (svc: string, account: string, password: string) => {
      if (os.fail === 'set') throw new Error('locked');
      service(svc).set(account, password);
    },
    deletePassword: async (svc: string, account: string) => {
      if (os.fail === 'delete') throw new Error('locked');
      return service(svc).delete(account);
    },
    findCredentials: async (svc: string) => {
      if (os.fail === 'find') throw new Error('no secret service');
      return [...service(svc).entries()].map(([account, password]) => ({ account, password }));
    },
  },
}));
vi.mock('./cowork-home', () => ({ buildKind: () => 'dev' }));
const fallback = vi.hoisted(() => ({ getFallbackPassword: vi.fn(), setFallbackPassword: vi.fn(), deleteFallbackPassword: vi.fn() }));
vi.mock('./keychain-fallback', () => fallback);

import {
  checkKeychain, CustomMcpKeychainError, deleteConnection, listConnectionIds, readPart, writePart,
} from './custom-mcp-keychain';

const SERVICE = 'cowork-custom-mcp-dev';
const ROOT = '/home/user/.cowork';
const OTHER_ROOT = '/home/user/.cowork/orgs/acme';
const ID = `cm-${'0'.repeat(32)}`;
const OTHER_ID = `cm-${'1'.repeat(32)}`;

function accounts(): string[] {
  return [...service(SERVICE).keys()];
}

beforeEach(() => {
  os.entries.clear();
  os.fail = null;
  vi.clearAllMocks();
});

describe('custom MCP keychain entries', () => {
  it('reads back a short value and a value longer than one piece', async () => {
    const long = 'x'.repeat(2500);
    await writePart(ROOT, ID, 'settings', '{"a":1}');
    await writePart(ROOT, ID, 'tools', long);

    expect(await readPart(ROOT, ID, 'settings')).toBe('{"a":1}');
    expect(await readPart(ROOT, ID, 'tools')).toBe(long);
    // Three pieces of at most 1000 characters, under the Windows limit.
    const pieces = accounts().filter((account) => account.includes('|tools#'));
    expect(pieces).toHaveLength(3);
    expect(Math.max(...pieces.map((account) => service(SERVICE).get(account)!.length))).toBe(1000);
  });

  it('reads an empty value as empty, not as absent', async () => {
    await writePart(ROOT, ID, 'tools', '');
    expect(await readPart(ROOT, ID, 'tools')).toBe('');
  });

  it('reads a missing piece as unusable, never as a shorter value', async () => {
    await writePart(ROOT, ID, 'tools', 'y'.repeat(2500));
    service(SERVICE).delete(accounts().find((account) => account.endsWith('#2'))!);

    expect(await readPart(ROOT, ID, 'tools')).toBeNull();
  });

  it('reads pieces of another generation as unusable', async () => {
    await writePart(ROOT, ID, 'tools', 'first');
    const count = accounts().find((account) => account.endsWith('|tools'))!;
    const firstCount = service(SERVICE).get(count)!;
    await writePart(ROOT, ID, 'tools', 'second');
    // The count entry put back to the first generation, whose pieces are gone.
    service(SERVICE).set(count, firstCount);

    expect(await readPart(ROOT, ID, 'tools')).toBeNull();
  });

  it('removes the previous generation once a rewrite is complete', async () => {
    await writePart(ROOT, ID, 'tools', 'z'.repeat(2500));
    await writePart(ROOT, ID, 'tools', 'short');

    expect(accounts().filter((account) => account.includes('|tools#'))).toHaveLength(1);
    expect(await readPart(ROOT, ID, 'tools')).toBe('short');
  });

  it('keeps two store roots apart', async () => {
    await writePart(ROOT, ID, 'settings', 'mine');
    await writePart(OTHER_ROOT, ID, 'settings', 'theirs');

    expect(await readPart(ROOT, ID, 'settings')).toBe('mine');
    expect(await readPart(OTHER_ROOT, ID, 'settings')).toBe('theirs');
    expect(await listConnectionIds(ROOT)).toEqual([ID]);
  });

  it('deletes every entry of one connection and nothing of another', async () => {
    await writePart(ROOT, ID, 'settings', 's');
    await writePart(ROOT, ID, 'refresh', 'r'.repeat(1500));
    await writePart(ROOT, OTHER_ID, 'settings', 'other');
    await writePart(OTHER_ROOT, ID, 'settings', 'other root');

    await deleteConnection(ROOT, ID);

    expect(await listConnectionIds(ROOT)).toEqual([OTHER_ID]);
    expect(await readPart(OTHER_ROOT, ID, 'settings')).toBe('other root');
  });

  it.each(['get', 'set', 'find'] as const)('raises its own error when keytar fails to %s, never using the fallback file', async (step) => {
    await writePart(ROOT, ID, 'settings', 's');
    os.fail = step;

    const run = step === 'set' ? writePart(ROOT, ID, 'settings', 't') : step === 'get' ? readPart(ROOT, ID, 'settings') : checkKeychain();

    await expect(run).rejects.toBeInstanceOf(CustomMcpKeychainError);
    expect(fallback.getFallbackPassword).not.toHaveBeenCalled();
    expect(fallback.setFallbackPassword).not.toHaveBeenCalled();
  });

  it('reports a delete that fails', async () => {
    await writePart(ROOT, ID, 'settings', 's');
    os.fail = 'delete';

    await expect(deleteConnection(ROOT, ID)).rejects.toBeInstanceOf(CustomMcpKeychainError);
  });

  it('uses a service of its own per build kind', async () => {
    await writePart(ROOT, ID, 'settings', 's');
    expect([...os.entries.keys()]).toEqual([SERVICE]);
  });
});
