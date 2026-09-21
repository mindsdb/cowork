import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  LOOPBACK_TOKEN_FILE,
  readOrCreateInstallToken,
  resetInstallTokenCache,
  resolveLoopbackToken,
} from './loopback-token';

const persisted = (value: string) => () => value;

describe('resolveLoopbackToken', () => {
  it('prefers an explicitly pinned environment token', () => {
    expect(resolveLoopbackToken({
      processEnv: 'operator-pinned',
      dotenv: 'from-the-dotenv',
      persisted: persisted('the-install-token'),
    })).toBe('operator-pinned');
  });

  it('takes the dotenv token when nothing is pinned', () => {
    // The adoptable-orphan case: a build that predates this generated its own
    // token and wrote it there, and that is the only value it will accept.
    expect(resolveLoopbackToken({
      dotenv: 'generated-by-an-older-build',
      persisted: persisted('the-install-token'),
    })).toBe('generated-by-an-older-build');
  });

  it('falls back to the install token when there is nothing to read', () => {
    expect(resolveLoopbackToken({ persisted: persisted('the-install-token') }))
      .toBe('the-install-token');
  });

  it('does not touch the install token when another source supplies one', () => {
    // The thunk writes a file on first use. An install that already has a token
    // to use must not create one it will never read.
    let calls = 0;
    resolveLoopbackToken({
      processEnv: 'operator-pinned',
      persisted: () => { calls += 1; return 'unused'; },
    });
    expect(calls).toBe(0);
  });

  it('ignores blank and quoted-empty sources', () => {
    expect(resolveLoopbackToken({
      processEnv: '   ',
      dotenv: '""',
      persisted: persisted('the-install-token'),
    })).toBe('the-install-token');
  });

  it('strips the quotes and padding a dotenv line carries', () => {
    expect(resolveLoopbackToken({
      dotenv: ' "quoted-token" ',
      persisted: persisted('the-install-token'),
    })).toBe('quoted-token');
  });
});

describe('readOrCreateInstallToken', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'loopback-token-'));
    resetInstallTokenCache();
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    resetInstallTokenCache();
  });

  it('creates a token and keeps returning the same one', () => {
    const token = readOrCreateInstallToken(home);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(readOrCreateInstallToken(home)).toBe(token);
  });

  it('reads the token a previous launch persisted', () => {
    const token = readOrCreateInstallToken(home);
    resetInstallTokenCache();
    expect(readOrCreateInstallToken(home)).toBe(token);
  });

  it('writes it owner-only', () => {
    // Another OS user reading this file could authenticate to the sidecar.
    readOrCreateInstallToken(home);
    const mode = fs.statSync(path.join(home, LOOPBACK_TOKEN_FILE)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('is random, not derived from anything the server publishes', () => {
    // The security boundary. /health echoes the server-owner value
    // unauthenticated, and for a session on the default root that value IS the
    // install's owner secret — so a bearer derived from it can be recomputed by
    // any local OS user, and loopback binding is not an OS-user boundary.
    // Two installs must not be able to produce each other's token.
    const first = readOrCreateInstallToken(home);
    resetInstallTokenCache();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'loopback-token-'));
    try {
      expect(readOrCreateInstallToken(other)).not.toBe(first);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('is not an HMAC of the owner secret under any label the shell publishes', () => {
    // Pins the exact regression: the first cut of this change derived the
    // bearer as HMAC-SHA256(ownerSecret, 'cowork-loopback-auth'), and
    // accountOwnerToken returns that secret verbatim for a default-root
    // session, which /health then publishes.
    const ownerSecret = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(home, '.server_owner'), ownerSecret + '\n');
    const token = readOrCreateInstallToken(home);
    for (const label of ['cowork-loopback-auth', 'cowork-auth', '']) {
      expect(token).not.toBe(
        crypto.createHmac('sha256', ownerSecret).update(label).digest('hex'),
      );
    }
    expect(token).not.toBe(ownerSecret);
  });

  it('still yields a usable token when the home cannot be written', () => {
    // The sidecar is handed this same value at spawn, so the session works; it
    // just will not survive the process, and the next launch replaces that
    // sidecar rather than adopting it.
    const unwritable = path.join(home, 'file-not-a-dir', 'home');
    fs.writeFileSync(path.join(home, 'file-not-a-dir'), 'x');
    expect(readOrCreateInstallToken(unwritable)).toMatch(/^[0-9a-f]{64}$/);
  });
});
