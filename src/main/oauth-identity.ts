// Resolving "who is this account" after an OAuth token exchange completes —
// needed as the OS keychain key and the vault record's display name. The
// response shape genuinely differs per provider (REST userinfo vs GraphQL),
// so this is the one piece of OAuth-builtin onboarding that can't be pure
// spec-JSON data — it's provider-specific code, not configuration. New
// OAuth-builtin connectors add one entry to FETCHERS below.

export interface OAuthIdentity {
  email: string;
  name?: string;
  reason?: string;
}

async function fetchGoogleIdentity(accessToken: string): Promise<OAuthIdentity> {
  const res = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { email: '' };
  const data = await res.json() as { email?: string };
  return { email: data.email || '' };
}

// Deliberately a separate request from fetchLinearIdentity's viewer query,
// not one combined query: unlike the viewer query (required — no identity,
// no connection), the workspace lookup is best-effort, so a
// broken/unverified `organization` field degrades to "no workspace split"
// instead of failing the whole connection. Mirrors cowork-server's
// _fetch_linear_workspace (oauth/google.py) and auth's counterpart.
async function fetchLinearWorkspace(accessToken: string): Promise<{ id: string; name: string }> {
  try {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'query { organization { id name } }' }),
    });
    if (!res.ok) return { id: '', name: '' };
    const data = await res.json() as {
      data?: { organization?: { id?: string; name?: string } };
      errors?: unknown;
    };
    if (data.errors) return { id: '', name: '' };
    return { id: data.data?.organization?.id || '', name: data.data?.organization?.name || '' };
  } catch (err) {
    console.warn('[oauth-identity] Could not fetch Linear workspace identity — falling back to bare email:', err);
    return { id: '', name: '' };
  }
}

// Unlike Google, a Linear account isn't one-account-one-email: the same
// email can belong to several workspaces. Folding the workspace id (from
// fetchLinearWorkspace, best-effort) into the returned identity — the same
// trick fetchSupabaseIdentity below uses for its own per-organization
// identity — means connecting a second workspace gets its own connection
// tile instead of silently overwriting the first.
async function fetchLinearIdentity(accessToken: string): Promise<OAuthIdentity> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: 'query { viewer { email name } }' }),
  });
  if (!res.ok) return { email: '' };
  const data = await res.json() as { data?: { viewer?: { email?: string; name?: string } } };
  const email = data.data?.viewer?.email || '';
  if (!email) return { email: '' };
  const workspace = await fetchLinearWorkspace(accessToken);
  return {
    email: workspace.id ? `${email}:${workspace.id}` : email,
    // Workspace name first, matching fetchSupabaseIdentity's
    // per-organization identity convention below — the tile shows the
    // workspace/org, not the connecting individual.
    name: workspace.name || data.data?.viewer?.name || undefined,
  };
}

async function fetchGithubIdentity(accessToken: string): Promise<OAuthIdentity> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) return { email: '' };
  const data = await res.json() as { email?: string; login?: string };
  // GitHub's email is frequently null (this app only requests `read:user`, not
  // `user:email`, and even then a user can keep it private) — `login` is
  // always present and unique, so it's the fallback identity, matching the
  // server-side _fetch_userinfo_github fallback.
  return { email: data.email || data.login || '' };
}

// PostHog's OAuth authorize/token endpoints are region-agnostic
// (oauth.posthog.com), but the resource API is split by region
// (us.posthog.com / eu.posthog.com) and a token issued for one region isn't
// guaranteed to be accepted by the other's host. Used by the identity fetch
// below, which tries US Cloud first (the default/most common case) and falls
// back to EU Cloud. Note: OAuth-connected PostHog accounts don't currently
// resolve a project_id (unlike the personal-API-key path) — there's no
// project-discovery step here.
export const POSTHOG_API_HOSTS = ['https://us.posthog.com', 'https://eu.posthog.com'] as const;

async function fetchPostHogIdentity(accessToken: string): Promise<OAuthIdentity> {
  for (const apiHost of POSTHOG_API_HOSTS) {
    const res = await fetch(`${apiHost}/api/users/@me/`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json() as { email?: string };
      return { email: data.email || '' };
    }
  }
  return { email: '' };
}
  
