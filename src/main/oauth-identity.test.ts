import { describe, it, expect, vi } from 'vitest';

import { fetchAccountEmail, fetchAccountIdentity, buildRevokeRequest } from './oauth-identity';

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
      if (new URL(href).host === 'us.posthog.com') {
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

describe('buildRevokeRequest', () => {
  it('builds the generic RFC-7009 form-encoded shape by default', () => {
    const req = buildRevokeRequest('linear', 'refresh-tok', 'cid', 'secret');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(req.body).get('token')).toBe('refresh-tok');
  });

  it('builds a JSON body with client credentials for Supabase', () => {
    const req = buildRevokeRequest('supabase', 'refresh-tok', 'cid', 'secret');
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(req.body)).toEqual({
      client_id: 'cid',
      client_secret: 'secret',
      refresh_token: 'refresh-tok',
    });
  });
});

describe('fetchAccountIdentity — Supabase organization-scoped grants', () => {
  it('falls back to projects when organization listing is forbidden', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.endsWith('/organizations')) return new Response('forbidden', { status: 403 });
      return new Response(JSON.stringify([
        { id: 'project-1', organization_slug: 'company-org', organization_name: 'Company' },
      ]), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(fetchAccountIdentity('supabase', 'tok')).resolves.toMatchObject({
      email: 'org:company-org',
      name: 'Company',
    });
  });
});


describe('fetchAccountEmail — Supabase organization fallback', () => {
  it('returns empty when both organization and project lookup fail', async () => {
    globalThis.fetch = vi.fn(async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    expect(await fetchAccountEmail('supabase', 'tok')).toBe('');
  });
});
