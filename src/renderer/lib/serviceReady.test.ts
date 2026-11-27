import { describe, expect, it } from 'vitest';
import { checkServiceReady } from './serviceReady';

describe('checkServiceReady docsEnabled', () => {
  it.each([true, false])('passes docsEnabled=%s through', async (value) => {
    const ready = await checkServiceReady(async () => ({ configured: true, provider: '', orgMode: true, docsEnabled: value }));
    expect(ready).toMatchObject({ state: 'ready', orgMode: true, docsEnabled: value });
  });

  it('leaves docsEnabled unset when the server does not report it', async () => {
    const ready = await checkServiceReady(async () => ({ configured: true, provider: '', orgMode: true }));
    expect(ready.docsEnabled).toBeUndefined();
  });

  it('leaves docsEnabled unset when /health cannot be read', async () => {
    const ready = await checkServiceReady(async () => {
      throw new Error('offline');
    });
    expect(ready).toMatchObject({ state: 'unavailable', orgMode: null });
    expect(ready.docsEnabled).toBeUndefined();
  });
});
