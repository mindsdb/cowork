// useInlineEdit.js — M1 "Fix it in place" state machine.
//
// The hero interaction for the redesigned artifact workspace: select an element,
// get a puck (Ask AI / Comment), watch a generating shimmer, see an inline
// red/green track-changes diff, then Keep or Undo.
//
// This hook owns ONLY the interaction state machine + the async edit lifecycle.
// It is presentation-agnostic — <Puck/>, <InlineDiff/> and <EditableBlock/> read
// from it and call its actions. The actual AI + persistence are injected as
// `proposeEdit` / `commitEdit` so the same hook drives both the self-contained
// mock demo and the real backend (see editIntegrationNotes.md for the contract).
//
// State machine:
//
//   idle ──select(el)──▶ menu
//   menu ──openPrompt()──▶ prompt        menu ──startComment()──▶ comment
//   menu ──cancel()/Esc──▶ idle
//   prompt ──submitPrompt(text)──▶ busy  prompt ──cancel()/Esc──▶ idle
//   comment ──submitComment(text)──▶ idle (fires onComment)   comment ──cancel()──▶ idle
//   busy ──(proposeEdit resolves, newText≠oldText)──▶ diff
//   busy ──(proposeEdit resolves, newText==oldText)──▶ idle   (no-op guard, toast)
//   busy ──(proposeEdit rejects)──▶ idle (toast error)
//   diff ──keep()──▶ (commitEdit; on ok) idle + onCommitted(newText, versionId)
//   diff ──keep() conflict (409)──▶ diff (surfaces conflict, keeps the proposal)
//   diff ──undo()──▶ idle  (nothing changes)
//
// React 19, no external deps.

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

export const EDIT_STATES = Object.freeze({
  IDLE: 'idle',
  MENU: 'menu',
  PROMPT: 'prompt',
  COMMENT: 'comment',
  BUSY: 'busy',
  DIFF: 'diff',
});

// ── Mock AI (default) ────────────────────────────────────────────────────────
// Resolves after ~1200ms with a plausibly rewritten version of `target.text`,
// branching on keywords in the instruction ('short' / 'warm' / 'punch').
// Swap this out by passing a real `proposeEdit` to the hook.
const MOCK_LATENCY_MS = 1200;

function mockRewrite(text, instruction) {
  const t = String(text || '').trim();
  const i = String(instruction || '').toLowerCase();

  if (i.includes('short') || i.includes('trim') || i.includes('concise') || i.includes('tighten')) {
    // Keep the first sentence, drop the rest — a believable "shorten".
    const firstSentence = t.match(/^[^.!?]*[.!?]/);
    const head = firstSentence ? firstSentence[0].trim() : t;
    return head.length < t.length ? head : t.replace(/\s+\S+\s+\S+\s*$/, '.');
  }
  if (i.includes('warm') || i.includes('friendly') || i.includes('human')) {
    return `Hi there — ${t.charAt(0).toLowerCase()}${t.slice(1)} We're genuinely glad you're here.`;
  }
  if (i.includes('punch') || i.includes('confident') || i.includes('bold') || i.includes('strong')) {
    return t
      .replace(/\bwe(?:'| a|a)?re going to\b/gi, "we'll")
      .replace(/\bwe will\b/gi, "we'll")
      .replace(/\bhelp you (?:get )?(?:set up|started)\b/gi, 'get you shipping on day one')
      .replace(/\bover the next week,?\s*/gi, '')
      .replace(/\.$/, '. No fluff.');
  }
  // Generic rephrase: lightly reword without changing meaning.
  return t.replace(/\.$/, '') + ' — refreshed.';
}

const defaultProposeEdit = ({ target, instruction }) =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        oldText: target?.text ?? '',
        newText: mockRewrite(target?.text ?? '', instruction),
      });
    }, MOCK_LATENCY_MS);
  });

const defaultCommitEdit = ({ newText }) =>
  // Mock persistence: always succeeds, mints a fake version id.
  Promise.resolve({ ok: true, versionId: `v-mock-${Date.now()}`, text: newText });

