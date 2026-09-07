import { describe, it, expect, vi } from 'vitest';

import { fetchAccountEmail, fetchAccountIdentity, buildRevokeRequest } from './oauth-identity';

describe('fetchAccountEmail — PostHog US/EU region fallback', () => {
  it('uses the US host when it succeeds', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url.toString();
      expect(new URL(href).host).toBe('us.posthog.com');
      if (href.endsWith('/api/organizations/')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      return new Response(JSON.stringify({ email: 'us-user@example.com' }), { status: 200 });
    }) as unknown as typeof fetch;

    expect(await fetchAccountEmail('posthog', 'tok')).toBe('us-user@example.com');
  });

  it('falls back to the EU host when the US host rejects the token', async () => {
    const calledUserEndpointHosts: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.endsWith('/api/organizations/')) {
        expect(new URL(href).host).toBe('eu.posthog.com');
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      calledUserEndpointHosts.push(href);
      if (new URL(href).host === 'us.posthog.com') {
        return new Response('', { status: 401 });
      }
      return new Response(JSON.stringify({ email: 'eu-user@example.com' }), { status: 200 });
    }) as unknown as typeof fetch;

    expect(await fetchAccountEmail('posthog', 'tok')).toBe('eu-user@example.com');
    expect(calledUserEndpointHosts).toEqual([
      'https://us.posthog.com/api/users/@me/',
      'https://eu.posthog.com/api/users/@me/',
    ]);
  });

  it('returns an empty string when both regional hosts fail', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;

    expect(await fetchAccountEmail('posthog', 'tok')).toBe('');
  });
});

