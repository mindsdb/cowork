// Build scripts cannot import CHANNELS TypeScript; channels.test.ts checks this origin mirror.
// Keep imports side-effect-free.
export const EXPECTED_API_ORIGIN = {
  dev: 'https://api.staging.mindshub.ai',
  preview: 'https://api.staging.mindshub.ai',
  stable: 'https://api.staging.mindshub.ai',
  prod: 'https://api.mindshub.ai',
};
