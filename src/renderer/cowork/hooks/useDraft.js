import { useCallback, useState } from 'react';
import { getDraft, setDraft } from '../lib/draftStore';

/**
 * Composer text that survives unmount. Drop-in for `useState('')`.
 *
 * `key` names the surface the text belongs to (`new`, a conversation id, …);
 * see `lib/draftStore.js`. The store is read, never subscribed to — the
 * composer already re-renders per keystroke from its own state, and a
 * subscription would add a second render for no visible gain.
 *
 * `setText` takes a string or an updater function, like `useState`'s setter.
 */
export function useDraft(key) {
  const [state, setState] = useState(() => ({ key, text: getDraft(key) }));

  // Same hook instance, different surface: ChatView is rendered without a
  // `key`, so switching tasks reuses this Composer. Adopt the new surface's
  // draft during render — an effect would paint one frame of the old task's
  // text (and, before this hook existed, left it there permanently).
  if (state.key !== key) setState({ key, text: getDraft(key) });
  const text = state.key === key ? state.text : getDraft(key);

  const setText = useCallback((next) => {
    // An updater reads the store, not React state: the store is written
    // through on every call, so it's current even on the render where the key
    // changed and across two updater calls batched into one render.
    const value = typeof next === 'function' ? next(getDraft(key)) : next;
    // Persisted straight through rather than from an effect: sending from the
    // home composer unmounts it in the same tick (`onSend` switches route), so
    // a post-commit effect would never run and the just-sent text would linger
    // as a draft.
    setDraft(key, value);
    setState({ key, text: value });
  }, [key]);

  return [text, setText];
}
