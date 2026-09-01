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

/**
 * Does this project answer to `query`?
 *
 * Matches the label AND the slug, deliberately. Searching only the slug loses
 * the project the user can see (`Мій` finds nothing when the slug is
 * `untitled-project-2`); searching only the label loses the one they may know
 * from the folder on disk. Matching both can only ever return more, never
 * fewer, so no existing search result disappears (ENG-1676).
 */
export function projectMatches(project, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  return (projectLabel(project) || '').toLowerCase().includes(q)
    || (project?.name || '').toLowerCase().includes(q);
}

/**
 * Does `query` exactly name this project, by either spelling?
 *
 * Gates the "create a new project" affordance in the picker and the move
 * dialog. Matching only the slug would offer to create a duplicate of a
 * project the user just typed the visible name of.
 */
export function projectNamed(project, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return false;
  return (projectLabel(project) || '').toLowerCase() === q
    || (project?.name || '').toLowerCase() === q;
}
