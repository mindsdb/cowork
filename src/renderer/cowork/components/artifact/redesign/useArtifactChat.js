// useArtifactChat — inline streaming chat for the redesigned artifact
// workspace's Story-rail composer. Lets the rail talk to the agent
// ("Anton") IN the workspace: the reply streams straight into the rail
// instead of navigating away to the task screen.
//
// This is REAL streaming. It drives the same SSE transport the main
// chat uses (api.js `_streamResponse` via `streamNewSession` /
// `streamMessage`), so a turn sent here runs against the live backend
// and can edit the open artifact. When the turn finishes we call
// `onArtifactChanged` so the host re-fetches versions / canvas.
//
// Contract (see api.js):
//   - `_streamResponse(text, opts)` returns an AbortController and
//     drives callbacks: onChunk(deltaText, conversationId),
//     onDone(conversationId), onError(message). The `response.created`
//     event resolves the conversation id; onChunk's 2nd arg is the
//     live cid for the turn.
//   - Aborting the returned controller tears down the SSE consumer
//     without firing onError (the streamer swallows AbortError).
//
// House rules: React 19 hooks only, no new deps, self-contained and
// defensive — if the stream throws synchronously we surface a readable
// error rather than crashing the workspace.

import { useCallback, useEffect, useRef, useState } from 'react';
import { streamNewSession, streamMessage } from '../../../api.js';

