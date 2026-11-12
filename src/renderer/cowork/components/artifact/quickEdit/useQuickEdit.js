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
 * @param {(prompt: string) => Promise<boolean>} opts.continueInChat  Send the
 *   prompt (quickEditChatPrompt) to that chat as a normal turn; false when no
 *   turn started.
 * @param {(prompt: string) => number} [opts.countInChat]  How many user
 *   messages in that chat already read `prompt`, so the reply can be found
 *   after it (lib/quickEditPrompt chatReplyFor).
 * @param {() => { model: string | null, reasoningEffort: string | null }} [opts.picks]
 *   The model and effort the bar's picker holds, as the request sends them.
 * @param {(opts?: { previewFresh?: boolean }) => void | Promise<void>} opts.onApplied
 *   A new revision landed (applied or undone): reload the workspace and the
 *   preview. `previewFresh` when the edit's own preview check already
 *   reloaded the preview after its last write, so it needs no second reload.
 * @param {() => void} [opts.onStale]  The server refused a stale revision.
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
}) {
  const [messages, setMessages] = useState([]);
  const [running, setRunning] = useState(false);
  const controllerRef = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // The head this bar last saw land. The workspace reload that follows an
  // applied edit is async, and a quick follow-up must not be sent against the
  // revision before it.
  const headRef = useRef(headRevisionId || null);
  useEffect(() => { headRef.current = headRevisionId || null; }, [headRevisionId]);
  const depsRef = useRef({});
  depsRef.current = { resolveConversation, continueInChat, countInChat, picks, onApplied, onStale };

  // A closed viewer or another artifact ends the edit and the thread with it.
  // Aborting the request closes the stream; the server keeps or undoes the
  // edit on its own.
  useEffect(() => {
    // Same state back when there is nothing to clear: a closed viewer mounted
    // in every chat must not render again for nothing.
    setMessages((prev) => (prev.length ? [] : prev));
    setRunning(false);
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [enabled, artifact?.id, artifact?.projectId]);

  const patchReply = useCallback((id, patch) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const run = useCallback(async (text, { forceRoute = null } = {}) => {
    const message = (text || '').trim();
    if (!message || controllerRef.current) return false;
    const history = messagesRef.current
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.summary))
      .map((m) => ({ role: m.role, text: m.role === 'user' ? m.text : m.summary }))
      .slice(-MAX_HISTORY);
    const userId = newId();
    const replyId = newId();
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text: message },
      { id: replyId, role: 'assistant', request: message, state: 'running', route: null, stage: null, summary: '' },
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
        started = await depsRef.current.continueInChat?.(chatPrompt);
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
            editId: typeof done.editId === 'string' && done.editId ? done.editId : null,
            undoable: done.undoable === true && !!done.editId,
          });
          if (lastCheck) await lastCheck;
          await depsRef.current.onApplied?.({ previewFresh });
          break;
        case 'noop':
          patchReply(replyId, { state: 'noop', summary });
          break;
        case 'failed':
          patchReply(replyId, { state: 'failed', summary });
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
    try {
      let conversationId = null;
      try {
        conversationId = (await depsRef.current.resolveConversation?.()) || null;
      } catch {
        conversationId = null;
      }
      if (!live()) return false;
      await streamQuickEdit(artifact, {
        message,
        history,
        expectedRevisionId: headRef.current,
        conversationId,
        forceRoute,
        // Only what the picker holds, by the rule every turn sends picks by;
        // the server falls back to the account's own model and effort.
        ...pickFields(depsRef.current.picks),
      }, {
        signal: controller.signal,
        onEvent: (event) => {
          if (!live()) return;
          switch (event?.type) {
            case 'route':
              patchReply(replyId, {
                route: event.route === 'agent' ? 'agent' : 'edit',
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
      });
      // A hand-off to the chat and the reload after an applied edit both
      // finish before the bar takes the next message.
      if (settling) await settling;
      if (live() && !finished) patchReply(replyId, { state: 'error', error: tr('errors.stopped') });
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') return false;
      if (error?.status === 409 && error?.detail?.currentRevision) depsRef.current.onStale?.();
      patchReply(replyId, { state: 'error', error: quickEditErrorMessage(error) });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setRunning(false);
      }
    }
    return true;
  }, [artifact, direct, patchReply]);

  const send = useCallback((text) => run(text), [run]);

  // "Ask the agent instead" after a failed edit: the same message, routed to
  // the agent by the server so the turn is recorded like any other.
  const askAgent = useCallback((replyId) => {
    const reply = messagesRef.current.find((m) => m.id === replyId);
    if (!reply?.request) return Promise.resolve(false);
    return run(reply.request, { forceRoute: 'agent' });
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
      await depsRef.current.onApplied?.();
      return true;
    } catch (error) {
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

  return { messages, running, direct, send, askAgent, undo, undoableId, cancel };
}

export default useQuickEdit;
