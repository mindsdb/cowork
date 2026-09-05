import { useCallback, useState } from 'react';
import { getDraft, setDraft } from '../lib/draftStore';

/**
 * Surface-keyed composer state backed by draftStore; setText accepts a value or updater like
 * useState.
 * Read without subscribing: local state already renders each edit.
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
