export const MODEL_REFRESH_TTL_MS: number;
export type RefreshScope = 'all' | 'minds';
export const REFRESH_SCOPE: Readonly<{ all: 'all'; minds: 'minds' }>;
export function createTrailingThrottle<A = unknown>(
  fn: (arg: A) => unknown,
  ms?: number,
  now?: () => number,
  merge?: (a: A, b: A) => A,
): { call: (arg?: A) => Promise<unknown>; cancel: () => void };
export function createAvailabilityRefresher(opts: {
  fetch: (scope: RefreshScope) => Promise<unknown>;
  apply: (data: unknown) => void;
  ms?: number;
  now?: () => number;
}): { refresh: (scope?: RefreshScope) => Promise<unknown>; cancel: () => void };
export function mergeChangesNothing(prev: Record<string, unknown> | null | undefined, merged: Record<string, unknown>): boolean;
export function noteRefreshScopes(scopes: unknown): void;
export function serverHonorsRefreshScope(scope: RefreshScope): boolean;
