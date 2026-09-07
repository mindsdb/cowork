export function hasFrozenVersions(ids: string[], families?: Record<string, string>): boolean;
export function isFrozenAlias(id: string, families?: Record<string, string>): boolean;
export function isModelLocked(modelEnabled: Record<string, boolean> | undefined, id: string): boolean;
export function isMovingAlias(id: string, families?: Record<string, string>): boolean;
export function orderByFamily(ids: string[], families?: Record<string, string>): string[];
