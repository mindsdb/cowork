// Resolve the target chat BEFORE creating a repair: cowork-server finishes handoffs only for the
// bound conversationId.
// Prefer the artifact's origin chat when reachable; otherwise the caller creates a new chat.

/** @typedef {{ id: string, task: object|null }} RepairTarget */

// Turns scan only their conversation's project for repairs; a moved chat cannot finish the original
// artifact's repair.
// Reject known project mismatches, but do not infer a mismatch from missing identity.
function sameProject(artifact, task) {
  const artifactId = String(artifact?.projectId || '');
  const taskId = String(task?.projectId || '');
  if (artifactId && taskId) return artifactId === taskId;
  const artifactName = String(artifact?.projectName || '');
  const taskName = String(task?.projectName || '');
  if (artifactName && taskName) return artifactName === taskName;
  return true;
}

/**
 * Resolve the existing chat a repair should run in.
 *
 * Returns an empty id when there is none — the caller then falls back to a new
 * conversation. `task` is the conversation record the send path needs (the turn
 * is appended through it), fetched when the chat isn't in the local list.
 *
 * @param {object} params
 * @param {object} params.artifact card carrying `originConversationId`
 * @param {Array<object>} params.tasks locally known conversations
 * @param {(id: string) => Promise<{status: string, task?: object}>} params.fetchConversation
 * @returns {Promise<RepairTarget>}
 */
export async function resolveRepairConversation({ artifact, tasks = [], fetchConversation }) {
  const originId = String(artifact?.originConversationId || '');
  if (!originId) return { id: '', task: null };
  const local = (tasks || []).find((task) => String(task?.id || '') === originId);
  if (local) return sameProject(artifact, local) ? { id: originId, task: local } : { id: '', task: null };
  // Absent from the recents list doesn't mean gone — that fetch is capped, so
  // any older origin chat is missing from it. Ask the server before giving up.
  let result;
  try {
    result = await fetchConversation?.(originId);
  } catch {
    result = null;
  }
  // A transient failure counts as "gone" on purpose: a new chat is a worse
  // chat, but a repair bound to a conversation we never open would never run.
  if (result?.status !== 'ok' || !result.task) return { id: '', task: null };
  if (!sameProject(artifact, result.task)) return { id: '', task: null };
  return { id: originId, task: result.task };
}
