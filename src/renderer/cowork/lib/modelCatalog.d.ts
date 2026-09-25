/**
 * Why MindsHub lists a model as unavailable: the gateway's own reason words, as
 * the renderer holds them. cowork-server relays any non-empty `disabled_reason`
 * string; `knownModelDisabledReasons` keeps only these three and drops any other
 * value, so a row with an unknown reason reads as having none ("Needs credits").
 */
export type ModelDisabledReason = 'model_restricted' | 'wallet_empty' | 'included_allowance_exhausted';

/** Picker-row fields for a model that cannot run (see unavailableModelFields). */
export interface UnavailableModelFields {
  disabled?: true;
  locked?: true;
  restricted?: true;
  tag?: string;
  title?: string;
}

export const MODEL_RESTRICTED_REASON: 'model_restricted';
export const RESTRICTED_MODEL_TITLE: string;

/**
 * Narrows cowork-server's `modelDisabledReasons` relay to the entries whose
 * reason is a `ModelDisabledReason`. Any other value, and any input that is not
 * a plain object, is dropped.
 */
export function knownModelDisabledReasons(raw: unknown): Record<string, ModelDisabledReason>;
export function isFrozenAlias(id: string, families?: Record<string, string>): boolean;
export function isModelLocked(modelEnabled: Record<string, boolean> | undefined, id: string): boolean;
export function isModelRestricted(
  modelEnabled: Record<string, boolean> | undefined,
  modelDisabledReasons: Record<string, ModelDisabledReason> | undefined,
  id: string,
): boolean;
export function unavailableModelFields(
  modelEnabled: Record<string, boolean> | undefined,
  modelDisabledReasons: Record<string, ModelDisabledReason> | undefined,
  id: string,
): UnavailableModelFields;
export function orderByFamily(ids: string[], families?: Record<string, string>): string[];
