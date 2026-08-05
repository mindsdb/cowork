// Hand-written types for analytics.js, same pattern as settingsTransform.d.ts /
// App.d.ts. Only the members imported from TypeScript are declared — extend as
// TS callers need more of the surface.

/**
 * Desktop boot-screen resolution event (ENG-921). Fires once per launch,
 * before sign-in, with the chosen first screen (`target`) and the local-server
 * install state read at that moment. No-op off Electron. Never throws.
 */
export function trackBootScreenResolved(target: string): Promise<void>;