// ── Reducer ──────────────────────────────────────────────────────────────────
const initial = {
  state: EDIT_STATES.IDLE,
  target: null, // { text, ... } whatever the caller passed to select()
  instruction: '', // last prompt text used, for display ("you asked …")
  diff: null, // { oldText, newText }
  error: null, // string | null — surfaced as a toast
  conflict: null, // { baseVersionId, message } when commit returns 409
};

function reducer(s, a) {
  switch (a.type) {
    case 'SELECT':
      // Selecting (re)opens the menu for the chosen target; ignore while busy.
      if (s.state === EDIT_STATES.BUSY) return s;
      return { ...initial, state: EDIT_STATES.MENU, target: a.target };
    case 'OPEN_PROMPT':
      if (s.state !== EDIT_STATES.MENU && s.state !== EDIT_STATES.COMMENT) return s;
      return { ...s, state: EDIT_STATES.PROMPT, error: null };
    case 'OPEN_COMMENT':
      if (s.state !== EDIT_STATES.MENU && s.state !== EDIT_STATES.PROMPT) return s;
      return { ...s, state: EDIT_STATES.COMMENT, error: null };
    case 'BUSY':
      return { ...s, state: EDIT_STATES.BUSY, instruction: a.instruction, error: null, conflict: null };
    case 'DIFF':
      return { ...s, state: EDIT_STATES.DIFF, diff: a.diff };
    case 'NOOP':
      // newText === oldText: bounce back to idle, raise a friendly toast.
      return { ...initial, error: a.message };
    case 'COMMIT_CONFLICT':
      // Stay in diff so the user can still act on the (now stale-based) proposal.
      return { ...s, state: EDIT_STATES.DIFF, conflict: a.conflict };
    case 'ERROR':
      return { ...s, state: EDIT_STATES.DIFF, error: a.message };
    case 'RESET':
      return { ...initial, error: a.message ?? null };
    case 'CLEAR_TOAST':
      return { ...s, error: null };
    default:
      return s;
  }
}

/**
 * useInlineEdit — the M1 interaction state machine.
 *
 * @param {object}   opts
 * @param {Function} [opts.proposeEdit]   async ({target, instruction}) => {oldText, newText}
 * @param {Function} [opts.commitEdit]    async ({target, newText, baseVersionId}) => {ok, versionId, text} | throws/returns {conflict}
 * @param {Function} [opts.onComment]     ({target, text}) => void   — fired on submitComment
 * @param {Function} [opts.onCommitted]   ({target, newText, versionId}) => void — fired after a successful keep()
 * @param {string}   [opts.baseVersionId] the version the edit is computed against (compare-and-swap key)
 * @returns {{ state, is, target, diff, busy, error, conflict, instruction,
 *            select, openPrompt, startComment, submitPrompt, submitComment, keep, undo, cancel, dismissToast }}
 */
