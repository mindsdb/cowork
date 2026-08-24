// Resolving "who is this account" after an OAuth token exchange completes —
// needed as the OS keychain key and the vault record's display name. The
// response shape genuinely differs per provider (REST userinfo vs GraphQL),
// so this is the one piece of OAuth-builtin onboarding that can't be pure
// spec-JSON data — it's provider-specific code, not configuration. New
// OAuth-builtin connectors add one entry to FETCHERS below.

export interface OAuthIdentity {
  email: string;
  name?: string;
}

async function fetchGoogleIdentity(accessToken: string): Promise<OAuthIdentity> {
  const res = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { email: '' };
  const data = await res.json() as { email?: string };
  return { email: data.email || '' };
}

async function fetchLinearIdentity(accessToken: string): Promise<OAuthIdentity> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: 'query { viewer { email } }' }),
  });
  if (!res.ok) return { email: '' };
  const data = await res.json() as { data?: { viewer?: { email?: string } } };
  return { email: data.data?.viewer?.email || '' };
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
  const res = await fetch('https://api.supabase.com/v1/organizations', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { email: '' };

  const data = await res.json() as
    Array<{ slug?: string; name?: string }> |
    { organizations?: Array<{ slug?: string; name?: string }> };

  const organizations = Array.isArray(data) ? data : (data.organizations || []);
  const organization = organizations[0];
  const slug = organization?.slug || '';
  const name = organization?.name || slug;

  // Supabase Management API OAuth does not expose a user email field;
  // use the organization slug as a stable account identity while retaining
  // the human-readable organization name for the connection tile.
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
