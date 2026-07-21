// Schedule ↔ project association helpers.
//
// The server keys a schedule's project by `project_id` (a UUID), serialized
// to the client as `projectId` (cowork-server: schemas/schedules.py
// ScheduleResponse). It does NOT round-trip a project *name* — an earlier
// client sent/read `project`/`projectName`, which the server silently ignored
// on write and never emitted on read, so every schedule showed no project.
// These helpers translate between the server's `projectId` and the display
// name via the loaded `projects` list.

// The server's implicit "no project" bucket. A schedule created without an
// explicit project is stored against this id (services/projects.py
// GENERAL_PROJECT_ID), and it's a real row in `GET /projects/`, so we map it
// back to "no project" for display instead of surfacing a literal "general".
export const GENERAL_PROJECT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Resolve a schedule's `projectId` to a human-readable project name via the
 * projects list. Returns '' (→ the UI shows "—") for: no project, the General
 * bucket, or an id that no longer resolves (e.g. the project was deleted).
 *
 * @param {string|null|undefined} projectId  the schedule's server `projectId`
 * @param {Array<{id: string, name: string}>} projects  loaded projects list
 * @returns {string} the project name, or '' when there is none to show
 */
export function scheduleProjectName(projectId, projects = []) {
  if (!projectId || projectId === GENERAL_PROJECT_ID) return '';
  const match = (projects || []).find((p) => p && p.id === projectId);
  return match ? match.name : '';
}
