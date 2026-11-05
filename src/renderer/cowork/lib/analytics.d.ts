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

/** Cost properties for a comparison event, from lib/compareSides comparisonCostProps. */
export interface ComparisonCostProps {
  cost_a_usd?: number;
  cost_b_usd?: number;
  cost_total_usd?: number;
  cost_partial: boolean;
  tokens_a?: number;
  tokens_b?: number;
  cheaper_side?: 'a' | 'b' | 'same';
}
/** First open of Compare Models per launch. Never throws. */
export function trackCompareViewOpened(): void;
/** A comparison was created on the server. Never throws. */
export function trackComparisonStarted(
  comparison: { id: string; sourceProjectId?: string | null; sides?: { model?: string; reasoningEffort?: string | null }[] },
  options?: { fileCount?: number; exampleId?: string | null },
): void;
/** A follow-up went out to both sides or one. Never throws. */
export function trackComparisonFollowUpSent(comparisonId: string, target: 'both' | 'a' | 'b', turnIndex: number): void;
/** A winner was picked or changed for a turn. Never throws. */
export function trackComparisonVerdictRecorded(
  comparisonId: string,
  details: { turnIndex: number; winner: 'a' | 'b' | 'tie' | 'neither'; models?: { a?: string; b?: string }; changed?: boolean; cost?: ComparisonCostProps },
): void;
/** Continue with a side succeeded. Never throws. */
export function trackComparisonContinued(
  comparisonId: string,
  details: { side: 'a' | 'b'; models?: { a?: string; b?: string }; turns: number; carriedAll: boolean; verdict?: string | null; cost?: ComparisonCostProps },
): void;

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
