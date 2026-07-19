import { useCallback, useEffect, useRef, useState } from 'react';
import {
  streamMessage,
  allocateConversationId,
  renameConversation,
  cancelResponse,
  fetchSession,
} from '../../api';
import { initialStreamState, reduceStream } from '../../lib/responseStreamAdapter';

// The dock conversation survives route unmounts: the id lives in
// sessionStorage so remounting the Browser route RESUMES the same
// conversation (and reloads its transcript from the server) instead of
// leaking a fresh conversation per mount.
const CONV_KEY = 'browser.agentConvId';

function loadSavedConvId() {
  try { return window.sessionStorage.getItem(CONV_KEY) || null; } catch { return null; }
}
function saveConvId(id) {
  try {
    if (id) window.sessionStorage.setItem(CONV_KEY, id);
  } catch {}
}

// Self-contained chat plumbing for the Browser Agent dock. Mirrors the
// minimal flow App.jsx uses for a send: one conversation (titled "Browser"
// so it's recognizable in Recents), streamMessage with SSE events folded
// through responseStreamAdapter into steps + body text. State lives
// entirely in this hook — nothing is lifted into App.jsx.
export function useBrowserAgent() {
  // Finalized turns: { role: 'user' | 'assistant', content, steps?, startedAt?, isError? }
  const [messages, setMessages] = useState([]);
  // Live turn while streaming: { bodyText, steps, startedAt, status } or null.
  const [live, setLive] = useState(null);
  const [streaming, setStreaming] = useState(false);

  // Seed from the saved id on first render (useRef keeps only the first
  // value; the extra sessionStorage reads on later renders are no-ops).
  const convIdRef = useRef(loadSavedConvId());
  const renamedRef = useRef(false);
  const ctrlRef = useRef(null);
  const streamStateRef = useRef(null);
  const mountedRef = useRef(true);
  const msgIdRef = useRef(0);
  const nextMsgId = () => `bm-${++msgIdRef.current}`;

  // Restore the previous session's transcript once on mount. The server
  // owns the message log (same /conversations/{id}/items fetch App.jsx
  // uses when reopening a task), so a route round-trip replays it here.
  useEffect(() => {
    const savedId = convIdRef.current;
    if (!savedId) return undefined;
    let alive = true;
    fetchSession(savedId)
      .then((task) => {
        if (!alive || !task?.messages?.length) return;
        // Don't clobber a send that fired while the fetch was in flight.
        setMessages((prev) => (prev.length > 0 ? prev : task.messages
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'error'))
          .map((m) => ({
            id: nextMsgId(),
            role: m.role === 'error' ? 'assistant' : m.role,
            content: typeof m.content === 'string' ? m.content : '',
            steps: Array.isArray(m.steps) ? m.steps : undefined,
            startedAt: m.startedAt || null,
            isError: m.role === 'error' || undefined,
          }))));
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
    const ctrl = ctrlRef.current;
    ctrlRef.current = null;
    try { ctrl?.abort(); } catch {}
    // abort() only tears down the SSE consumer — the server-side run
    // keeps producing. Signal the cancel so leaving the route mid-stream
    // doesn't orphan the run (idempotent on an already-finished turn).
    if (ctrl && convIdRef.current) cancelResponse(convIdRef.current).catch(() => {});
  }, []);

  const adoptConversationId = useCallback((sid) => {
    if (!sid) return;
    if (convIdRef.current !== sid) {
      // The server normally adopts the pre-allocated UUID (ENG-264), but
      // if it answers with a different id, track THAT one — rename/cancel
      // must target the conversation the server actually owns.
      convIdRef.current = sid;
      saveConvId(sid);
    }
    if (!renamedRef.current) {
      renamedRef.current = true;
      renameConversation(sid, 'Browser').catch(() => {});
    }
  }, []);

  const send = useCallback((text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed || ctrlRef.current) return;
    // Pre-allocate so stop() has a conversation to cancel from the very
    // first event; the server adopts client-supplied UUIDs (ENG-264).
    if (!convIdRef.current) {
      convIdRef.current = allocateConversationId();
      saveConvId(convIdRef.current);
    }

    setMessages((prev) => [...prev, { id: nextMsgId(), role: 'user', content: trimmed }]);
    setStreaming(true);
    let streamState = initialStreamState();
    streamStateRef.current = streamState;
    setLive({ bodyText: '', steps: [], startedAt: Date.now(), status: 'pending' });
    let bodyFallback = '';

    const finalize = (isError, errText) => {
      ctrlRef.current = null;
      if (!mountedRef.current) return;
      const content = isError
        ? (errText || 'Something went wrong.')
        : (streamState.bodyText || bodyFallback);
      if (content || streamState.steps.length > 0) {
        setMessages((prev) => [...prev, {
          id: nextMsgId(),
          role: 'assistant',
          content,
          steps: streamState.steps,
          startedAt: streamState.startedAt,
          isError,
        }]);
      }
      setLive(null);
      setStreaming(false);
    };

    ctrlRef.current = streamMessage(convIdRef.current, trimmed, {
      // Marks the turn as coming from the Browser Agent dock — the server
      // injects a live <browser-context> block (copilot guidance + open-tab
      // state) into the LLM input so the agent acts on the page unprompted.
      surface: 'browser',
      onEvent(ev) {
        if (!mountedRef.current || ctrlRef.current == null) return;
        adoptConversationId(ev?.conversation_id || ev?.response?.conversation_id);
        streamState = reduceStream(streamState, ev);
        streamStateRef.current = streamState;
        setLive({
          bodyText: streamState.bodyText,
          steps: streamState.steps,
          startedAt: streamState.startedAt,
          status: streamState.status,
        });
      },
      onChunk(chunk, sid) {
        bodyFallback += chunk;
        if (sid) adoptConversationId(sid);
      },
      onDone(sid) {
        if (sid) adoptConversationId(sid);
        finalize(false);
      },
      onError(err) {
        finalize(true, typeof err === 'string' ? err : (err?.message || 'The agent failed'));
      },
    });
  }, [adoptConversationId]);

  const stop = useCallback(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    ctrlRef.current = null;
    try { ctrl.abort(); } catch {}
    if (convIdRef.current) cancelResponse(convIdRef.current).catch?.(() => {});
    // Keep whatever streamed so far as a finished turn instead of
    // discarding it — matches how a mid-turn stop reads in chat.
    const st = streamStateRef.current;
    if (mountedRef.current) {
      if (st && (st.bodyText || st.steps.length > 0)) {
        setMessages((prev) => [...prev, {
          id: nextMsgId(),
          role: 'assistant',
          content: st.bodyText,
          steps: st.steps,
          startedAt: st.startedAt,
        }]);
      }
      setLive(null);
      setStreaming(false);
    }
  }, []);

  return {
    messages,
    live,
    streaming,
    send,
    stop,
    // Getter — the id only exists after the first send, so a render-time
    // snapshot would go stale.
    getConversationId: useCallback(() => convIdRef.current, []),
  };
}
