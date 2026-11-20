// On web there is no main process: custom MCP is never offered, and every
// call answers a refusal instead of reaching for a bridge that isn't there.

import { describe, expect, it } from 'vitest';
import { host, isWeb } from './host';

describe('custom MCP on web', () => {
  it('is never available', async () => {
    expect(isWeb).toBe(true);
    expect(await host.customMcpAvailable()).toBe(false);
  });

  it.each([
    ['connect', () => host.customMcpConnect({ label: 'T', url: 'https://mcp.example.com/mcp' })],
    ['summary', () => host.customMcpSummary('cm-1')],
    ['tools', () => host.customMcpTools('cm-1')],
    ['set tools', () => host.customMcpSetTools('cm-1', [])],
    ['reconnect', () => host.customMcpReconnect('cm-1')],
    ['disconnect', () => host.customMcpDisconnect('cm-1')],
  ])('refuses %s as unavailable', async (_name, call) => {
    expect(await call()).toMatchObject({ ok: false, code: 'unavailable' });
  });
});
