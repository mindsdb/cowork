// Whether the reader of an artifact's review entry is the one to switch its
// draft comments on (enableDraftComments). A reviewer's GET is the grant
// itself. Absent capabilities mean an older server that only speaks the POST,
// so it goes ahead: assuming reviewer there would silently drop the owner's
// own comments.
export function draftCommentsNeedProvision(review) {
  const capabilities = review?.capabilities;
  return capabilities ? capabilities.canEdit !== false : true;
}
