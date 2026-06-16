// Hand-written types for api.js, same pattern as App.d.ts. Only the
// members imported from TypeScript are declared — extend as TS callers
// need more of the surface.

export const BASE: string;

/** Per-provider recommended (planning, coding) model id pair. */
export interface RecommendedModels {
  recommendedPair?: Record<string, [string, string] | string[]>;
  [key: string]: unknown;
}

/**
 * Fetch the backend's recommended-models map (MindsHub's live `/v1/models`
 * for minds-cloud). Returns null if the request fails.
 */
export function fetchRecommendedModels(): Promise<RecommendedModels | null>;

/** A single stored memory file within a scope section. */
export interface MemoryFile {
  relativePath: string;
  content: string;
  preview?: string;
  scope?: string;
  projectName?: string | null;
  projectPath?: string | null;
}

/** A group of memory files sharing a scope (and optional project). */
export interface MemorySection {
  scope: string;
  projectName?: string | null;
  projectPath?: string | null;
  files: MemoryFile[];
}

/** List stored agent memory, optionally filtered to a project's scope. */
export function fetchMemory(
  projectPath?: string,
): Promise<{ sections: MemorySection[] }>;

/** Create or overwrite a memory file via the active harness. */
export function saveMemory(payload: {
  scope: string;
  relativePath: string;
  content: string;
  projectPath?: string;
}): Promise<unknown>;

/** Resolved user settings. `harness` is the active response harness id. */
export interface AppSettings {
  harness?: string;
  [key: string]: unknown;
}

/** Fetch the merged user settings (provider/model/harness choices, etc.). */
export function fetchSettings(): Promise<AppSettings>;
