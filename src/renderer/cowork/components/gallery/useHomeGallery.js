import { useCallback, useEffect, useRef, useState } from 'react';
import { host } from '../../../platform/host';
import { PLATFORM_UI } from '../../../lib/deployment';
import { MINDS_API_BASE, MINDS_CONSOLE_URL } from '../../../lib/mindsUrls';
import { fetchGalleryManifest } from './galleryManifest';
import { ALL_CATEGORIES } from './galleryFilter';
import { galleryOffered, opensByItself, readGallerySettled, markGallerySettled, takeFirstRunPreview, clearFirstRunPreview, sendsAtOnce } from './galleryRules';
import {
  trackGalleryShown, trackGalleryClosed, trackGalleryExampleStarted, trackGalleryUnavailable,
} from '../../lib/analytics';

const OFFERED = galleryOffered({ isWeb: host.isWeb, platformUi: PLATFORM_UI, isMobileShell: host.isMobileShell });
const SURFACE = host.isWeb ? 'web' : 'desktop';
// Where the person is in the column: kept here, not in the column, so folding
// it (which unmounts it) and reopening it returns to the same place.
const START_PLACE = { query: '', category: ALL_CATEGORIES, openId: null };
// Read when the app loads; kept for the tab across the sign-in redirect.
const PREVIEW = typeof window !== 'undefined'
  && takeFirstRunPreview({ search: window.location.search, apiBase: MINDS_API_BASE });

/**
 * The Use Case Gallery column's state for the app: the console's list (read
 * once Home is first shown), whether the column is open, and the example the
 * person chose, for Home to place in the composer.
 *
 * It opens by itself once, on Home, for an account with no tasks yet, and
 * never again in this browser or Desktop install after it is folded, used, or
 * passed over for a task of the person's own.
 */
export function useHomeGallery({
  onHome, tasks, tasksStatus, consoleUrl = MINDS_CONSOLE_URL, offered = OFFERED, preview = PREVIEW, surface = SURFACE,
}) {
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
  const [place, setPlace] = useState(START_PLACE);
  const requestedRef = useRef(false);
  const autoTriedRef = useRef(false);
  const openRef = useRef(false);
  openRef.current = offered && open;

  const load = useCallback(async () => {
    setList((prev) => ({ ...prev, failure: null }));
    const result = await fetchGalleryManifest(consoleUrl, undefined, { surface });
    setList((prev) => (result.manifest
      ? { manifest: result.manifest, failure: null, attempt: prev.attempt + 1 }
      : { manifest: prev.manifest, failure: result.failure, attempt: prev.attempt + 1 }));
  }, [consoleUrl, surface]);

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
    if (offered && onHome && (preview || (tasksStatus === 'ready' && tasks.length === 0 && !readGallerySettled()))) setNeeded(true);
  }, [offered, onHome, preview, tasksStatus, tasks.length]);

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
    // A task list that failed to load is no answer: decide once it loads.
    if (offered && (!list.manifest && !list.failure)) return;
    if (tasksStatus === 'loading') return;
    if (tasksStatus !== 'ready' && !(offered && preview)) return;
    autoTriedRef.current = true;
    // A replayed first run (testing, never production): opens and greets
    // whatever the account holds, recorded apart from real first runs.
    if (offered && preview && list.manifest) {
      setOpen(true);
      setOpenedBy('auto');
      setFocusSearch(false);
      trackGalleryShown('preview');
      clearFirstRunPreview();
      return;
    }
    if (opensByItself(decide)) {
      setOpen(true);
      setOpenedBy('auto');
      setFocusSearch(false);
      trackGalleryShown('auto');
    }
  }, [onHome, offered, preview, list, tasksStatus, tasks.length]);

  const show = useCallback((how) => {
    if (!offered) return;
    // Already open (the checklist row clicked beside it): nothing new was shown.
    if (openRef.current) {
      setFocusSearch(true);
      return;
    }
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

  // `send` is what the click decided (startsNow), carried with the pick so a
  // pick that waits (Home still loading) does what the button said.
  const start = useCallback((entry, send = sendsAtOnce(entry)) => {
    trackGalleryExampleStarted(entry.id, send);
    setPick({ entry, send, bump: Date.now() });
    hide('started');
  }, [hide]);

  // A task of the person's own while the column is open (typed in Home's
  // box, which moves them to the task) passes it over: it folds, and counts
  // as settled like a fold, so returning to Home or reloading does not bring
  // it back by itself. A start from the column folds it first.
  const taskCountRef = useRef(tasks.length);
  useEffect(() => {
    const before = taskCountRef.current;
    taskCountRef.current = tasks.length;
    if (tasksStatus === 'ready' && tasks.length > before && openRef.current) hide('own_task');
  }, [tasks.length, tasksStatus, hide]);

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
    place,
    setPlace,
  };
}
