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
  // `attempt` counts reads, so each failed one is recorded at most once.
  const [list, setList] = useState({ manifest: null, failure: null, attempt: 0 });
  // Whether the list was needed: the column could open by itself, or someone
  // opened it. Every offered user reads the list (the button and the
  // checklist row need to know it is there), but only a failed read that
  // someone was waiting on is recorded, so the event tracks new users.
  const [needed, setNeeded] = useState(false);
  const reportedAttemptRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [focusSearch, setFocusSearch] = useState(false);
  // How it was last opened: 'auto' is the first run, which greets the person.
  const [openedBy, setOpenedBy] = useState(null);
  const [pick, setPick] = useState(null);
  const requestedRef = useRef(false);
  const autoTriedRef = useRef(false);

  const load = useCallback(async () => {
    setList((prev) => ({ ...prev, failure: null }));
    const result = await fetchGalleryManifest(consoleUrl);
    setList((prev) => (result.manifest
      ? { manifest: result.manifest, failure: null, attempt: prev.attempt + 1 }
      : { manifest: prev.manifest, failure: result.failure, attempt: prev.attempt + 1 }));
  }, [consoleUrl]);

  useEffect(() => {
    if (!needed || !list.failure || reportedAttemptRef.current === list.attempt) return;
    reportedAttemptRef.current = list.attempt;
    trackGalleryUnavailable(list.failure);
  }, [needed, list]);

  useEffect(() => {
    if (!offered || !onHome || requestedRef.current) return;
    requestedRef.current = true;
    load();
  }, [offered, onHome, load]);

  useEffect(() => {
    if (offered && onHome && tasksStatus === 'ready' && tasks.length === 0 && !readGallerySettled()) setNeeded(true);
  }, [offered, onHome, tasksStatus, tasks.length]);

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
      setOpenedBy('auto');
      setFocusSearch(false);
      trackGalleryShown('auto');
    }
  }, [onHome, offered, list, tasksStatus, tasks.length]);

  const show = useCallback((how) => {
    if (!offered) return;
    setNeeded(true);
    setOpen(true);
    setOpenedBy(how);
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
    // The list has loaded, so the column has something to show. The button
    // and the checklist row use the gallery only then; otherwise the row
    // keeps today's examples list.
    available: offered && Boolean(list.manifest),
    open: offered && open,
    // The first run, opened by itself: the column greets the person.
    welcome: openedBy === 'auto',
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