async function fetchSupabaseIdentity(accessToken: string): Promise<OAuthIdentity> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  let organizations: Array<{ slug?: string; name?: string }> = [];
  let organizationError = '';

  const organizationsRes = await fetch('https://api.supabase.com/v1/organizations', { headers });
  if (organizationsRes.ok) {
    const data = await organizationsRes.json() as
      Array<{ slug?: string; name?: string }> |
      { organizations?: Array<{ slug?: string; name?: string }> };
    organizations = Array.isArray(data) ? data : (data.organizations || []);
  } else {
    organizationError = `organizations endpoint returned ${organizationsRes.status}`;
  }

  // Organization-scoped grants may reject the account-wide listing. The
  // projects endpoint remains available and includes organization_slug.
  if (!organizations.length) {
    const projectsRes = await fetch('https://api.supabase.com/v1/projects', { headers });
    if (projectsRes.ok) {
      const projects = await projectsRes.json() as Array<{
        organization_slug?: string;
        organization_name?: string;
      }>;
      organizations = projects
        .filter((project) => project.organization_slug)
        .map((project) => ({ slug: project.organization_slug, name: project.organization_name }));
    } else {
      return { email: '', reason: `Supabase lookup failed (${organizationError}; projects endpoint returned ${projectsRes.status}).` };
    }
  }

  const organization = organizations.find((item) => item.slug) || {};
  const slug = organization.slug || '';
  const name = organization.name || slug;
  return { email: slug ? `org:${slug}` : '', name };
}

const FETCHERS: Record<string, (accessToken: string) => Promise<OAuthIdentity>> = {
  google_drive: fetchGoogleIdentity,
  google_calendar: fetchGoogleIdentity,
  gmail: fetchGoogleIdentity,
  google_ads: fetchGoogleIdentity,
  google_analytics_4: fetchGoogleIdentity,
  linear: fetchLinearIdentity,
  github: fetchGithubIdentity,
  posthog: fetchPostHogIdentity,
  supabase: fetchSupabaseIdentity,
};

export async function fetchAccountIdentity(engine: string, accessToken: string): Promise<OAuthIdentity> {
  const fetcher = FETCHERS[engine] || fetchGoogleIdentity;
  try {
    return await fetcher(accessToken);
  } catch {
    return { email: '' };
  }
}

export async function fetchAccountEmail(engine: string, accessToken: string): Promise<string> {
  const { email } = await fetchAccountIdentity(engine, accessToken);
  return email;
}

export interface RevokeRequest {
  headers: Record<string, string>;
  body: string;
}

// engine -> custom revoke request builder, for providers whose revoke
// endpoint doesn't fit the generic RFC-7009 form-body shape (a bare
// `token=<refresh_token>` POST) every other connector uses. Mirrors
// cowork-server's `_REVOKE_HANDLERS` (oauth/google.py) — kept here rather
// than in the spec JSON because the request shape is genuinely
// provider-specific code, the same reasoning FETCHERS above already
// documents for identity resolution.
const REVOKE_REQUEST_BUILDERS: Record<
  string,
  (refreshToken: string, clientId: string, clientSecret: string) => RevokeRequest
> = {
  // Supabase's /v1/oauth/revoke takes a JSON body naming client_id,
  // client_secret, and specifically refresh_token — not the generic
  // form-encoded `token` param. Revoking only an access_token isn't
  // supported and wouldn't remove mindshub from the user's Supabase-side
  // Authorized Apps list, since that reflects the underlying grant.
  supabase: (refreshToken, clientId, clientSecret) => ({
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
  }),
};

/** Request body/headers to POST to a connector's revoke_url. Falls back to
 * the generic RFC-7009 shape (`token=<refresh_token>`, form-encoded) for any
 * engine without a custom builder above. */
export function buildRevokeRequest(
  engine: string, refreshToken: string, clientId: string, clientSecret: string,
): RevokeRequest {
  const builder = REVOKE_REQUEST_BUILDERS[engine];
  if (builder) return builder(refreshToken, clientId, clientSecret);
  return {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }).toString(),
  };
}
