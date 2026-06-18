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
  category: string;
  projectId: string | null;
  content: string;
  preview?: string;
  scope?: string;
  projectName?: string | null;
  path: string;
}

/** A group of memory files sharing a scope (and optional project). */
export interface MemorySection {
  scope: string;
  projectName?: string | null;
  projectId?: string | null;
  files: MemoryFile[];
}

/** List stored agent memory, optionally filtered to a project. */
export function fetchMemory(
  projectRef?: unknown,
): Promise<{ sections: MemorySection[] }>;

/** Create or overwrite a memory slot via the canonical memory API. */
export function saveMemory(payload: {
  scope: string;
  category: string;
  content: string;
  projectId?: string | null;
}): Promise<unknown>;

/** Look up a normalised memory entry by its stable `path` key. */
export function findMemoryEntry(
  sections: MemorySection[] | undefined,
  path: string,
): MemoryFile | null;
