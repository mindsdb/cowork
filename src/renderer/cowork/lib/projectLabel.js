/**
 * display_name is presentation only; legacy rows fall back to name.
 * Use the name slug for addressing, matching and storage keys: display labels need not be unique.
 */
export function projectLabel(project) {
  if (!project) return null;
  return project.display_name || project.name || null;
}

/** Search both the displayed label and filesystem slug so users can find either spelling. */
export function projectMatches(project, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  return (projectLabel(project) || '').toLowerCase().includes(q)
    || (project?.name || '').toLowerCase().includes(q);
}

/** Match both spellings before offering creation, or a typed display label can create a duplicate. */
export function projectNamed(project, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return false;
  return (projectLabel(project) || '').toLowerCase() === q
    || (project?.name || '').toLowerCase() === q;
}

/** Resolve stored slugs to labels; fall back to the slug when the project list is incomplete. */
export function projectLabelByName(projects, name) {
  if (!name) return null;
  const match = (projects || []).find((p) => p?.name === name);
  return projectLabel(match) || name;
}
