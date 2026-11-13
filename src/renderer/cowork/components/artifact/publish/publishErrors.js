// Publish failures a user can act on, shared by every Share surface: the
// usePublish hook (viewer, rail) and the Artifacts view toast. A module of its
// own so the view does not pull in the hook.

import { SHARE_ORG_REQUIRED_CODE } from '../../../lib/sharingContract';
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
export function publishRefusalMessage(e) {
  if (isOwnedByOtherUserError(e)) return i18n.t('publish.ownedByOther', { ns: 'artifacts' });
  if (isShareOrgRequiredError(e)) return e.message;
  return null;
}
