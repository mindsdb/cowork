export interface OAuthCredentials {
  clientIdVar: string;
  // Absent for public, PKCE-only providers (PostHog) — there is no
  // client_secret to configure for those.
  clientSecretVar?: string;
}

export const OAUTH_CREDENTIALS: Record<string, OAuthCredentials> = {
  gmail: {
    clientIdVar: 'GMAIL_CLIENT_ID',
    clientSecretVar: 'GMAIL_CLIENT_SECRET',
  },
  google_drive: {
    clientIdVar: 'GOOGLE_DRIVE_CLIENT_ID',
    clientSecretVar: 'GOOGLE_DRIVE_CLIENT_SECRET',
  },
  google_calendar: {
    clientIdVar: 'GOOGLE_CALENDAR_CLIENT_ID',
    clientSecretVar: 'GOOGLE_CALENDAR_CLIENT_SECRET',
  },
  google_ads: {
    clientIdVar: 'GOOGLE_ADS_CLIENT_ID',
    clientSecretVar: 'GOOGLE_ADS_CLIENT_SECRET',
  },
  google_analytics_4: {
    clientIdVar: 'GOOGLE_ANALYTICS_CLIENT_ID',
    clientSecretVar: 'GOOGLE_ANALYTICS_CLIENT_SECRET',
  },
  linear: {
    clientIdVar: 'LINEAR_CLIENT_ID',
    clientSecretVar: 'LINEAR_CLIENT_SECRET',
  },
  github: {
    clientIdVar: 'GITHUB_CLIENT_ID',
    clientSecretVar: 'GITHUB_CLIENT_SECRET',
  },
  supabase: {
    clientIdVar: 'SUPABASE_CLIENT_ID',
    clientSecretVar: 'SUPABASE_CLIENT_SECRET',
  posthog: {
    clientIdVar: 'POSTHOG_CLIENT_ID',
  },
};
