// Row order for the chat rail's Artifacts card: artifacts the current chat
// created come first, then the rest of the project, each in server order
// (latest metadata update first).

import { originConversationId } from './artifactIdentity';

export const RAIL_OTHER_LIMIT = 12;

export function isFromConversation(artifact, conversationId) {
  return !!conversationId && originConversationId(artifact) === String(conversationId);
}

// `currentCount` is where the rest of the project starts. The current chat's
// group is not capped: a limit shared with the rest of the project would push
// this chat's older artifacts out of the rail.
export function railArtifactRows(list, conversationId) {
  if (!Array.isArray(list)) return { rows: [], currentCount: 0 };
  const current = [];
  const others = [];
  for (const artifact of list) {
    if (isFromConversation(artifact, conversationId)) current.push(artifact);
    else if (others.length < RAIL_OTHER_LIMIT) others.push(artifact);
  }
  return { rows: [...current, ...others], currentCount: current.length };
}
