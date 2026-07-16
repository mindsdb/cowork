// Resolving "who is this account" after an OAuth token exchange completes —
// needed as the OS keychain key and the vault record's display name. The
// response shape genuinely differs per provider (REST userinfo vs GraphQL),
// so this is the one piece of OAuth-builtin onboarding that can't be pure
// spec-JSON data — it's provider-specific code, not configuration. New
// OAuth-builtin connectors add one entry to FETCHERS below.

async function fetchGoogleIdentity(accessToken: string): Promise<{ email: string }> {
  const res = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { email: '' };
  const data = await res.json() as { email?: string };
  return { email: data.email || '' };
}

async function fetchLinearIdentity(accessToken: string): Promise<{ email: string }> {
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

const FETCHERS: Record<string, (accessToken: string) => Promise<{ email: string }>> = {
  google_drive: fetchGoogleIdentity,
  google_calendar: fetchGoogleIdentity,
  gmail: fetchGoogleIdentity,
  google_ads: fetchGoogleIdentity,
  google_analytics_4: fetchGoogleIdentity,
  linear: fetchLinearIdentity,
};

export async function fetchAccountEmail(engine: string, accessToken: string): Promise<string> {
  const fetcher = FETCHERS[engine] || fetchGoogleIdentity;
  try {
    const { email } = await fetcher(accessToken);
    return email;
  } catch {
    return '';
  }
}
