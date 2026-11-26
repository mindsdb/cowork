// What doc the person has open beside a conversation, for its messages.
//
// The doc pane reports its view here (doc, tab, selection); the chat takes it
// as a message in that conversation is sent, and the message carries it
// (through the queue, if it waits) to the response stream, which attaches it
// as `doc_context`: the server hands the agent a <doc-view-context> block.
// The selection, a passage the person picked, goes with one message only. An
// "Edit with agent" request is not kept here: it is put on top as its own
// message is sent, so it cannot ride on whichever message goes next.

const views = new Map();
// The selection each conversation's last message took. The pane reports the
// same one with every view after (a new rev, say) until the person picks
// again or clears it, so it is recognised and left off.
const sent = new Map();

const key = (conversationId) => String(conversationId || '');

const withoutSelection = (view) => {
  const { selection: _taken, ...rest } = view;
  return rest;
};

export function setDocView(conversationId, view) {
  if (!conversationId) return;
  const k = key(conversationId);
  if (!view) views.delete(k);
  else views.set(k, view.selection && view.selection === sent.get(k) ? withoutSelection(view) : view);
}

export function clearDocView(conversationId) {
  views.delete(key(conversationId));
  sent.delete(key(conversationId));
}

/**
 * The `doc_context` for a message going out now: the open doc's view, with
 * the message's own Edit-with-agent `request` on top. A request names the doc
 * it was made in, so a view of another doc (opened since) is left out.
 */
export function docContextFor(conversationId, request = null) {
  const view = conversationId ? views.get(key(conversationId)) : null;
  const base = view && (!request || view.artifactId === request.artifactId) ? view : null;
  const ctx = { ...base, ...request };
  return ctx.artifactId ? ctx : null;
}

/** docContextFor, for the message going out now: its selection is taken, so no later message carries it. */
export function takeDocContext(conversationId, request = null) {
  const ctx = docContextFor(conversationId, request);
  const k = key(conversationId);
  const view = conversationId ? views.get(k) : null;
  if (view?.selection) {
    sent.set(k, view.selection);
    views.set(k, withoutSelection(view));
  }
  return ctx;
}

const QUOTE_MAX = 220;

/**
 * What "Edit with agent" sends about the doc `{ artifactId, projectId }`,
 * asked from the doc beside a chat or from one opened in the library alike:
 * the chat `message`, the passage (on one line and clipped) quoted above what
 * the person asked, or just the request for new writing at an empty spot; and
 * the `docRequest` that goes with it as its doc_context, naming the doc, tab
 * and blocks, so the message need not say which doc it means.
 */
export function askAgentAbout({ artifactId, projectId }, { blockIds, quote, request, tabId, mode }) {
  const short = mode === 'write' ? '' : (quote || '').replace(/\s+/g, ' ').trim();
  const passage = short.length > QUOTE_MAX ? `${short.slice(0, QUOTE_MAX - 1)}…` : short;
  return {
    message: passage ? `> ${passage}\n\n${request}` : request,
    docRequest: { artifactId, projectId, tab: tabId, selection: { blockIds, ...(quote ? { quote } : {}) }, request },
  };
}
