// Greeting variants for "+ Connect" — picked at random when the user
// starts a fresh data-vault conversation. The point is to make the
// experience feel less form-shaped and more like Anton actually
// asking. We mention a handful of common targets so the user knows
// the surface area without listing every connector exhaustively.

// Welcome variants for "+ Connect". Tight three-beat shape:
//   <question> (<short example list>) — <I-can-do-anything tail>
// No mention of credentials — some connectors are OAuth-only, some
// are public APIs. Just ask what they want and signal openness.
const WELCOMES = [
  "What do you want to connect to? (Gmail, Google Calendar, PostHog, Salesforce, Postgres) — I can hook up basically anything.",
  "What's the target? (Salesforce, HubSpot, Gmail, PostHog, Snowflake) — pretty much anything works, just name it.",
  "Which one are we wiring up? (Postgres, MySQL, Gmail, Google Calendar, PostHog) — I can connect to almost anything, drop a name.",
  "What are we connecting? (Gmail, Salesforce, PostHog, GitHub, Slack) — odds are I can handle whatever you throw at me.",
  "Tell me the target. (PostHog, Salesforce, Gmail, Google Calendar, HubSpot) — most things work out of the box.",
  "What do you want to hook up? (Postgres, Snowflake, Gmail, Salesforce, PostHog) — name anything, I'll figure it out.",
  "Which connector? (Salesforce, HubSpot, PostHog, Gmail, Google Calendar) — I can pretty much do anything, just say the word.",
  "What are you connecting to? (Gmail, Google Calendar, PostHog, Salesforce, MySQL) — basically anything with a name works.",
  "Pick a target. (PostHog, Salesforce, Gmail, Postgres, GitHub) — I can connect to almost anything you'd want.",
  "What's it gonna be? (Gmail, Google Calendar, Salesforce, PostHog, Snowflake) — name anything and I'll set it up.",
];

export function pickConnectWelcome() {
  return WELCOMES[Math.floor(Math.random() * WELCOMES.length)];
}
