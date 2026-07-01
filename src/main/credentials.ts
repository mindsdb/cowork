export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export const OAUTH_CREDENTIALS: Record<string, OAuthCredentials> = {
  gmail: {
    clientId: '__GMAIL_CLIENT_ID__',
    clientSecret: '__GMAIL_CLIENT_SECRET__',
  },
  google_drive: {
    clientId: '__GOOGLE_DRIVE_CLIENT_ID__',
    clientSecret: '__GOOGLE_DRIVE_CLIENT_SECRET__',
  },
  google_calendar: {
    clientId: '__GOOGLE_CALENDAR_CLIENT_ID__',
    clientSecret: '__GOOGLE_CALENDAR_CLIENT_SECRET__',
  },
  google_ads: {
    clientId: '__GOOGLE_ADS_CLIENT_ID__',
    clientSecret: '__GOOGLE_ADS_CLIENT_SECRET__',
  },
  google_analytics_4: {
    clientId: '__GOOGLE_ANALYTICS_CLIENT_ID__',
    clientSecret: '__GOOGLE_ANALYTICS_CLIENT_SECRET__',
  },
};
