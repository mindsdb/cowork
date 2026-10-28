import { describe, it, expect, vi } from 'vitest';
import {
  decideConfigured,
  probeServerReadiness,
  type ServerAnswer,
  type ServerReadiness,
  type SidecarProbe,
} from './boot-configured';

const SIGNED_IN = { ANTON_MINDS_ENABLED: 'true' };

const READY: ServerAnswer = { configured: true, provider: 'minds_cloud', mindsRuntimeCredentialRequired: true };

function probe(overrides: Partial<SidecarProbe> = {}): SidecarProbe {
  return {
    isRunning: () => true,
    isStarting: () => false,
    isOnCurrentStores: () => true,
    moveToCurrentRoot: vi.fn(async () => true),
    readHealth: vi.fn(async () => READY),
    ...overrides,
  };
}

function inputs(env: Record<string, string>, server: ServerReadiness, signOut = false, credential = false) {
  return {
    env: { ANTON_TERMS_CONSENT: 'true', ...env },
    signOutRoutingActive: () => signOut,
    readServer: vi.fn(async () => server),
    hasMindsCredential: vi.fn(async () => credential),
  };
}

describe('probeServerReadiness', () => {
  it('returns the /health answer from a sidecar on the current account', async () => {
    expect(await probeServerReadiness(probe())).toEqual({ kind: 'answered', answer: READY });
  });

  it('is unreachable when nothing is running', async () => {
    const p = probe({ isRunning: () => false });
    expect(await probeServerReadiness(p)).toEqual({ kind: 'unreachable' });
    expect(p.readHealth).not.toHaveBeenCalled();
  });

  it('is unreachable, not another account, while a start is in flight', async () => {
    const p = probe({ isStarting: () => true, isOnCurrentStores: () => false });
    expect(await probeServerReadiness(p)).toEqual({ kind: 'unreachable' });
    expect(p.moveToCurrentRoot).not.toHaveBeenCalled();
  });

  it('is unreachable when /health does not answer', async () => {
    expect(await probeServerReadiness(probe({ readHealth: async () => null }))).toEqual({ kind: 'unreachable' });
  });

  it('moves a sidecar off another account root before reading it', async () => {
    const p = probe({ isOnCurrentStores: () => false });
    expect(await probeServerReadiness(p)).toEqual({ kind: 'answered', answer: READY });
    expect(p.moveToCurrentRoot).toHaveBeenCalledOnce();
  });

  it('reports another account when the move fails', async () => {
    const p = probe({ isOnCurrentStores: () => false, moveToCurrentRoot: async () => false });
    expect(await probeServerReadiness(p)).toEqual({ kind: 'other-account' });
    expect(p.readHealth).not.toHaveBeenCalled();
  });

  it('reports another account when the move throws', async () => {
    const p = probe({
      isOnCurrentStores: () => false,
      moveToCurrentRoot: async () => { throw new Error('stop failed'); },
    });
    expect(await probeServerReadiness(p)).toEqual({ kind: 'other-account' });
  });
});

describe('decideConfigured', () => {
  it('is not configured without terms consent, and never reads the server', async () => {
    const i = inputs({ ANTON_TERMS_CONSENT: '' }, { kind: 'answered', answer: READY });
    expect(await decideConfigured(i)).toEqual({ configured: false, provider: '' });
    expect(i.readServer).not.toHaveBeenCalled();
  });

  it('is not configured while a sign-out is routing, and never reads the server', async () => {
    const i = inputs({}, { kind: 'answered', answer: READY }, true);
    expect(await decideConfigured(i)).toEqual({ configured: false, provider: '' });
    expect(i.readServer).not.toHaveBeenCalled();
  });

  it('defers to the server answer, even over an .env key', async () => {
    const notReady = { ...READY, configured: false, provider: '' };
    const i = inputs({ ANTON_ANTHROPIC_API_KEY: 'k' }, { kind: 'answered', answer: notReady });
    expect(await decideConfigured(i)).toEqual(notReady);
  });

  it.each([
    ['ANTON_MINDS_API_KEY', 'minds_cloud'],
    ['ANTON_ANTHROPIC_API_KEY', 'anthropic'],
    ['ANTON_OPENAI_API_KEY', 'openai'],
  ])('falls back to an .env %s when the server is unreachable', async (key, provider) => {
    expect(await decideConfigured(inputs({ [key]: 'k' }, { kind: 'unreachable' })))
      .toEqual({ configured: true, provider });
  });

  it('falls back to an .env key when the sidecar is on another account', async () => {
    expect(await decideConfigured(inputs({ ANTON_OPENAI_API_KEY: 'k' }, { kind: 'other-account' })))
      .toEqual({ configured: true, provider: 'openai' });
  });

  it('keeps a signed-in MindsHub user in the app when the sidecar is unreachable', async () => {
    expect(await decideConfigured(inputs(SIGNED_IN, { kind: 'unreachable' }, false, true)))
      .toEqual({ configured: true, provider: 'minds_cloud' });
  });

  it('sends a sign-in that never committed back to sign-in, even with a token', async () => {
    const i = inputs({}, { kind: 'unreachable' }, false, true);
    expect(await decideConfigured(i)).toEqual({ configured: false, provider: '' });
    expect(i.hasMindsCredential).not.toHaveBeenCalled();
  });

  it('does not route into the app on a credential when the sidecar is on another account', async () => {
    const i = inputs(SIGNED_IN, { kind: 'other-account' }, false, true);
    expect(await decideConfigured(i)).toEqual({ configured: false, provider: '' });
    expect(i.hasMindsCredential).not.toHaveBeenCalled();
  });

  it('is not configured when the sidecar is unreachable and no credential or .env key exists', async () => {
    expect(await decideConfigured(inputs(SIGNED_IN, { kind: 'unreachable' })))
      .toEqual({ configured: false, provider: '' });
  });

  it('looks up the credential only when the sidecar is unreachable', async () => {
    const i = inputs(SIGNED_IN, { kind: 'answered', answer: READY }, false, true);
    await decideConfigured(i);
    expect(i.hasMindsCredential).not.toHaveBeenCalled();
  });

  it.each([
    ['missing consent', { ...SIGNED_IN, ANTON_TERMS_CONSENT: '' }, false],
    ['an active sign-out', SIGNED_IN, true],
  ])('is not configured on %s, even with a credential', async (_label, env, signOut) => {
    const i = inputs(env, { kind: 'unreachable' }, signOut, true);
    expect(await decideConfigured(i)).toEqual({ configured: false, provider: '' });
    expect(i.hasMindsCredential).not.toHaveBeenCalled();
  });

  it('is not configured with no server answer and no .env key', async () => {
    expect(await decideConfigured(inputs({}, { kind: 'other-account' })))
      .toEqual({ configured: false, provider: '' });
  });
});
