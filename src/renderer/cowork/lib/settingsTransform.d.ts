// Hand-written types for settingsTransform.js, same pattern as App.d.ts.
// Only the members imported from TypeScript are declared — extend as TS
// callers need more of the surface.

export interface ProviderModel {
  id: string;
  label: string;
}

/** Derive a human-readable label from a model id (pure, family-aware). */
export function modelLabel(id: string | null | undefined): string;

/**
 * Map a provider's runtime model-id list (from the backend-overlaid
 * `recommendedModels` settings map) to `{id, label}` dropdown options.
 * `modelLabels` is MindsHub's display name per id; ids missing from it fall
 * back to the derived label.
 */
export function recommendedModelOptions(
  recommendedModels: Record<string, string[]> | null | undefined,
  providerType: string,
  modelLabels?: Record<string, string> | null,
): ProviderModel[];

export function providerValueToType(value: string | null | undefined): string;
