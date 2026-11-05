// Hand-written types for analytics.js, same pattern as settingsTransform.d.ts /
// App.d.ts. Only the members imported from TypeScript are declared — extend as
// TS callers need more of the surface.

/**
 * Desktop boot-screen resolution event (ENG-921). Fires once per launch,
 * before sign-in, with the chosen first screen (`target`) and the local-server
 * install state read at that moment. No-op off Electron. Never throws.
 */
export function trackBootScreenResolved(target: string): Promise<void>;

/** Shell auto-update milestone, once per app run. No-op off Electron. */
export function trackShellUpdatePhase(snapshot: unknown): void;

/** One journaled UI/server update outcome; true when PostHog took it. */
export function trackUpdatePhase(entry: import('../../../shared/update-journal-types').UpdatePhaseEntry): Promise<boolean>;

/** Report the outcomes main journaled, once per renderer. No-op off Electron. */
export function drainUpdateJournal(): Promise<void>;

/**
 * MindsHub declined to provision an LLM key (ENG-1533). `outcome` records what
 * the UI did about it — `byok_offered`, `billing_opened` or `unhandled` — since
 * the refusal forks three ways and only the renderer knows which. Never throws.
 */
export function trackKeyProvisioningRefused(outcome: string): void;

/**
 * The desktop sent the user to the console billing page. `trigger` names the
 * condition that sent them; `workspaceMode` is 'code' for a Code Mode route.
 */
export function trackBillingOpened(trigger: string, workspaceMode?: 'code'): void;

/** First switch into the Code workspace per launch. Never throws. */
export function trackCodeViewOpened(): void;

/** A Code Mode task was created, read from the created session. Never throws. */
export function trackCodeTaskStarted(
  session: import('../code/api').CodingSession,
  options?: { origin?: 'new' | 'fork'; attachmentCount?: number },
): void;

/** A Code Mode create or fork was refused. Never throws. */
export function trackCodeTaskStartFailed(
  origin: 'new' | 'fork',
  input: { engineId?: string; model?: string; projectId?: string | null } | null,
  reason: unknown,
): void;
