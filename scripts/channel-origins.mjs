// Expected MindsHub API origin per build kind — the plain-JS mirror of
// CHANNELS[kind].apiHost, so build scripts (which can't import the TS) and the
// unit suite share ONE copy. channels.test.ts drift-guards it against the
// canonical table. Keep side-effect-free so importing never runs build logic.
export const EXPECTED_API_ORIGIN = {
  dev: 'https://api.staging.mindshub.ai',
  preview: 'https://api.staging.mindshub.ai',
  stable: 'https://api.staging.mindshub.ai',
  prod: 'https://api.mindshub.ai',
};
