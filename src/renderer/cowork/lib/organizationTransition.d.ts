export interface OrganizationReloadOptions {
  transitionId?: string | null;
  clearTenantState?: boolean;
}

export function prepareForOrganizationReload(options?: OrganizationReloadOptions): void;
export function beginOrganizationTransition(subject: string | null): Promise<string>;
export function releaseOrganizationTransition(id: string): void;
export function reloadForOrganizationTransition(id: string): void;
export function assertOrganizationTransitionClear(): void;
export function __resetOrganizationTransitionForTests(): void;
