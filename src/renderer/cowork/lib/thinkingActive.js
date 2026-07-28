// Whether the working-steps (ThinkingBlock) panel should stay expanded,
// extracted from ChatView so the invariant is unit-testable without
// rendering (ENG-1107).
//
// The panel must stay open for as long as the agent may still be working.
// `streamStatus` flips to 'streaming' the moment the first body-text token
// arrives, but the agent commonly resumes tool calls after that first
// chunk — collapsing on 'streaming' made the panel (and the user) think
// the turn was done mid-task. Only a terminal state — 'done' or 'error' —
// means there's no more work coming.
export function isThinkingActive(streamStatus) {
  return streamStatus !== 'done' && streamStatus !== 'error';
}
