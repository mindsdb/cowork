// Hand-written types for settingsTransform.js, same pattern as App.d.ts.
// Only the members imported from TypeScript are declared — extend as TS
// callers need more of the surface.

export interface ProviderModel {
  id: string;
  label: string;
}

export const PROVIDER_MODELS: Record<string, ProviderModel[]>;
