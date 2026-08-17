export type ShellAutoUpdateBuildKind = 'prod' | 'stable' | string | null;

/**
 * Both stable and prod auto-update by default. Stable led the rollout; prod
 * followed once the signed N → N+1 swap-on-relaunch smoke passed (macOS and
 * Windows) and its observation window closed.
 *
 * An explicit false value is the emergency kill switch (either ring). Unknown
 * non-empty values fail closed so a misspelled override cannot accidentally
 * enable it.
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
