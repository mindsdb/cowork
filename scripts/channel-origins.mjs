// Expected MindsHub API origin per build kind — the plain-JS mirror of
// CHANNELS[kind].apiHost in src/main/channels.ts, split into its own module so
// build scripts (which can't import the TS source) and the unit suite share
// ONE copy instead of each carrying their own.
//
// Drift protection: src/main/channels.test.ts imports this file and fails if
// it disagrees with the canonical channel table. Keep it side-effect-free so
// importing it never runs build logic.
export const EXPECTED_API_ORIGIN = {
  dev: 'https://api.staging.mindshub.ai',
  preview: 'https://api.staging.mindshub.ai',
  stable: 'https://api.staging.mindshub.ai',
  prod: 'https://api.mindshub.ai',
};
