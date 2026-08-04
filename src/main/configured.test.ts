import { describe, it, expect } from 'vitest';
import { configuredFromEnv, resolveConfigured, type ConfiguredResult } from './configured';

describe('configuredFromEnv (.env fallback)', () => {
  it('reports the provider for whichever credential is present', () => {
    expect(configuredFromEnv({ ANTON_MINDS_API_KEY: 'mdb_x' })).toEqual({ configured: true, provider: 'minds_cloud' });
    expect(configuredFromEnv({ ANTON_ANTHROPIC_API_KEY: 'sk-a' })).toEqual({ configured: true, provider: 'anthropic' });
    expect(configuredFromEnv({ ANTON_OPENAI_API_KEY: 'sk-o' })).toEqual({ configured: true, provider: 'openai' });
  });

  it('is not configured when no credential is present', () => {
    expect(configuredFromEnv({})).toEqual({ configured: false, provider: '' });
    // ENG-1127 regression: consent alone must NOT count as configured, and its
    // absence must NOT matter — configured-ness is credentials/health only.
    expect(configuredFromEnv({ ANTON_TERMS_CONSENT: 'true' })).toEqual({ configured: false, provider: '' });
  });
});

describe('resolveConfigured (boot routing signal)', () => {
  const noEnv = () => ({});
  const unreachable = async () => null;

  it('defers to /health when the server is reachable and ignores .env', async () => {
    const health = async (): Promise<ConfiguredResult> => ({ configured: true, provider: 'minds_cloud' });
    await expect(resolveConfigured(health, noEnv)).resolves.toEqual({ configured: true, provider: 'minds_cloud' });
  });

  it('trusts a config_ready server even when .env has no ANTON_TERMS_CONSENT (ENG-1127 regression)', async () => {
    // The bug: the client stopped writing ANTON_TERMS_CONSENT and the server
    // never exported it, so the old .env consent gate returned configured:false
    // for a fully-ready install — bouncing a consented user back to auth on
    // relaunch. Consent now lives in the renderer boot layer; this signal must
    // reflect readiness only.
    const health = async (): Promise<ConfiguredResult> => ({ configured: true, provider: 'anthropic' });
    const envWithoutConsent = () => ({ ANTON_ANTHROPIC_API_KEY: 'sk-a' }); // no ANTON_TERMS_CONSENT
    await expect(resolveConfigured(health, envWithoutConsent)).resolves.toEqual({ configured: true, provider: 'anthropic' });
  });

  it('falls back to .env credentials when the server is unreachable — no consent gate', async () => {
    const envWithoutConsent = () => ({ ANTON_MINDS_API_KEY: 'mdb_x' });
    await expect(resolveConfigured(unreachable, envWithoutConsent)).resolves.toEqual({ configured: true, provider: 'minds_cloud' });
  });

  it('is not configured when the server is unreachable and .env is empty', async () => {
    await expect(resolveConfigured(unreachable, noEnv)).resolves.toEqual({ configured: false, provider: '' });
  });

  it('honors a reachable-but-not-ready server without falling through to .env', async () => {
    // Server up, config_ready:false (e.g. creds just cleared) is authoritative —
    // a leftover .env credential must not override it back to configured.
    const notReady = async (): Promise<ConfiguredResult> => ({ configured: false, provider: '' });
    const staleEnv = () => ({ ANTON_MINDS_API_KEY: 'mdb_stale' });
    await expect(resolveConfigured(notReady, staleEnv)).resolves.toEqual({ configured: false, provider: '' });
  });
});
