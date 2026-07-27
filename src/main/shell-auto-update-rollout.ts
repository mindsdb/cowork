export type ShellAutoUpdateBuildKind = 'prod' | 'stable' | string | null;

/**
 * Stable is the first automatic-update rollout ring. Prod remains opt-in
 * until the stable signed N → N+1 smoke and observation window are complete.
 *
 * An explicit false value is the emergency kill switch. Unknown non-empty
 * values fail closed so a misspelled override cannot accidentally enable it.
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

  return buildKind === 'stable';
}
