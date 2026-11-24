import { afterEach, describe, expect, it, vi } from 'vitest';

const customMcpDisconnect = vi.hoisted(() => vi.fn());
vi.mock('../../platform/host', () => ({ host: { customMcpDisconnect } }));

import { disconnectCustomMcp } from './customMcp';

const ID = `cm-${'a'.repeat(32)}`;

afterEach(() => {
  customMcpDisconnect.mockReset();
});

describe('disconnectCustomMcp', () => {
  it('removes a connection through main, without the generic delete', async () => {
    customMcpDisconnect.mockResolvedValue({ ok: true, revoked: true });
    const genericDelete = vi.fn();

    await disconnectCustomMcp(ID, genericDelete);

    expect(customMcpDisconnect).toHaveBeenCalledWith(ID);
    expect(genericDelete).not.toHaveBeenCalled();
  });

  it.each(['custom_mcp-foo', 'foo', `cm-${'A'.repeat(32)}`])(
    'removes a record named %s, which main never drew, with the generic delete',
    async (name) => {
      const genericDelete = vi.fn(async () => undefined);

      await disconnectCustomMcp(name, genericDelete);

      expect(genericDelete).toHaveBeenCalledTimes(1);
      expect(customMcpDisconnect).not.toHaveBeenCalled();
    },
  );

  it('falls back to the generic delete while main offers no custom MCP', async () => {
    customMcpDisconnect.mockResolvedValue({ ok: false, code: 'unavailable', reason: 'not available' });
    const genericDelete = vi.fn(async () => undefined);

    await disconnectCustomMcp(ID, genericDelete);

    expect(genericDelete).toHaveBeenCalledTimes(1);
  });

  it('reports main\'s reason when it refuses for anything else, and deletes nothing', async () => {
    customMcpDisconnect.mockResolvedValue({ ok: false, code: 'keychain_unavailable', reason: 'the keychain could not delete an entry' });
    const genericDelete = vi.fn();

    await expect(disconnectCustomMcp(ID, genericDelete)).rejects.toThrow('the keychain could not delete an entry');
    expect(genericDelete).not.toHaveBeenCalled();
  });
});
