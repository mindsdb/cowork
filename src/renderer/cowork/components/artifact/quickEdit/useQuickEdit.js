// The viewer's chat bar (ENG-4227): one quick edit at a time, streamed from
// POST .../quick-edits. The server routes the request; a change that only
// needs the artifact's own files is made directly and lands as one new draft
// revision, and anything else goes to the artifact's chat as a normal turn.
//
// The thread holds the user's messages and one reply per message. A reply
// carries the route, the stage the edit is at, and how it ended:
//   applied   → the preview reloads; Undo restores the revision before it
//   agent /
//   escalate  → the message is sent to the artifact's chat (`continueInChat`)
//   failed    → the summary, and "Ask the agent instead" (forceRoute "agent")
//   noop      → nothing changed
// A check the server asks for mid-edit is answered by the open preview, the
// same way an agent turn's check is (lib/artifactCheck).

import { useCallback, useEffect, useRef, useState } from 'react';
import i18n from '../../../../lib/i18n';
import { answerArtifactCheck } from '../../../lib/artifactCheck';
import { restoreArtifactRevision, streamQuickEdit } from '../../../lib/artifactWorkspaceApi';

const tr = (key, vars) => i18n.t(`quickEdit.${key}`, { ns: 'artifacts', ...vars });

// Only this many earlier messages go back as history: enough for "make it
// bigger" to know what "it" is, without resending a long session each time.
const MAX_HISTORY = 12;

let nextId = 0;
const newId = () => `qe-${(nextId += 1)}`;

/**
 * The chat turn a quick edit becomes when it needs the agent: the user's own
 * words, plus which artifact they were looking at, which the bar knew and the
 * chat would not. Agent-facing, so not translated (like launchLiveAppPrompt).
 */
export function quickEditChatPrompt(artifact, message) {
  const name = artifact?.slug || artifact?.title || '';
  return name ? `${message}\n\n(About the artifact \`${name}\`.)` : message;
}

// The two refusals a user can act on, in their words. A stale revision carries
// the current one (same shape as the draft PUT); anything else the server
// refuses with 409 is an edit or a repair already running on this artifact.
export function quickEditErrorMessage(error) {
  if (error?.status === 409) {
    return error?.detail?.currentRevision ? tr('errors.stale') : tr('errors.busy');
  }
  return error?.message || tr('errors.failed');
}

/**
 * @param {object} artifact
 * @param {object} opts
 * @param {boolean} opts.enabled  The bar is shown (canQuickEdit, the user can edit).
 * @param {string | null} opts.headRevisionId  The draft revision on screen.
 * @param {() => Promise<string | null>} opts.resolveConversation  The chat the
 *   artifact belongs to, or null; the server notes an applied edit there.
 * @param {(message: string) => Promise<boolean>} opts.continueInChat  Send the
 *   message to that chat as a normal turn; false when no turn started.
 * @param {() => void | Promise<void>} opts.onApplied  A new revision landed
 *   (applied or undone): reload the workspace and the preview.
 * @param {() => void} [opts.onStale]  The server refused a stale revision.
 */
export function useQuickEdit(artifact, {
  enabled,
  headRevisionId,
  resolveConversation,
  continueInChat,
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
  depsRef.current = { resolveConversation, continueInChat, onApplied, onStale };

  // A closed viewer or another artifact ends the edit and the thread with it.
  // Aborting the request closes the stream; the server keeps or undoes the
  // edit on its own.
  useEffect(() => {
    setMessages([]);
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

    const handOff = async (summary) => {
      patchReply(replyId, { state: 'handing-off', summary });
      let started = false;
      try {
        started = await depsRef.current.continueInChat?.(message);
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
          });
          await depsRef.current.onApplied?.();
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
      }, {
        signal: controller.signal,
        onEvent: (event) => {
          if (!live()) return;
          switch (event?.type) {
            case 'route':
              patchReply(replyId, { route: event.route === 'agent' ? 'agent' : 'edit' });
              break;
            case 'progress':
              patchReply(replyId, { stage: typeof event.stage === 'string' ? event.stage : null });
              break;
            case 'check_request':
              patchReply(replyId, { stage: 'checking' });
              // Not awaited: the server waits for the answer, the stream does not.
              void answerArtifactCheck(event);
              break;
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
  }, [artifact, patchReply]);

  const send = useCallback((text) => run(text), [run]);

  // "Ask the agent instead" after a failed edit: the same message, routed to
  // the agent by the server so the turn is recorded like any other.
  const askAgent = useCallback((replyId) => {
    const reply = messagesRef.current.find((m) => m.id === replyId);
    if (!reply?.request) return Promise.resolve(false);
    return run(reply.request, { forceRoute: 'agent' });
  }, [run]);

  // Undo restores the revision the edit started from, through the same
  // restore the revision history uses. Offered for the newest edit only:
  // restoring an older one would also drop every change made after it.
  const undo = useCallback(async (replyId) => {
    const reply = messagesRef.current.find((m) => m.id === replyId);
    if (!reply?.previousRevisionId || controllerRef.current) return false;
    patchReply(replyId, { undoing: true, undoError: '' });
    try {
      const restored = await restoreArtifactRevision(
        artifact,
        reply.previousRevisionId,
        headRef.current || reply.revisionId,
      );
      if (restored?.revision?.id) headRef.current = restored.revision.id;
      patchReply(replyId, { undoing: false, undone: true });
      await depsRef.current.onApplied?.();
      return true;
    } catch (error) {
      if (error?.status === 409 && error?.detail?.currentRevision) depsRef.current.onStale?.();
      patchReply(replyId, { undoing: false, undoError: quickEditErrorMessage(error) });
      return false;
    }
  }, [artifact, patchReply]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRunning(false);
  }, []);

  // The newest applied edit that is still the head is the one Undo is for.
  const undoableId = [...messages].reverse()
    .find((m) => m.state === 'applied' && !m.undone)?.id || null;

  return { messages, running, send, askAgent, undo, undoableId, cancel };
}

export default useQuickEdit;
