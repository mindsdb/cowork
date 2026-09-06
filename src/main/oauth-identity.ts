// Provider-specific account identity for keychain keys and vault labels. Add built-ins to FETCHERS.

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

// Keep workspace lookup separate and best-effort so failure cannot prevent the required identity
// lookup.
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

// Include the workspace ID so connecting the same email to another Linear workspace does not
// overwrite it.
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
  // GitHub email may be private or unavailable under read:user; use the unique login as fallback.
  return { email: data.email || data.login || '' };
}

// PostHog OAuth is global, but resource tokens may work only on their regional API. Try US then EU.
// This path does not discover a project_id.
export const POSTHOG_API_HOSTS = ['https://us.posthog.com', 'https://eu.posthog.com'] as const;

// Look up organizations best-effort on the same regional host that accepted the identity request.
// Display every granted organization, but dedup currently uses only the first organization ID.
async function fetchPostHogOrganization(accessToken: string, apiHost: string): Promise<{ id: string; name: string }> {
  try {
    const res = await fetch(`${apiHost}/api/organizations/`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { id: '', name: '' };
    const data = await res.json() as
      Array<{ id?: string; name?: string }> |
      { results?: Array<{ id?: string; name?: string }> };
    const organizations = Array.isArray(data) ? data : (data.results || []);
    if (organizations.length === 0) return { id: '', name: '' };
    const id = organizations[0].id || '';
    const name = organizations.map((org) => org.name || '').filter(Boolean).join(', ');
    return { id, name };
  } catch {
    return { id: '', name: '' };
  }
}

// Include organization ID so a second PostHog organization does not overwrite the first connection.
async function fetchPostHogIdentity(accessToken: string): Promise<OAuthIdentity> {
  for (const apiHost of POSTHOG_API_HOSTS) {
    const res = await fetch(`${apiHost}/api/users/@me/`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json() as { email?: string; first_name?: string; last_name?: string };
      const email = data.email || '';
      const name = [data.first_name, data.last_name].filter(Boolean).join(' ');
      const organization = await fetchPostHogOrganization(accessToken, apiHost);
      return {
        email: organization.id ? `${email}:${organization.id}` : email,
        name: organization.name || name || undefined,
      };
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

// Provider-specific revoke requests; engines without a builder use the RFC-7009 form body.
// Keep aligned with cowork-server’s _REVOKE_HANDLERS.
const REVOKE_REQUEST_BUILDERS: Record<
  string,
  (refreshToken: string, clientId: string, clientSecret: string) => RevokeRequest
> = {
  // Supabase revokes grants with JSON client credentials and refresh_token, not a form-encoded
  // access token.
  supabase: (refreshToken, clientId, clientSecret) => ({
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
  }),
};

/** Build revoke headers/body, defaulting to the RFC-7009 token=<refresh_token> form. */
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
