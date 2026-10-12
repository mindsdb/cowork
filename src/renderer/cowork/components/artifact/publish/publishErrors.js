// Publish failures a user can act on, shared by every Share surface: the
// usePublish hook (viewer, rail) and the Artifacts view toast. A module of its
// own so the view does not pull in the hook.
//
// The upload service answers HTTP 409 with this code when the artifact's report
// belongs to another account. cowork-server passes it on as `detail.code`, and
// both request helpers (`req()` in api.js, `request()` in
// artifactWorkspaceApi.js) put it on the thrown error as `code`.
export const OWNED_BY_OTHER_USER_CODE = 'artifact_owned_by_other_user';
export const OWNED_BY_OTHER_USER_MESSAGE = 'This artifact was published by another owner.';

export function isOwnedByOtherUserError(e) {
  return e?.code === OWNED_BY_OTHER_USER_CODE;
}
