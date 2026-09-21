import { describe, it, expect } from 'vitest';
import { resolveLoopbackToken } from './loopback-token';

const SECRET = 'install-owner-secret';

describe('resolveLoopbackToken', () => {
  it('prefers an explicitly pinned environment token', () => {
    expect(resolveLoopbackToken({
      processEnv: 'operator-pinned',
      dotenv: 'from-the-dotenv',
      ownerSecret: SECRET,
    })).toBe('operator-pinned');
  });

  it('takes the dotenv token when nothing is pinned', () => {
    // The adoptable-orphan case: a build that predates this generated its own
    // token and wrote it there, and that is the only value it will accept.
    expect(resolveLoopbackToken({
      dotenv: 'generated-by-an-older-build',
      ownerSecret: SECRET,
    })).toBe('generated-by-an-older-build');
  });

  it('derives a token from the owner secret when there is nothing to read', () => {
    const token = resolveLoopbackToken({ ownerSecret: SECRET });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives the same token in every process of one install', () => {
    // What lets the shell hand a sidecar a token without persisting it, and
    // still authenticate to a sidecar a previous launch left running.
    expect(resolveLoopbackToken({ ownerSecret: SECRET }))
      .toBe(resolveLoopbackToken({ ownerSecret: SECRET }));
  });

  it('never derives the owner secret itself', () => {
    // The owner secret is echoed at /health for adoption. A bearer token that
    // equalled it would be published to anything that can reach the port.
    expect(resolveLoopbackToken({ ownerSecret: SECRET })).not.toBe(SECRET);
  });

  it('derives a different token per install', () => {
    expect(resolveLoopbackToken({ ownerSecret: 'one' }))
      .not.toBe(resolveLoopbackToken({ ownerSecret: 'two' }));
  });

  it('ignores blank and quoted-empty sources', () => {
    const derived = resolveLoopbackToken({ ownerSecret: SECRET });
    expect(resolveLoopbackToken({ processEnv: '   ', dotenv: '""', ownerSecret: SECRET }))
      .toBe(derived);
  });

  it('strips the quotes and padding a dotenv line carries', () => {
    expect(resolveLoopbackToken({ dotenv: ' "quoted-token" ', ownerSecret: SECRET }))
      .toBe('quoted-token');
  });

});
