/*
 * What to tell a person when Cowork leaves a shared page's link live. A page
 * shared before the deployment recorded who shares each page has no owner on
 * record, so Cowork never sends its id to the publisher again: Stop sharing
 * and deleting the artifact can't take it down, and Update shares a new link
 * beside it. The server says so in each result (cowork-server's
 * UnpublishResult and the publish result's replacedLink) and in the artifact
 * status (linkOwnerRecorded); these turn that into one sentence for the
 * person. The same words fit every deployment, so they name the
 * administrator, not a command.
 */

import i18n from '../../../../lib/i18n';
import { productName } from '../../../../lib/deploymentBrand';

const tr = (key, vars) => i18n.t(`publish.linkLeftLive.${key}`, { ns: 'artifacts', product: productName('Cowork'), ...vars });

/* The English text, for tests; the UI shows unrecordedLinkWarning(). */
export const UNRECORDED_LINK_WARNING = 'This link was shared before Cowork recorded who shares each page, '
  + 'so Cowork can’t update it or take it down. Update shares a new link, and Stop sharing or deleting '
  + 'the artifact leaves this one open to anyone who has it. Ask your administrator to remove it.';

export const unrecordedLinkWarning = () => tr('unrecorded');

/* The sentence for Stop sharing's result, or '' when the page came down. */
export function stopSharingNotice(result) {
  if (!result || result.takenDown !== false || !result.liveLink) return '';
  if (result.reason === 'other_artifact') {
    return tr('otherArtifact', { link: result.liveLink });
  }
  return tr('notTakenDown', { link: result.liveLink });
}

/* The sentence for a publish or Update that shared a new link in place of
   one with no owner on record, or '' when it kept the link. */
export function republishNotice(result) {
  if (!result?.replacedLink) return '';
  return tr('replaced', { link: result.replacedLink });
}
