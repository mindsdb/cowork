// Publish failures a user can act on, shared by every Share surface: the
// usePublish hook (viewer, rail) and the Artifacts view toast. A module of its
// own so the view does not pull in the hook.

import { PUBLISH_SHELL_TOO_OLD_CODE, SHARE_ORG_REQUIRED_CODE } from '../../../lib/sharingContract';
import i18n from '../../../../lib/i18n';

// The upload service answers HTTP 409 with this code when the artifact's report
// belongs to another account. cowork-server passes it on as `detail.code`, and
// both request helpers (`req()` in api.js, `request()` in
// artifactWorkspaceApi.js) put it on the thrown error as `code`.
export const OWNED_BY_OTHER_USER_CODE = 'artifact_owned_by_other_user';
export const OWNED_BY_OTHER_USER_MESSAGE = 'This artifact was published by another owner.';

export function isOwnedByOtherUserError(e) {
  return e?.code === OWNED_BY_OTHER_USER_CODE;
}

/* cowork-server answers HTTP 403 with SHARE_ORG_REQUIRED_CODE when a save
   would newly share the artifact with everyone in the organization and the
   person lacks artifacts.share_org: from its own check before anything
   publishes, or from MindsHub's refusal of the rule. The body's string
   `detail` is the reason, which both request helpers make the thrown error's
   message. Asking again gets the same answer. */
export function isShareOrgRequiredError(e) {
  return e?.code === SHARE_ORG_REQUIRED_CODE;
}

// A full-stack publish would send credentials of connections the person
// hasn't approved; `detail.pending` lists them.
export const DATASOURCE_APPROVAL_REQUIRED_CODE = 'datasource_approval_required';

export function isDatasourceApprovalError(e) {
  return e?.code === DATASOURCE_APPROVAL_REQUIRED_CODE;
}

export function pendingDatasourcesFromError(e) {
  const pending = e?.body?.detail?.pending;
  return Array.isArray(pending) ? pending : [];
}

/** Connections as the server labels them, for a sentence. */
export function datasourceList(items) {
  return items.map((d) => d.label || `${d.engine}/${d.name}`).join(', ');
}

/** The warning for an app published without some connections' credentials, or ''. */
export function unapprovedDatasourcesNotice(r) {
  const items = Array.isArray(r?.unapprovedDatasources) ? r.unapprovedDatasources : [];
  return items.length
    ? i18n.t('publish.datasources.unapproved', { ns: 'artifacts', list: datasourceList(items) })
    : '';
}

/**
 * The sentence a refused publish or update shows as it is, with no "Sharing
 * failed:" in front: the owner message, or the reason a share with everyone
 * was refused. Asking again gets the same answer to either, so a surface
 * that shows it offers no Try again. Null for any other failure, which the
 * caller words itself.
 *
 * @param {unknown} e
 * @returns {string | null}
 */
/**
 * Why a save failed, for analytics: one of the two refusals, or 'error'.
 *
 * @param {unknown} e
 * @returns {'share_org_not_allowed' | 'owned_by_other' | 'error'}
 */
export function publishFailureReason(e) {
  if (isShareOrgRequiredError(e)) return 'share_org_not_allowed';
  if (isOwnedByOtherUserError(e)) return 'owned_by_other';
  return 'error';
}

export function publishRefusalMessage(e) {
  if (isOwnedByOtherUserError(e)) return i18n.t('publish.ownedByOther', { ns: 'artifacts' });
  if (isShareOrgRequiredError(e)) return e.message;
  if (isDatasourceApprovalError(e)) return i18n.t('publish.datasources.review', { ns: 'artifacts' });
  if (e?.code === PUBLISH_SHELL_TOO_OLD_CODE) return i18n.t('publish.datasources.updateApp', { ns: 'artifacts' });
  return null;
}