export function useInlineEdit({
  proposeEdit = defaultProposeEdit,
  commitEdit = defaultCommitEdit,
  onComment,
  onCommitted,
  baseVersionId,
} = {}) {
  const [s, dispatch] = useReducer(reducer, initial);

  // Guard against state updates landing after a target switch / unmount.
  const reqIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const select = useCallback((target) => {
    reqIdRef.current += 1; // invalidate any in-flight proposal for the old target
    dispatch({ type: 'SELECT', target });
  }, []);

  const openPrompt = useCallback(() => dispatch({ type: 'OPEN_PROMPT' }), []);
  const startComment = useCallback(() => dispatch({ type: 'OPEN_COMMENT' }), []);
  const cancel = useCallback(() => {
    reqIdRef.current += 1;
    dispatch({ type: 'RESET' });
  }, []);
  const dismissToast = useCallback(() => dispatch({ type: 'CLEAR_TOAST' }), []);

  const submitPrompt = useCallback(
    async (text) => {
      const instruction = (text ?? '').trim();
      if (!instruction) return;
      const myReq = ++reqIdRef.current;
      const target = s.target;
      dispatch({ type: 'BUSY', instruction });
      try {
        const res = await proposeEdit({ target, instruction });
        if (!mountedRef.current || myReq !== reqIdRef.current) return; // stale
        const oldText = res?.oldText ?? target?.text ?? '';
        const newText = res?.newText ?? '';
        if (newText.trim() === oldText.trim()) {
          dispatch({ type: 'NOOP', message: 'Already looks good — no change suggested' });
          return;
        }
        dispatch({ type: 'DIFF', diff: { oldText, newText } });
      } catch (err) {
        if (!mountedRef.current || myReq !== reqIdRef.current) return;
        dispatch({ type: 'RESET', message: err?.message || 'Anton could not draft a change — try again' });
      }
    },
    [proposeEdit, s.target],
  );

  const submitComment = useCallback(
    (text) => {
      const t = (text ?? '').trim();
      if (!t) return;
      onComment?.({ target: s.target, text: t });
      dispatch({ type: 'RESET' });
    },
    [onComment, s.target],
  );

  const keep = useCallback(async () => {
    if (s.state !== EDIT_STATES.DIFF || !s.diff) return;
    const myReq = ++reqIdRef.current;
    const { newText } = s.diff;
    const target = s.target;
    try {
      const res = await commitEdit({ target, newText, baseVersionId });
      if (!mountedRef.current || myReq !== reqIdRef.current) return;
      // Conflict can be signalled two ways: a thrown error with .status===409,
      // or a resolved object with { conflict: {...} } / { ok:false, status:409 }.
      const isConflict = res && (res.conflict || res.ok === false || res.status === 409);
      if (isConflict) {
        dispatch({
          type: 'COMMIT_CONFLICT',
          conflict: {
            baseVersionId,
            message:
              res?.conflict?.message ||
              'This changed since you started — Anton can merge your edit',
          },
        });
        return;
      }
      const versionId = res?.versionId;
      onCommitted?.({ target, newText, versionId });
      dispatch({ type: 'RESET' });
    } catch (err) {
      if (!mountedRef.current || myReq !== reqIdRef.current) return;
      if (err?.status === 409 || err?.code === 'conflict') {
        dispatch({
          type: 'COMMIT_CONFLICT',
          conflict: {
            baseVersionId,
            message: err?.message || 'This changed since you started — Anton can merge your edit',
          },
        });
      } else {
        dispatch({ type: 'ERROR', message: err?.message || 'Could not save — your draft is safe' });
      }
    }
  }, [s.state, s.diff, s.target, commitEdit, baseVersionId, onCommitted]);

  const undo = useCallback(() => {
    reqIdRef.current += 1;
    dispatch({ type: 'RESET' });
  }, []);

  const is = useMemo(
    () => ({
      idle: s.state === EDIT_STATES.IDLE,
      menu: s.state === EDIT_STATES.MENU,
      prompt: s.state === EDIT_STATES.PROMPT,
      comment: s.state === EDIT_STATES.COMMENT,
      busy: s.state === EDIT_STATES.BUSY,
      diff: s.state === EDIT_STATES.DIFF,
      // "puck is open" convenience: any pre-diff popover state for a selected target.
      puckOpen:
        s.state === EDIT_STATES.MENU ||
        s.state === EDIT_STATES.PROMPT ||
        s.state === EDIT_STATES.COMMENT,
    }),
    [s.state],
  );

  return {
    // state
    state: s.state,
    is,
    target: s.target,
    diff: s.diff,
    busy: s.state === EDIT_STATES.BUSY,
    error: s.error,
    conflict: s.conflict,
    instruction: s.instruction,
    // actions
    select,
    openPrompt,
    startComment,
    submitPrompt,
    submitComment,
    keep,
    undo,
    cancel,
    dismissToast,
  };
}

export default useInlineEdit;
