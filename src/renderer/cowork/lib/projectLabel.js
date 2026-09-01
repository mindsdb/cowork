/**
 * The name a person reads for a project.
 *
 * `name` is the slug: the on-disk directory, the URL segment and the lookup
 * key. It comes out of an ASCII allowlist, so a Cyrillic or CJK name sanitized
 * to nothing and the project was created as `untitled-project` (ENG-1676).
 * `display_name` holds what the user actually typed.
 *
 * NULL on every row created before that column existed, which is why the
 * fallback is not optional — without it every pre-existing project would
 * render blank.
 *
 * Never address anything with this. Task and schedule matching, the pinned
 * set, draft keys, the reserved-project check and the rename-in-progress
 * selector all key on `name` and must keep doing so — two projects are allowed
 * to share a display label only because nothing resolves by it.
 */
export function projectLabel(project) {
  if (!project) return null;
  return project.display_name || project.name || null;
}
