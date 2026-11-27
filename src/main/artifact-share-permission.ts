import { diagnostic } from '../shared/diagnostics';

/*
 * Whether the signed-in person may share an artifact with everyone in their
 * active organization, as auth's entitlements say. The Desktop Share panel
 * reads it to offer or lock "Everyone at <org>". auth enforces the same
 * permission when a publish first writes an org-wide rule, so this only
 * spares a choice auth would refuse.
 */

export const ARTIFACTS_SHARE_ORG = 'artifacts.share_org';

export interface ArtifactSharePermission {
  /** The sidecar publishes with the session token, not a key the person pasted. */
  sessionCredential: boolean;
  /** auth answered with the caller's standing in the organization. */
  known: boolean;
  canShareArtifactsOrg: boolean;
}

export interface ArtifactSharePermissionDeps {
  userSuppliedCredential: () => Promise<boolean>;
  accessToken: () => Promise<string | null>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** auth's base URL, already ending in /v1. */
  authServiceUrl: string;
}

const UNKNOWN: ArtifactSharePermission = Object.freeze({
  sessionCredential: true, known: false, canShareArtifactsOrg: false,
});

export async function readArtifactSharePermission(deps: ArtifactSharePermissionDeps): Promise<ArtifactSharePermission> {
  // A pasted key wins over the session token when publishing, and auth files
  // the rule under the key's organization, which need not be the one the
  // panel would name.
  if (await deps.userSuppliedCredential()) {
    return { sessionCredential: false, known: false, canShareArtifactsOrg: false };
  }
  const token = await deps.accessToken();
  if (!token) return UNKNOWN;
  try {
    const res = await deps.fetch(`${deps.authServiceUrl}/entitlements/me/`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'X-MindsDB-Product': 'hub' },
    });
    if (res.status !== 200) {
      diagnostic('main.artifact-share-permission', 'WARNING', 'artifact_share_permission_entitlements_not_ok');
      return UNKNOWN;
    }
    const body = await res.json();
    // auth answers org_role null with no permissions when it could not
    // resolve the membership: that is "couldn't ask", not "not allowed".
    if (!body || body.org_role == null || !Array.isArray(body.permissions)) return UNKNOWN;
    return {
      sessionCredential: true,
      known: true,
      canShareArtifactsOrg: body.permissions.includes(ARTIFACTS_SHARE_ORG),
    };
  } catch (error) {
    diagnostic('main.artifact-share-permission', 'WARNING', 'artifact_share_permission_could_not_read_entitlements', error);
    return UNKNOWN;
  }
}
