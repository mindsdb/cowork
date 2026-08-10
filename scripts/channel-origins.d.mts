// Hand-written declarations for channel-origins.mjs so the drift test in
// src/main/channels.test.ts can import it under `npm run typecheck:test`.
export declare const EXPECTED_API_ORIGIN: Record<
  'dev' | 'preview' | 'stable' | 'prod',
  string
>;