// ENG-2240: a PostHog account can belong to several organizations under the
// same email (unlike Google, where an account is an email), so the
// organization id is folded into the returned email for dedup, and the
// organization name - not the connecting person's own name - is returned as
// `name`, the same convention fetchSupabaseIdentity uses for its own
// per-organization identity. The organization lookup is a separate,
// best-effort request from the required user query, routed here by which
// endpoint path each fetch call carries.
describe('fetchAccountIdentity — PostHog organization-aware identity', () => {
  function stubPostHogCalls(opts: { user: object; organization?: object; organizationOk?: boolean }) {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.endsWith('/api/organizations/')) {
        return new Response(JSON.stringify(opts.organization ?? { results: [] }), {
          status: opts.organizationOk === false ? 500 : 200,
        });
      }
      return new Response(JSON.stringify(opts.user), { status: 200 });
    }) as unknown as typeof fetch;
  }

  it('uses the organization name over the person name, and folds the organization id into email', async () => {
    stubPostHogCalls({
      user: { email: 'user@example.com', first_name: 'User', last_name: 'Name' },
      organization: { results: [{ id: 'org-123', name: 'Acme Org' }] },
    });

    await expect(fetchAccountIdentity('posthog', 'tok')).resolves.toEqual({
      email: 'user@example.com:org-123',
      name: 'Acme Org',
    });
  });

  it('names every organization selected at consent, not just the first', async () => {
    // ENG-2240 follow-up: PostHog's consent screen lets a user select
    // several organizations in one authorization (unlike Linear, one grant
    // = one workspace) - the tile must name all of them.
    stubPostHogCalls({
      user: { email: 'user@example.com', first_name: 'User', last_name: 'Name' },
      organization: { results: [{ id: 'org-123', name: 'Acme Org' }, { id: 'org-456', name: 'Other Org' }] },
    });

    await expect(fetchAccountIdentity('posthog', 'tok')).resolves.toEqual({
      // Dedup key still keys off the first organization only.
      email: 'user@example.com:org-123',
      name: 'Acme Org, Other Org',
    });
  });

  it('gives a second organization a distinct identity', async () => {
    stubPostHogCalls({
      user: { email: 'user@example.com', first_name: 'User', last_name: 'Name' },
      organization: { results: [{ id: 'org-456', name: 'Other Org' }] },
    });

    const identity = await fetchAccountIdentity('posthog', 'tok');
    expect(identity.email).toBe('user@example.com:org-456');
    expect(identity.email).not.toBe('user@example.com:org-123');
  });

  it('falls back to the person name when there are no organizations', async () => {
    stubPostHogCalls({
      user: { email: 'user@example.com', first_name: 'User', last_name: 'Name' },
      organization: { results: [] },
    });

    await expect(fetchAccountIdentity('posthog', 'tok')).resolves.toEqual({
      email: 'user@example.com',
      name: 'User Name',
    });
  });

  it('degrades to bare email instead of failing when the organization request errors', async () => {
    stubPostHogCalls({
      user: { email: 'user@example.com', first_name: 'User', last_name: 'Name' },
      organizationOk: false,
    });

    await expect(fetchAccountIdentity('posthog', 'tok')).resolves.toEqual({
      email: 'user@example.com',
      name: 'User Name',
    });
  });

  it('degrades to bare email instead of failing when the organization request throws', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.endsWith('/api/organizations/')) throw new Error('network error');
      return new Response(JSON.stringify({ email: 'user@example.com', first_name: 'User', last_name: 'Name' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    await expect(fetchAccountIdentity('posthog', 'tok')).resolves.toEqual({
      email: 'user@example.com',
      name: 'User Name',
    });
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

// ENG-2188: a Linear account can belong to several workspaces under the same
// email (unlike Google, where an account is an email), so the workspace id
// is folded into the returned email for dedup, and the workspace name - not
// the connecting person's own name - is returned as `name`, the same
// convention fetchSupabaseIdentity uses for its own per-organization
// identity. The workspace lookup is a separate, best-effort request from the
// required viewer query, routed here by which GraphQL query each fetch call
// carries.
describe('fetchAccountIdentity — Linear workspace-aware identity', () => {
  function stubLinearCalls(opts: {
    viewerBody: object;
    organizationBody?: object;
    organizationStatus?: number;
    organizationThrows?: boolean;
  }) {
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const query = JSON.parse(String(init?.body)).query as string;
      if (query.includes('organization')) {
        if (opts.organizationThrows) throw new Error('network error');
        return new Response(JSON.stringify(opts.organizationBody ?? {}), {
          status: opts.organizationStatus ?? 200,
        });
      }
      return new Response(JSON.stringify(opts.viewerBody), { status: 200 });
    }) as unknown as typeof fetch;
  }

  it('uses the workspace name over the person name, and folds the workspace id into email', async () => {
    stubLinearCalls({
      viewerBody: { data: { viewer: { email: 'user@example.com', name: 'User Name' } } },
      organizationBody: { data: { organization: { id: 'org-123', name: 'Acme Workspace' } } },
    });

    await expect(fetchAccountIdentity('linear', 'tok')).resolves.toEqual({
      email: 'user@example.com:org-123',
      name: 'Acme Workspace',
    });
  });

  it('gives a second workspace a distinct identity', async () => {
    stubLinearCalls({
      viewerBody: { data: { viewer: { email: 'user@example.com', name: 'User Name' } } },
      organizationBody: { data: { organization: { id: 'org-456', name: 'Other Workspace' } } },
    });

    const identity = await fetchAccountIdentity('linear', 'tok');
    expect(identity.email).toBe('user@example.com:org-456');
    expect(identity.email).not.toBe('user@example.com:org-123');
  });

  it('falls back to the person name when organization data is missing', async () => {
    stubLinearCalls({
      viewerBody: { data: { viewer: { email: 'user@example.com', name: 'User Name' } } },
      organizationBody: { data: {} },
    });

    await expect(fetchAccountIdentity('linear', 'tok')).resolves.toEqual({
      email: 'user@example.com',
      name: 'User Name',
    });
  });

  it('degrades to bare email instead of failing when the organization query returns GraphQL errors', async () => {
    // The core resilience case: an unverified/wrong `organization` field
    // returning HTTP 200 + an errors array must not break the viewer
    // identity fetch a Linear connection's core functionality depends on.
    stubLinearCalls({
      viewerBody: { data: { viewer: { email: 'user@example.com', name: 'User Name' } } },
      organizationBody: { errors: [{ message: 'Cannot query field "organization" on type "Query".' }] },
    });

    await expect(fetchAccountIdentity('linear', 'tok')).resolves.toEqual({
      email: 'user@example.com',
      name: 'User Name',
    });
  });

  it('degrades to bare email instead of failing when the organization request throws', async () => {
    stubLinearCalls({
      viewerBody: { data: { viewer: { email: 'user@example.com', name: 'User Name' } } },
      organizationThrows: true,
    });

    await expect(fetchAccountIdentity('linear', 'tok')).resolves.toEqual({
      email: 'user@example.com',
      name: 'User Name',
    });
  });

  it('returns empty email when the viewer query fails', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;

    await expect(fetchAccountIdentity('linear', 'tok')).resolves.toEqual({ email: '' });
  });
});
