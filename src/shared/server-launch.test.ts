import * as path from 'path';
import { describe, expect, it } from 'vitest';

import {
  DEV_PROXY_AUTH_TOKEN_ENV,
  DEV_PROXY_WINDOW_PROOF_ENV,
  HANDOFF_PROTOCOL,
  launchStdinLine,
  STDIN_FLAG,
  WINDOW_PROOF_HEADER,
} from './server-launch';

/*
 * The launch contract cowork-server's cowork/app_secret.py mirrors. A change
 * to any value here is a protocol change both sides make together, so each
 * value is pinned literally.
 */

const HANDOFF = { appSecret: 'a1'.repeat(32), authToken: 'b2'.repeat(32), windowProof: 'c3'.repeat(32) };

describe('the server launch contract', () => {
  it('names the stdin flag, the protocol its value and /health carry, and the proof header', () => {
    expect(STDIN_FLAG).toBe('COWORK_APP_SECRET_STDIN');
    expect(HANDOFF_PROTOCOL).toBe(2);
    expect(WINDOW_PROOF_HEADER).toBe('X-Cowork-Window-Proof');
  });

  it('writes the hand-off as one JSON line with exactly the three keys the server reads', () => {
    const line = launchStdinLine(HANDOFF);

    expect(line).toBe(`{"app_secret":"${'a1'.repeat(32)}","auth_token":"${'b2'.repeat(32)}","window_proof":"${'c3'.repeat(32)}"}\n`);
    expect(line.indexOf('\n')).toBe(line.length - 1);
  });

  it("stays well under the 4096 bytes cowork-server's readline reads, even at the longest values it accepts", () => {
    const longest = { appSecret: 'a'.repeat(128), authToken: 'b'.repeat(128), windowProof: 'c'.repeat(128) };

    expect(Buffer.byteLength(launchStdinLine(longest))).toBeLessThan(4096);
  });

  it("keeps Vite's proxy variables out of the VITE_ prefix, which Vite copies into the client bundle", () => {
    for (const name of [DEV_PROXY_AUTH_TOKEN_ENV, DEV_PROXY_WINDOW_PROOF_ENV]) {
      expect(name.startsWith('VITE_')).toBe(false);
    }
  });
});

describe("scripts/start-server.mjs's copy of the contract", () => {
  it('holds the same values and writes the same line', async () => {
    const script = await import(/* @vite-ignore */ path.resolve('scripts/start-server.mjs'));

    expect(script.STDIN_FLAG).toBe(STDIN_FLAG);
    expect(script.HANDOFF_PROTOCOL).toBe(HANDOFF_PROTOCOL);
    expect(script.DEV_PROXY_AUTH_TOKEN_ENV).toBe(DEV_PROXY_AUTH_TOKEN_ENV);
    expect(script.DEV_PROXY_WINDOW_PROOF_ENV).toBe(DEV_PROXY_WINDOW_PROOF_ENV);
    expect(script.launchStdinLine(HANDOFF)).toBe(launchStdinLine(HANDOFF));
  });
});
