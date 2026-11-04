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

export const UNRECORDED_LINK_WARNING = 'This link was shared before Cowork recorded who shares each page, '
  + 'so Cowork can’t update it or take it down. Update shares a new link, and Stop sharing or deleting '
  + 'the artifact leaves this one open to anyone who has it. Ask your administrator to remove it.';

/* The sentence for Stop sharing's result, or '' when the page came down. */
export function stopSharingNotice(result) {
  if (!result || result.takenDown !== false || !result.liveLink) return '';
  if (result.reason === 'other_artifact') {
    return `Nothing was taken down: this artifact’s record pointed at another artifact’s page, ${result.liveLink}.`;
  }
  return `Cowork couldn’t take this page down, so anyone with its link can still open it: ${result.liveLink}. `
    + 'It was shared before Cowork recorded who shares each page. Ask your administrator to remove it.';
}

/* The sentence for a publish or Update that shared a new link in place of
   one with no owner on record, or '' when it kept the link. */
export function republishNotice(result) {
  if (!result?.replacedLink) return '';
  return `Shared at a new link. The old link, ${result.replacedLink}, still shows the earlier version, `
    + 'because it was shared before Cowork recorded who shares each page. Ask your administrator to remove it.';
}
