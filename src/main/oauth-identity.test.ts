import { describe, it, expect, vi } from 'vitest';

import { fetchAccountEmail } from './oauth-identity';

describe('fetchAccountEmail — PostHog US/EU region fallback', () => {
  it('uses the US host when it succeeds', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url.toString();
      expect(href).toBe('https://us.posthog.com/api/users/@me/');
      return new Response(JSON.stringify({ email: 'us-user@example.com' }), { status: 200 });
    }) as unknown as typeof fetch;

    expect(await fetchAccountEmail('posthog', 'tok')).toBe('us-user@example.com');
  });

  it('falls back to the EU host when the US host rejects the token', async () => {
    const calledHosts: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url.toString();
      calledHosts.push(href);
      if (href.startsWith('https://us.posthog.com')) {
        return new Response('', { status: 401 });
      }
      return new Response(JSON.stringify({ email: 'eu-user@example.com' }), { status: 200 });
    }) as unknown as typeof fetch;

    expect(await fetchAccountEmail('posthog', 'tok')).toBe('eu-user@example.com');
    expect(calledHosts).toEqual([
      'https://us.posthog.com/api/users/@me/',
      'https://eu.posthog.com/api/users/@me/',
    ]);
  });

  it('returns an empty string when both regional hosts fail', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;

    expect(await fetchAccountEmail('posthog', 'tok')).toBe('');
  });
});
