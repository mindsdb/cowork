// Hand-written types for api.js, same pattern as App.d.ts. Only the
// members imported from TypeScript are declared — extend as TS callers
// need more of the surface.

export const BASE: string;

/**
 * fetch() wrapper that attaches the Keycloak Bearer token in web mode (Electron
 * injects the loopback token in main). Use for any direct call to the server.
 */
export function authFetch(url: string, options?: RequestInit): Promise<Response>;

/** Per-provider recommended (planning, coding) model id pair. */
export interface RecommendedModels {
  /** Per-provider model-id lists for the picker (server-owned). */
  recommendedModels?: Record<string, string[]>;
  recommendedPair?: Record<string, [string, string] | string[]>;
  /** Per-model effort capability: id → { efforts, default }. */
  modelEfforts?: Record<string, { efforts: string[]; default: string }>;
  [key: string]: unknown;
}

/**
 * Fetch the backend's recommended-models map (MindsHub's live `/v1/models`
 * for minds-cloud). Returns null if the request fails.
 */
export function fetchRecommendedModels(): Promise<RecommendedModels | null>;
