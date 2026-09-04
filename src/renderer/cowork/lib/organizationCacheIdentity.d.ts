export function requireWebOrganizationCacheIdentity(): void;
export function pinWebOrganizationCacheIdentity(
  accessToken: string | undefined,
): 'unscoped' | 'unavailable' | 'pinned' | 'matched' | 'changed';
export function storageKeyForOrganizationIdentity(
  baseKey: string,
  epoch: string | null,
): string | null;
export function __resetOrganizationCacheIdentityForTests(): void;
