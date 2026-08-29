export const EXPECTED_ORGANIZATION_HEADER: 'X-Cowork-Expected-Organization-Id';
export const ORGANIZATION_RELOAD_HEADER: 'X-Cowork-Organization-Reload';

export function expectedOrganizationHeaders(
  accessToken: string | null | undefined,
): Record<string, string>;
export function handleOrganizationBoundaryResponse(
  response: Response | null | undefined,
): boolean;
export function __resetOrganizationRequestBoundaryForTests(): void;
