// The viewer's chat bar (ENG-4227): one quick edit at a time, streamed from
// POST .../quick-edits. The server routes the request; a change that only
// needs the artifact's own files is made directly and lands as one new draft
// revision, and anything else goes to the artifact's chat as a normal turn.
//
// The thread holds the user's messages and one reply per message. A reply
// carries the route, the stage the edit is at, and how it ended:
//   applied   → the preview reloads; Undo (when the server kept one) puts
//               back every file the edit changed
//   agent /
//   escalate  → the message is sent to the artifact's chat (`continueInChat`)
//   failed    → the summary, and "Ask the agent instead" (forceRoute "agent")
//   noop      → nothing changed
//   reply     → a short answer to a question or a hello, shown in the bar;
//               nothing changed, so no Undo (ENG-4455)
// A check the server asks for mid-edit is answered by the open preview, the
// same way an agent turn's check is (lib/artifactCheck).
//
// With `direct` false (capabilities.quickEditDirect: no decisions model serves
// the user's provider) the server would only answer `done{status:"agent"}`, so
// the bar skips the request and sends every message straight to the chat.

import { useCallback, useEffect, useRef, useState } from 'react';
import i18n from '../../../../lib/i18n';
import { answerArtifactCheck } from '../../../lib/artifactCheck';
import { streamQuickEdit, undoQuickEdit } from '../../../lib/artifactWorkspaceApi';
import { fileToBase64 } from '../../../lib/imageAttachments';
import { quickEditChatPrompt } from '../../../lib/quickEditPrompt';

export { quickEditChatPrompt };

const tr = (key, vars) => i18n.t(`quickEdit.${key}`, { ns: 'artifacts', ...vars });

// Only this many earlier messages go back as history: enough for "make it
// bigger" to know what "it" is, without resending a long session each time.
const MAX_HISTORY = 12;

function pickFields(picks) {
  let picked = null;
  try { picked = picks?.() || null; } catch { picked = null; }
  return { model: picked?.model ?? null, reasoningEffort: picked?.reasoningEffort ?? null };
}

let nextId = 0;
const newId = () => `qe-${(nextId += 1)}`;

// The server's refusals, in the user's words. Its 409s name a `reason`; a
// stale revision has none and carries the current one instead (the draft
// PUT's shape).
export function quickEditErrorMessage(error) {
  const detail = error?.detail && typeof error.detail === 'object' ? error.detail : null;
  if (error?.status === 409) {
    if (detail?.currentRevision) return tr('errors.stale');
    switch (detail?.reason) {
      case 'files_changed': {
        const paths = Array.isArray(detail.paths) ? detail.paths.filter(Boolean) : [];
        return paths.length
          ? tr('errors.filesChangedNamed', { paths: paths.slice(0, 3).join(', ') })
          : tr('errors.filesChanged');
      }
      case 'already_undone':
        return tr('errors.alreadyUndone');
      case 'repair_pending':
        return tr('errors.repairPending');
      default:
        return tr('errors.busy');
    }
  }
  return error?.message || tr('errors.failed');
}

// The head a stale 409 names (the draft PUT's shape: the revision, or its id),
// or null for any other error.
function staleRevisionId(error) {
  if (error?.status !== 409) return null;
  const current = error?.detail?.currentRevision;
  if (typeof current === 'string') return current || null;
  return typeof current?.id === 'string' && current.id ? current.id : null;
}

function undoErrorMessage(error) {
  // Only the last few undos are kept; an older one answers 404.
  if (error?.status === 404) return tr('errors.undoGone');
  return quickEditErrorMessage(error);
}

/**
 * @param {object} artifact
 * @param {object} opts
 * @param {boolean} opts.enabled  The bar is shown (canQuickEdit, the user can edit).
 * @param {boolean} [opts.direct]  The server can edit directly (quickEditDirect);
 *   false sends every message to the chat.
 * @param {string | null} opts.headRevisionId  The draft revision on screen.
 * @param {() => Promise<string | null>} opts.resolveConversation  The chat the
 *   artifact belongs to, or null; the server notes an applied edit there.
 * @param {(prompt: string, images: object[], extra: { recount: (count: number) => void }) => Promise<boolean>} opts.continueInChat
 *   Send the prompt (quickEditChatPrompt) to that chat as a normal turn, with
 *   the message's images as pending attachments; false when no turn started.
 *   `recount` corrects countInChat's answer once the chat is known.
 * @param {(prompt: string) => number} [opts.countInChat]  How many user
 *   messages in that chat already read `prompt`, so the reply can be found
 *   after it (lib/quickEditPrompt chatReplyFor).
 * @param {() => { model: string | null, reasoningEffort: string | null }} [opts.picks]
 *   The model and effort the bar's picker holds, as the request sends them.
 * @param {(opts?: { previewFresh?: boolean, edit?: { replyId: string, revisionId: string | null, previousRevisionId: string | null } }) => void | Promise<void>} opts.onApplied
 *   A new revision landed (applied or undone): reload the workspace and the
 *   preview. `previewFresh` when the edit's own preview check already
 *   reloaded the preview after its last write, so it needs no second reload.
 *   `edit` names the applied edit (absent after an undo): its reply and the
 *   revisions before and after it.
 * @param {() => void} [opts.onStale]  The server refused a stale revision.
 * @param {(threadId: string) => void} [opts.onThreadAddressed]  An edit made for a comment was applied.
 * @param {(threadId: string) => void} [opts.onThreadReopened]  That edit was undone.
 */
