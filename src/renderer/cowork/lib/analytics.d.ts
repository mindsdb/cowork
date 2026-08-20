// Hand-written types for analytics.js, same pattern as settingsTransform.d.ts /
// App.d.ts. Only the members imported from TypeScript are declared — extend as
// TS callers need more of the surface.

/**
 * Desktop boot-screen resolution event (ENG-921). Fires once per launch,
 * before sign-in, with the chosen first screen (`target`) and the local-server
 * install state read at that moment. No-op off Electron. Never throws.
 */
export function trackBootScreenResolved(target: string): Promise<void>;

/**
 * MindsHub declined to provision an LLM key (ENG-1533). `outcome` records what
 * the UI did about it — `byok_offered`, `billing_opened` or `unhandled` — since
 * the refusal forks three ways and only the renderer knows which. Never throws.
 */
export function trackKeyProvisioningRefused(outcome: string): void;

/**
 * The desktop sent the user to the console billing page (ENG-1533). `trigger`
 * names the condition that sent them. Never throws.
 */
export function trackBillingOpened(trigger: string): void;
