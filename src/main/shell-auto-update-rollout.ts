export type ShellAutoUpdateBuildKind = 'prod' | 'stable' | string | null;

/**
 * Enable stable/prod by default. Explicit false disables either ring; unknown nonempty overrides
 * fail closed.
 */
export function shellAutoUpdateEnabledFor(
  buildKind: ShellAutoUpdateBuildKind,
  override: string | undefined,
): boolean {
  if (buildKind !== 'stable' && buildKind !== 'prod') return false;

  const normalized = override?.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'false') return false;
  if (normalized) return false;

  return true;
}
