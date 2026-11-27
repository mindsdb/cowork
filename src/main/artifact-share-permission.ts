import { diagnostic } from '../shared/diagnostics';
import type { ArtifactSharePermission } from '../shared/artifact-share-permission';
import { accountIdFromToken, activeOrgIdFromToken } from './jwt';

export type { ArtifactSharePermission };

/*
 * Whether the signed-in person may share an artifact with everyone in their
 * active organization, as auth's entitlements say. The Desktop Share panel
 * reads it to offer or lock "Everyone at <org>". auth enforces the same
 * permission when a publish first writes an org-wide rule, so this only
 * spares a choice auth would refuse.
 */

export const ARTIFACTS_SHARE_ORG = 'artifacts.share_org';


export interface ArtifactSharePermissionDeps {
  userSuppliedCredential: () => Promise<boolean>;
  accessToken: () => Promise<string | null>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** auth's base URL, already ending in /v1. */
  authServiceUrl: string;
  /** Milliseconds since the epoch; injectable for tests. */
  now?: () => number;
}

export interface ArtifactSharePermissionReader {
  read: () => Promise<ArtifactSharePermission>;
}

// A role change in auth (the permission granted or withdrawn) shows up within
// this long, without a restart or an organization switch.
export const KEEP_ANSWER_MS = 5 * 60 * 1000;

const UNKNOWN: ArtifactSharePermission = Object.freeze({
  sessionCredential: true, known: false, canShareArtifactsOrg: false,
});
const NO_SESSION_CREDENTIAL: ArtifactSharePermission = Object.freeze({
  sessionCredential: false, known: false, canShareArtifactsOrg: false,
});

async function askAuth(deps: ArtifactSharePermissionDeps, token: string): Promise<ArtifactSharePermission> {
  try {
    const res = await deps.fetch(`${deps.authServiceUrl}/entitlements/me/`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'X-MindsDB-Product': 'hub' },
    });
    if (res.status !== 200) {
      diagnostic('main.artifact-share-permission', 'WARNING', 'artifact_share_permission_entitlements_not_ok', { status: res.status });
      return UNKNOWN;
    }
    const body = await res.json();
    // auth answers org_role null with no permissions when it could not
    // resolve the membership: that is "couldn't ask", not "not allowed".
    if (!body || body.org_role == null || !Array.isArray(body.permissions)) return UNKNOWN;
    return Object.freeze({
      sessionCredential: true,
      known: true,
      canShareArtifactsOrg: body.permissions.includes(ARTIFACTS_SHARE_ORG),
    });
  } catch (error) {
    diagnostic('main.artifact-share-permission', 'WARNING', 'artifact_share_permission_could_not_read_entitlements', error);
    return UNKNOWN;
  }
}

/**
 * Reads the permission, keeping a known answer per person and active
 * organization for KEEP_ANSWER_MS: the Share button asks whenever a viewer
 * opens. Only a known answer is kept, so one auth couldn't give is asked
 * again next time.
 */
export function createArtifactSharePermissionReader(deps: ArtifactSharePermissionDeps): ArtifactSharePermissionReader {
  const now = deps.now ?? Date.now;
  let kept: { key: string; answer: ArtifactSharePermission; at: number } | null = null;

  return {
    async read() {
      // A pasted key wins over the session token when publishing, and auth
      // files the rule under the key's organization, which need not be the one
      // the panel would name. Checked on every read, ahead of the kept answer,
      // because a key can be pasted at any time. A check that fails can't
      // prove the session token is used, so it answers as a pasted key.
      try {
        if (await deps.userSuppliedCredential()) return NO_SESSION_CREDENTIAL;
      } catch (error) {
        diagnostic('main.artifact-share-permission', 'WARNING', 'artifact_share_permission_could_not_check_pasted_key', error);
        return NO_SESSION_CREDENTIAL;
      }
      let token: string | null;
      try {
        token = await deps.accessToken();
      } catch (error) {
        diagnostic('main.artifact-share-permission', 'WARNING', 'artifact_share_permission_could_not_read_token', error);
        return UNKNOWN;
      }
      if (!token) return UNKNOWN;
      const sub = accountIdFromToken(token);
      const orgId = activeOrgIdFromToken(token);
      const key = sub && orgId ? JSON.stringify([sub, orgId]) : null;
      if (key && kept?.key === key && now() - kept.at < KEEP_ANSWER_MS) return kept.answer;
      const answer = await askAuth(deps, token);
      if (key && answer.known) kept = { key, answer, at: now() };
      return answer;
    },
  };
}
