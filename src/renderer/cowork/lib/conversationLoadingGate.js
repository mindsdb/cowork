// Whether a task's route ('/c/:id') should render its messages, a loading
// state, or an error state — decided from the task record's own
// `messagesStatus`, not just whether the task's metadata exists.
//
// Every sidebar-listed task is already in `tasks` (from the conversation
// list fetch) before its messages ever load, so gating only on "is this id
// known locally" flips to "ready" the instant a task is clicked — long
// before its messages have actually arrived. `messagesStatus` tracks that
// separately: 'loading' until the first page resolves, 'loaded' on
// success, 'unavailable' on a fetch failure. A task built without this
// field at all (a locally-created optimistic task that never needs a
// fetch) is treated as ready — there is nothing to wait for.
//
// 'error' stays scoped to a task that isn't resolved locally AT ALL — a
// cold deep link / scheduled-run open whose loader failed with nothing to
// fall back on. A task already known locally keeps rendering through a
// failed background fetch (the established "a sidebar click during a blip
// keeps rendering" rule): 'unavailable' only has to stop
// the loading state, not replace the chat with an error screen — the task
// falls through to 'ready' and renders whatever messages it already has
// (typically none, same as any other still-empty conversation).
export function resolveConversationLoadState({ resolvedTask, conversationErrorMatches }) {
  if (!resolvedTask) {
    return conversationErrorMatches ? 'error' : 'loading';
  }
  if (resolvedTask.messagesStatus === 'loading') {
    return 'loading';
  }
  return 'ready';
}
