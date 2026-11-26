import { useCallback, useSyncExternalStore } from 'react';
import {
  getDraftAttachments,
  setDraftAttachments,
  subscribeDraftAttachments,
} from '../lib/draftAttachments';

/**
 * Composer attachments for one draft key, kept across navigation and reloads.
 * Drop-in for `useState([])`; the setter takes a list or an updater.
 *
 * The setter is bound to the key it was created with, so a send that finishes
 * after the user switched threads clears the thread it was sent from.
 */
export function useDraftAttachments(key) {
  const attachments = useSyncExternalStore(subscribeDraftAttachments, () => getDraftAttachments(key));
  const setAttachments = useCallback((next) => {
    if (!key) return;
    const value = typeof next === 'function' ? next(getDraftAttachments(key)) : next;
    setDraftAttachments(key, value);
  }, [key]);
  return [attachments, setAttachments];
}
