export interface OAuthCredentials {
  clientIdVar: string;
  clientSecretVar: string;
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
};
