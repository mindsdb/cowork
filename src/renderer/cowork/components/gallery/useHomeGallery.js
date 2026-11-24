import { useCallback, useEffect, useRef, useState } from 'react';
import { host } from '../../../platform/host';
import { PLATFORM_UI } from '../../../lib/deployment';
import { MINDS_CONSOLE_URL } from '../../../lib/mindsUrls';
import { fetchGalleryManifest } from './galleryManifest';
import { galleryOffered, opensByItself, readGallerySettled, markGallerySettled } from './galleryRules';
import {
  trackGalleryShown, trackGalleryClosed, trackGalleryExampleStarted, trackGalleryUnavailable,
} from '../../lib/analytics';

const OFFERED = galleryOffered({ isWeb: host.isWeb, platformUi: PLATFORM_UI, isMobileShell: host.isMobileShell });

/**
 * The Use Case Gallery column's state for the app: the console's list (read
 * once Home is first shown), whether the column is open, and the example the
 * person chose, for Home to place in the composer.
 *
 * It opens by itself once, on Home, for an account with no tasks yet, and
 * never again in this browser or Desktop install after it is folded or used.
 */
export function useHomeGallery({ onHome, tasks, tasksStatus, consoleUrl = MINDS_CONSOLE_URL, offered = OFFERED }) {
  const [list, setList] = useState({ manifest: null, failure: null });
  const [open, setOpen] = useState(false);
  const [focusSearch, setFocusSearch] = useState(false);
  const [pick, setPick] = useState(null);
  const requestedRef = useRef(false);
  const autoTriedRef = useRef(false);

  const load = useCallback(async () => {
    setList((prev) => ({ ...prev, failure: null }));
    const result = await fetchGalleryManifest(consoleUrl);
    if (result.manifest) {
      setList({ manifest: result.manifest, failure: null });
    } else {
      setList((prev) => ({ manifest: prev.manifest, failure: result.failure }));
      trackGalleryUnavailable(result.failure);
    }
  }, [consoleUrl]);

  useEffect(() => {
    if (!offered || !onHome || requestedRef.current) return;
    requestedRef.current = true;
    load();
  }, [offered, onHome, load]);

  useEffect(() => {
    if (!onHome || autoTriedRef.current) return;
    const decide = {
      offered,
      hasManifest: Boolean(list.manifest),
      tasksStatus,
      taskCount: tasks.length,
      settled: readGallerySettled(),
    };
    // Wait for both answers before deciding for good: the list and the tasks.
    if (offered && (!list.manifest && !list.failure)) return;
    if (tasksStatus === 'loading') return;
    autoTriedRef.current = true;
    if (opensByItself(decide)) {
      setOpen(true);
      setFocusSearch(false);
      trackGalleryShown('auto');
    }
  }, [onHome, offered, list, tasksStatus, tasks.length]);

  const show = useCallback((how) => {
    if (!offered) return;
    setOpen(true);
    setFocusSearch(true);
    trackGalleryShown(how);
    if (!list.manifest && list.failure) load();
  }, [offered, list, load]);

  const hide = useCallback((how) => {
    setOpen(false);
    markGallerySettled();
    trackGalleryClosed(how);
  }, []);

  const start = useCallback((entry) => {
    trackGalleryExampleStarted(entry.id);
    setPick({ entry, bump: Date.now() });
    hide('started');
  }, [hide]);

  return {
    offered,
    open: offered && open,
    manifest: list.manifest,
    failure: list.failure,
    retry: load,
    show,
    hide,
    start,
    pick,
    clearPick: () => setPick(null),
    focusSearch,
  };
}
