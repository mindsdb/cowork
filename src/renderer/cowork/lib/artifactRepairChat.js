// Which chat an "Address with agent" repair runs in.
//
// cowork-server binds a repair handoff to the conversation id the repair record
// was created with: at the end of a turn it only finishes handoffs whose
// `conversationId` matches that turn (`has_queued_agent_repair`). So the target
// chat has to be settled BEFORE the repair exists — resolving it afterwards
// would leave the handoff queued forever, with the viewer stuck on "Agent is
// thinking…".
//
// Inside a chat the answer is trivially "this chat". Opened from the artifacts
// list there is none, so we resume the conversation that created the artifact
// (`originConversationId`, derived server-side from metadata provenance) and
// only mint a fresh one when that chat can't be reached: deleted, another
// tenant's, or an artifact older than provenance.

/** @typedef {{ id: string, task: object|null }} RepairTarget */

// A turn only looks for queued handoffs under its own conversation's project
// (`index_turn_artifacts` scans that project's artifacts root), so a chat that
// has since moved to another project can't finish this repair — the artifact
// isn't there to edit. Compare on whichever identity both sides carry; an
// unknown project is not evidence of a mismatch.
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
