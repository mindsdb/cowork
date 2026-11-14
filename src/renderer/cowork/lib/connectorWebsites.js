// The website of a connector's service, where the person can sign in and the
// agent can do the same work in the shared browser instead of connecting.
// Only services with one address for everyone: a service on each customer's
// own host (Jira, Zendesk, Shopify), a database or an API-only service has
// none, and its connect form offers no browser.
const WEBSITES = {
  airtable: 'https://airtable.com',
  asana: 'https://app.asana.com',
  attio: 'https://app.attio.com',
  basecamp: 'https://launchpad.37signals.com',
  calendly: 'https://calendly.com/app',
  clickup: 'https://app.clickup.com',
  coda: 'https://coda.io',
  discord: 'https://discord.com/app',
  docusign: 'https://app.docusign.com',
  figma: 'https://www.figma.com',
  freshbooks: 'https://my.freshbooks.com',
  github: 'https://github.com',
  gitlab: 'https://gitlab.com',
  gmail: 'https://mail.google.com',
  google_ads: 'https://ads.google.com',
  google_analytics_4: 'https://analytics.google.com',
  google_calendar: 'https://calendar.google.com',
  google_drive: 'https://drive.google.com',
  google_search_console: 'https://search.google.com/search-console',
  gusto: 'https://app.gusto.com',
  hubspot: 'https://app.hubspot.com',
  intercom: 'https://app.intercom.com',
  linear: 'https://linear.app',
  linkedin_ads: 'https://www.linkedin.com/campaignmanager',
  mailchimp: 'https://login.mailchimp.com',
  meta_ads: 'https://adsmanager.facebook.com',
  microsoft_teams: 'https://teams.microsoft.com',
  monday: 'https://auth.monday.com',
  notion: 'https://www.notion.so',
  outlook: 'https://outlook.office.com',
  pipedrive: 'https://app.pipedrive.com',
  quickbooks: 'https://qbo.intuit.com',
  salesforce: 'https://login.salesforce.com',
  slack: 'https://app.slack.com',
  spotify: 'https://open.spotify.com',
  stripe: 'https://dashboard.stripe.com',
  todoist: 'https://app.todoist.com',
  trello: 'https://trello.com',
  typeform: 'https://admin.typeform.com',
  xero: 'https://go.xero.com',
};

/** The service's website for a connector id, or null when it has none everyone shares. */
export function connectorWebsite(connectorId) {
  return (connectorId && Object.hasOwn(WEBSITES, connectorId) && WEBSITES[connectorId]) || null;
}

/** What the agent is asked when the person picks the browser over connecting. */
export function browserInsteadRequest(name, url) {
  return `Don't connect ${name}. Use ${name}'s website in the browser instead (${url}). If it asks me to sign in, hand the browser to me.`;
}