let _seq = 0;
function nextId(prefix) {
  _seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_seq}`;
}

// Seed the conversation id from whatever the host knows about the
// artifact's origin, so a follow-up the user types here continues the
// conversation that produced the artifact rather than starting cold.
function seedConversationId(artifact, initialConversationId) {
  return (
    initialConversationId ||
    artifact?.sourceConversationId ||
    artifact?.conversationId ||
    artifact?.conversation_id ||
    null
  );
}

/**
 * @param {object}   params
 * @param {object}   params.artifact               The open artifact (used to seed cid + project).
 * @param {string}   params.path                   Artifact version path (carried for callers; not required by the stream).
 * @param {string}   params.projectName            Project NAME the turn should run in.
 * @param {string}   [params.initialConversationId] Explicit cid to continue (wins over artifact-derived).
 * @param {Function} [params.onArtifactChanged]    Called after a turn completes so the host re-fetches versions.
 * @returns {{ messages: Array, sending: boolean, error: (string|null), send: Function, conversationId: (string|null) }}
 */
export function useArtifactChat({
  artifact,
  path,
  projectName,
  initialConversationId,
  onArtifactChanged,
} = {}) {
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  // Surfaced for callers that want to label / persist the thread.
  const [conversationId, setConversationId] = useState(() =>
    seedConversationId(artifact, initialConversationId),
  );

  // The conversation id lives in a ref so back-to-back sends CONTINUE
  // the same conversation even before React re-renders with the new
  // state value. We re-seed it when the host swaps in a different
  // artifact / explicit id (but never clobber an id we already learned
  // from a live stream — that would fork the thread mid-session).
  const cidRef = useRef(conversationId);
  const seededFromRef = useRef({ artifact, initialConversationId });
  useEffect(() => {
    const prev = seededFromRef.current;
    if (prev.artifact === artifact && prev.initialConversationId === initialConversationId) {
      return;
    }
    seededFromRef.current = { artifact, initialConversationId };
    const seeded = seedConversationId(artifact, initialConversationId);
    // Only adopt the seed if we don't already hold a live id, or the
    // host explicitly handed us a different one.
    if (!cidRef.current || (seeded && seeded !== cidRef.current)) {
      cidRef.current = seeded || cidRef.current;
      setConversationId(cidRef.current);
    }
  }, [artifact, initialConversationId]);

  // Active SSE controller — tracked so overlapping work can't leak and
  // we can abort on unmount.
  const ctrlRef = useRef(null);
  // Latest callbacks/props read inside `send` without making it a new
  // function on every render (keeps the composer's onSend stable).
  const projectNameRef = useRef(projectName);
  const onArtifactChangedRef = useRef(onArtifactChanged);
  useEffect(() => { projectNameRef.current = projectName; }, [projectName]);

  // Artifact context, prepended to the FIRST message of a conversation so the
  // agent edits THIS artifact's files directly instead of hunting for it
  // (fixes "Anton doesn't know which artifact it's on").
  const artifactCtxRef = useRef('');
  useEffect(() => {
    const folder = typeof path === 'string' ? path.replace(/\/[^/]*$/, '') : '';
    const name =
      artifact?.title ||
      (typeof path === 'string' ? path.split(/[\\/]/).filter(Boolean).pop() : '') ||
      'this artifact';
    artifactCtxRef.current = folder
      ? `[Context — you are editing the artifact "${name}". Its file(s) are in this folder: ${folder}. Apply the requested change by editing the file(s) in that folder directly; do not search for or recreate the artifact.]`
      : '';
  }, [artifact, path]);
  useEffect(() => { onArtifactChangedRef.current = onArtifactChanged; }, [onArtifactChanged]);

  // Guards async callbacks from a stream whose component already
  // unmounted (avoids React state-after-unmount churn).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try { ctrlRef.current?.abort(); } catch { /* already torn down */ }
      ctrlRef.current = null;
    };
  }, []);

  // Append `delta` to a streaming assistant message by id.
  const appendToAssistant = useCallback((assistantId, delta) => {
    if (!delta) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, text: m.text + delta } : m,
      ),
    );
  }, []);

  // Finalize a streaming assistant message: clear `streaming`, and
  // optionally replace its body (used to surface a readable error).
  const finalizeAssistant = useCallback((assistantId, { text } = {}) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? { ...m, streaming: false, ...(text !== undefined ? { text } : {}) }
          : m,
      ),
    );
  }, []);

  /**
   * Send a turn. Pushes a user bubble + a streaming assistant bubble,
   * then streams Anton's reply into the assistant bubble. The same
   * entry point doubles as the programmatic seed for "Fix with AI" —
   * the host just calls `send(preComposedInstruction)`.
   *
   * Ignores empty input and overlapping sends (guarded by `sending`).
   */
  const send = useCallback((rawText) => {
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) return;
    // Guard overlapping sends. Read the ref, not state, so a second
    // synchronous call in the same tick can't slip past.
    if (ctrlRef.current) return;

    const userId = nextId('u');
    const assistantId = nextId('a');
    setError(null);
    setSending(true);
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text, streaming: false },
      { id: assistantId, role: 'assistant', text: '', streaming: true },
    ]);

    const handleError = (message) => {
      ctrlRef.current = null;
      if (!mountedRef.current) return;
      const readable =
        typeof message === 'string' && message.trim()
          ? message.trim()
          : 'something went wrong while streaming the reply.';
      setError(readable);
      setSending(false);
      finalizeAssistant(assistantId, { text: `Anton hit an error: ${readable}` });
    };

    const opts = {
      projectName: projectNameRef.current || undefined,
      onChunk: (delta, cid) => {
        // The streamer hands us the live conversation id on the first
        // events of the turn. Stash it so the NEXT send continues this
        // same conversation via `streamMessage`.
        if (cid && cid !== cidRef.current) {
          cidRef.current = cid;
          if (mountedRef.current) setConversationId(cid);
        }
        if (mountedRef.current) appendToAssistant(assistantId, delta);
      },
      onDone: (cid) => {
        ctrlRef.current = null;
        if (cid && cid !== cidRef.current) {
          cidRef.current = cid;
          if (mountedRef.current) setConversationId(cid);
        }
        if (mountedRef.current) {
          finalizeAssistant(assistantId);
          setSending(false);
        }
        // Tell the host the turn finished so it re-fetches versions —
        // Anton may have edited the artifact during this turn. Fire
        // regardless of mount state: the workspace around this rail can
        // still be alive even if the hook instance was swapped.
        try { onArtifactChangedRef.current?.(); } catch { /* host's problem */ }
      },
      onError: handleError,
    };

    // Continue the known conversation, else start a new one. The id may
    // be a seed from the artifact's origin (sourceConversationId) or a
    // value we learned from a previous send in this session.
    try {
      const cid = cidRef.current;
      if (cid) {
        // Continuation — Anton already has the artifact context from turn 1.
        ctrlRef.current = streamMessage(cid, text, opts);
      } else {
        // First turn — prepend the artifact context to the wire text (the UI
        // message stays the clean user text).
        const wireText = artifactCtxRef.current ? `${artifactCtxRef.current}\n\n${text}` : text;
        ctrlRef.current = streamNewSession(wireText, opts);
      }
      // Defensive: a transport that returned without a controller (or a
      // falsy value) would otherwise leave `sending` stuck true.
      if (!ctrlRef.current) {
        handleError('the chat transport did not start.');
      }
    } catch (err) {
      // `_streamResponse` runs its fetch inside an async IIFE, so a
      // throw here is unexpected — but house rules say surface it
      // readably instead of crashing the workspace.
      handleError(err?.message || String(err));
    }
  }, [appendToAssistant, finalizeAssistant]);

  return { messages, sending, error, send, conversationId };
}

export default useArtifactChat;