export function useQuickEdit(artifact, {
  enabled,
  direct = true,
  headRevisionId,
  resolveConversation,
  continueInChat,
  countInChat,
  picks,
  onApplied,
  onStale,
  onThreadAddressed,
  onThreadReopened,
}) {
  const [messages, setMessages] = useState([]);
  const [running, setRunning] = useState(false);
  // Messages sent while one runs (the bar's own, or comments sent to the
  // agent from the inbox) wait here and go one at a time, oldest first, as a
  // task chat queues them (ENG-4383).
  const [queue, setQueue] = useState([]);
  const queueRef = useRef(queue);
  const controllerRef = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // The head this bar last saw land. The workspace reload that follows an
  // applied edit is async, and a quick follow-up must not be sent against the
  // revision before it.
  const headRef = useRef(headRevisionId || null);
  useEffect(() => { headRef.current = headRevisionId || null; }, [headRevisionId]);
  const depsRef = useRef({});
  depsRef.current = {
    resolveConversation, continueInChat, countInChat, picks, onApplied, onStale, onThreadAddressed, onThreadReopened,
  };

  // A closed viewer or another artifact ends the edit and the thread with it.
  // Aborting the request closes the stream; the server keeps or undoes the
  // edit on its own.
  useEffect(() => {
    // Same state back when there is nothing to clear: a closed viewer mounted
    // in every chat must not render again for nothing.
    setMessages((prev) => (prev.length ? [] : prev));
    queueRef.current = [];
    setQueue((prev) => (prev.length ? [] : prev));
    setRunning(false);
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [enabled, artifact?.id, artifact?.projectId]);

  const patchReply = useCallback((id, patch) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  // `images`: pending image attachments (lib/imageAttachments). They go to
  // the editor's model with the request, and to the chat on a hand-off.
  // `threadId`: the comment this message addresses, for the inbox's state.
  const run = useCallback(async (text, {
    forceRoute = null, expectedRevisionId = null, images = [], threadId = null,
  } = {}) => {
    const message = (text || '').trim();
    if (!message || controllerRef.current) return false;
    // A save just made before sending names its revision: the workspace
    // reload that will report it has not landed yet.
    if (expectedRevisionId) headRef.current = expectedRevisionId;
    const history = messagesRef.current
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.summary))
      .map((m) => ({ role: m.role, text: m.role === 'user' ? m.text : m.summary }))
      .slice(-MAX_HISTORY);
    const userId = newId();
    const replyId = newId();
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text: message, images, threadId },
      { id: replyId, role: 'assistant', request: message, images, threadId, state: 'running', route: null, stage: null, summary: '' },
    ]);
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    const live = () => controllerRef.current === controller && !controller.signal.aborted;
    let finished = false;
    // Whether the open preview shows the edit's last write: a preview check
    // that ran (reloaded and looked) since the editor last wrote.
    let previewFresh = false;
    let writes = 0;
    let lastCheck = null;

    const handOff = async (summary) => {
      const chatPrompt = quickEditChatPrompt(artifact, message);
      let chatBefore = 0;
      try { chatBefore = depsRef.current.countInChat?.(chatPrompt) || 0; } catch { chatBefore = 0; }
      patchReply(replyId, { state: 'handing-off', summary, chatPrompt, chatBefore });
      let started = false;
      try {
        started = await depsRef.current.continueInChat?.(chatPrompt, images, {
          // The chat it goes to may hold earlier copies the count above did
          // not see (a chat not on screen, ENG-4560).
          recount: (count) => patchReply(replyId, { chatBefore: Number(count) || 0 }),
        });
      } catch {
        started = false;
      }
      patchReply(replyId, started === false || started === undefined
        ? { state: 'error', error: tr('errors.chatFailed') }
        : { state: 'chat' });
    };

    const settle = async (done) => {
      const summary = typeof done.summary === 'string' ? done.summary : '';
      switch (done.status) {
        case 'applied':
          if (done.revisionId) headRef.current = done.revisionId;
          patchReply(replyId, {
            state: 'applied',
            summary,
            revisionId: done.revisionId || null,
            previousRevisionId: done.previousRevisionId || null,
            editId: typeof done.editId === 'string' && done.editId ? done.editId : null,
            undoable: done.undoable === true && !!done.editId,
          });
          if (lastCheck) await lastCheck;
          // A comment sent here is addressed once its fix is applied.
          if (threadId) depsRef.current.onThreadAddressed?.(threadId);
          await depsRef.current.onApplied?.({
            previewFresh,
            edit: { replyId, revisionId: done.revisionId || null, previousRevisionId: done.previousRevisionId || null },
          });
          break;
        case 'noop':
          patchReply(replyId, { state: 'noop', summary });
          break;
        case 'failed':
          patchReply(replyId, { state: 'failed', summary });
          break;
        case 'reply':
          // An answer with no text is no answer: the chat takes the message.
          if (summary.trim()) patchReply(replyId, { state: 'replied', summary });
          else await handOff('');
          break;
        case 'agent':
        case 'escalate':
          await handOff(summary);
          break;
        default:
          patchReply(replyId, { state: 'error', error: summary || tr('errors.failed') });
      }
    };

    let settling = null;
    // Chat only: nothing for the server to route, so no route or stages.
    if (!direct && !forceRoute) {
      try {
        await handOff('');
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setRunning(false);
        }
      }
      return true;
    }
    // Set once the request was resent after a stale refusal (and a reload).
    let reloadedForStale = false;
    try {
      let conversationId = null;
      try {
        conversationId = (await depsRef.current.resolveConversation?.()) || null;
      } catch {
        conversationId = null;
      }
      const encoded = await Promise.all(images.map(async (image) => ({
        name: image.name || null,
        data: await fileToBase64(image.pendingFile),
      })));
      if (!live()) return false;
      const body = {
        message,
        ...(encoded.length ? { images: encoded } : {}),
        history,
        conversationId,
        forceRoute,
        // The bar shows an answer (done status `reply`); a server only routes
        // a message to one when the app says so.
        allowReply: true,
        // Only what the picker holds, by the rule every turn sends picks by;
        // the server falls back to the account's own model and effort.
        ...pickFields(depsRef.current.picks),
      };
      let streamed = false;
      const handlers = {
        signal: controller.signal,
        onEvent: (event) => {
          if (!live()) return;
          streamed = true;
          switch (event?.type) {
            case 'route':
              patchReply(replyId, {
                route: event.route === 'agent' || event.route === 'reply' ? event.route : 'edit',
                routeReason: typeof event.reason === 'string' ? event.reason : null,
              });
              break;
            case 'progress':
              if (event.stage === 'writing' || event.stage === 'fixing') { writes += 1; previewFresh = false; }
              patchReply(replyId, { stage: typeof event.stage === 'string' ? event.stage : null });
              break;
            case 'check_request': {
              patchReply(replyId, { stage: 'checking' });
              // Not awaited: the server waits for the answer, the stream does not.
              const writesAtCheck = writes;
              lastCheck = answerArtifactCheck(event).then((status) => {
                // Only a check that reloaded and saw the latest write counts.
                if (writes === writesAtCheck && (status === 'passed' || status === 'failed')) previewFresh = true;
              });
              break;
            }
            case 'done':
              finished = true;
              settling = settle(event);
              break;
            case 'error':
              finished = true;
              patchReply(replyId, { state: 'error', error: event.message || tr('errors.failed') });
              break;
            default:
              break;
          }
        },
      };
      const stream = () => streamQuickEdit(artifact, { ...body, expectedRevisionId: headRef.current }, handlers);
      try {
        await stream();
      } catch (error) {
        // Sent against a revision that is no longer the head (another tab, an
        // agent turn, a save): refused before anything ran. Reload, take the
        // server's head, and send the same request once more; a second
        // refusal is shown as before.
        const current = staleRevisionId(error);
        if (!current || streamed || !live()) throw error;
        depsRef.current.onStale?.();
        reloadedForStale = true;
        headRef.current = current;
        await stream();
      }
      // A hand-off to the chat and the reload after an applied edit both
      // finish before the bar takes the next message.
      if (settling) await settling;
      if (live() && !finished) patchReply(replyId, { state: 'error', error: tr('errors.stopped') });
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') return false;
      // Reloaded already when the request was resent.
      if (error?.status === 409 && error?.detail?.currentRevision && !reloadedForStale) depsRef.current.onStale?.();
      patchReply(replyId, { state: 'error', error: quickEditErrorMessage(error) });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setRunning(false);
      }
    }
    return true;
  }, [artifact, direct, patchReply]);

  // `options.expectedRevisionId`: the revision a save made just before sending;
  // `options.images`: the bar's pending images.
  // While a message runs, a new one joins the queue; it starts when the
  // running one ends. `options.threadId` marks a comment sent to the agent.
  const send = useCallback((text, options) => {
    const message = (text || '').trim();
    if (!message) return Promise.resolve(false);
    const runOptions = {
      expectedRevisionId: options?.expectedRevisionId || null,
      images: options?.images || [],
      threadId: options?.threadId || null,
    };
    if (controllerRef.current || queueRef.current.length) {
      const entry = { id: newId(), text: message, ...runOptions };
      queueRef.current = [...queueRef.current, entry];
      setQueue(queueRef.current);
      return Promise.resolve(true);
    }
    return run(message, runOptions);
  }, [run]);

  const removeQueued = useCallback((id) => {
    queueRef.current = queueRef.current.filter((entry) => entry.id !== id);
    setQueue(queueRef.current);
  }, []);

  // The next queued message starts once nothing runs. Its revision is the
  // head the last edit left, not the one it was queued against.
  useEffect(() => {
    if (running || controllerRef.current || !queue.length) return;
    const [next, ...rest] = queue;
    queueRef.current = rest;
    setQueue(rest);
    void run(next.text, { images: next.images, threadId: next.threadId });
  }, [queue, run, running]);

  // "Ask the agent instead" after a failed edit: the same message, routed to
  // the agent by the server so the turn is recorded like any other.
  const askAgent = useCallback((replyId) => {
    const reply = messagesRef.current.find((m) => m.id === replyId);
    if (!reply?.request) return Promise.resolve(false);
    // Still the comment's message: the chat's answer can resolve it.
    return run(reply.request, { forceRoute: 'agent', images: reply.images || [], threadId: reply.threadId || null });
  }, [run]);

  // Undo puts back every file the edit changed and removes those it created
  // (POST .../quick-edits/{editId}/undo). The server refuses it once a file
  // was changed again, so it is offered for the newest edit only.
  const undo = useCallback(async (replyId) => {
    const reply = messagesRef.current.find((m) => m.id === replyId);
    if (!reply?.undoable || !reply.editId || controllerRef.current) return false;
    patchReply(replyId, { undoing: true, undoError: '' });
    try {
      const undone = await undoQuickEdit(artifact, reply.editId, {
        expectedRevisionId: reply.revisionId || null,
      });
      if (undone?.revision?.id) headRef.current = undone.revision.id;
      patchReply(replyId, { undoing: false, undone: true });
      // Its comment is open again: the fix it got is gone.
      if (reply.threadId) depsRef.current.onThreadReopened?.(reply.threadId);
      await depsRef.current.onApplied?.();
      return true;
    } catch (error) {
      // Not retried when stale, unlike a request: the head moved past the
      // revision this edit made, so it is no longer the newest edit.
      if (error?.status === 409 && error?.detail?.currentRevision) depsRef.current.onStale?.();
      // Nothing left to undo here: say why and stop offering it.
      const settled = error?.status === 404 || error?.detail?.reason === 'already_undone';
      patchReply(replyId, { undoing: false, undoError: undoErrorMessage(error), ...(settled ? { undoable: false } : {}) });
      return false;
    }
  }, [artifact, patchReply]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRunning(false);
  }, []);

  // Undo is for the newest applied edit, when the server kept its undo.
  const newestApplied = [...messages].reverse().find((m) => m.state === 'applied' && !m.undone);
  const undoableId = newestApplied?.undoable ? newestApplied.id : null;

  // The comment the running message addresses, and those waiting their turn.
  const runningThreadId = running
    ? ([...messages].reverse().find((m) => m.role === 'assistant')?.threadId || null)
    : null;
  const queuedThreadIds = queue.map((entry) => entry.threadId).filter(Boolean);

  return {
    messages, running, direct, send, askAgent, undo, undoableId, cancel,
    queue, removeQueued, runningThreadId, queuedThreadIds,
  };
}

export default useQuickEdit;
