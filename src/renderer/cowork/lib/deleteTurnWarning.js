// What the delete-exchange confirm dialog promises.
//
// `DELETE /conversations/{id}/turns/{n}` truncates: it removes the chosen
// exchange AND everything below it, because a later turn can refer back to the
// one being cut and the history sent to the model has to stay coherent. The
// dialog used to name only the chosen question and reply, so a user deleting
// mid-conversation lost work the prompt never mentioned.
//
// Counting here is a promise about the request, not about the cut. The server
// resolves the index its own way, so the numbers are a floor — see the comment
// on `turnsAfter`.

// User rows the transcript shows. `_streaming` is the in-flight placeholder,
// which ChatView filters before it indexes turns, so it cannot be one.
const isTurn = (m) => m?.role === 'user';

// Exchanges below the one being deleted, all of which go with it.
//
// `turnIndex` is the 0-based user-input ordinal ChatView hands the delete
// button. The server counts visible ASSISTANT rows instead, and a turn that was
// stopped before any answer has none — so the server can cut one turn earlier
// than asked and take more than this. Under-promising is the safe direction for
// a confirm dialog; the drift itself is tracked separately.
export function turnsAfter(messages, turnIndex) {
  const total = (Array.isArray(messages) ? messages : []).filter(isTurn).length;
  if (!Number.isFinite(turnIndex) || turnIndex < 0) return 0;
  return Math.max(0, total - turnIndex - 1);
}

export function deleteTurnTitle(trailing) {
  return trailing > 0 ? 'Delete this exchange and everything after it?' : 'Delete this exchange?';
}

export function deleteTurnMessage(trailing, agentLabel = 'the agent') {
  const head = `This removes both your question and ${agentLabel}'s response from the conversation.`;
  const tail = trailing > 0
    ? ` The ${trailing === 1 ? 'exchange' : `${trailing} exchanges`} below it will be removed too — a later turn can refer back to this one, so the conversation is cut here rather than stitched back together.`
    : '';
  return `${head}${tail} Any scratchpad cells, artifacts, or memory writes produced as part of ${trailing > 0 ? 'these turns' : 'this turn'} stay on disk. This can't be undone.`;
}
