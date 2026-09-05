// Body streaming can be followed by more tool calls; only done/error ends working-step activity.
export function isThinkingActive(streamStatus) {
  return streamStatus !== 'done' && streamStatus !== 'error';
}
