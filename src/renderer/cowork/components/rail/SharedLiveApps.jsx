/*
 * "Shared with you": live apps other people shared with this person, each with
 * a Duplicate action behind a disclaimer. Its own rail card, under Artifacts,
 * so a project's long artifact list never scrolls it out of view. Rendered by
 * WorkingFolderBox only on a deployment that runs live apps (lib/liveApps.ts),
 * and only with a project to put the copy in. Draws nothing while nobody has
 * shared anything.
 *
 * The list is the same in every project, and others change it at any time, so
 * it re-reads once a minute and whenever `refreshKey` changes (the chat rail
 * passes its streaming flag), by the same rules as the cards' state lines
 * (hooks/useLiveAppStates.js): a failed re-read keeps the last list, and a 404
 * or 401 stops the minute's polling until the next refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { Button } from '../ui';
import { ConfirmModal } from '../ConfirmModal';
import { RailCard } from './RailCard';
import { duplicateLiveApp, fetchSharedLiveApps } from '../../api';
import { noteArtifactCreated } from '../../lib/artifactsStore';
import {
  SHARED_WITH_YOU_LABEL,
  duplicateDisclaimer,
  duplicateDisclaimerTitle,
  sharedByLine,
} from '../../lib/liveAppSharing';

const REFRESH_MS = 60_000;

export function SharedLiveApps({ projectId, refreshKey = null, onDuplicated }) {
  const [apps, setApps] = useState([]);
  const [loadError, setLoadError] = useState('');
  // The app whose disclaimer is open, and the copy request it confirms.
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [duplicateError, setDuplicateError] = useState('');

  // Whether any read has succeeded: a failure after one keeps the list it gave.
  const loaded = useRef(false);

  /*
   * A 404 means this server runs no live apps any more, and a 401 that the
   * sign-in was refused (a person with no email gets an empty list, not a 401).
   * Neither is a failure to report, and asking again can't change either, so
   * `onFinal` stops the polling. Any other failure reports only when nothing
   * has loaded yet.
   */
  const load = useCallback((isCancelled = () => false, onFinal = () => {}) => {
    fetchSharedLiveApps()
      .then((list) => {
        if (isCancelled()) return;
        loaded.current = true;
        setApps(list);
        setLoadError('');
      })
      .catch((e) => {
        if (isCancelled()) return;
        if (e?.status === 404 || e?.status === 401) {
          setApps([]);
          setLoadError('');
          onFinal();
          return;
        }
        if (!loaded.current) setLoadError("Couldn't load the apps shared with you.");
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    const stop = () => clearInterval(timer);
    const timer = setInterval(() => load(isCancelled, stop), REFRESH_MS);
    load(isCancelled, stop);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load, refreshKey]);

  const closeDisclaimer = () => {
    if (busy) return;
    setPending(null);
    setDuplicateError('');
  };

  const confirmDuplicate = async () => {
    const app = pending;
    if (!app || busy) return;
    setBusy(true);
    setDuplicateError('');
    try {
      const card = await duplicateLiveApp({ shareId: app.shareId, projectId });
      noteArtifactCreated(card);
      onDuplicated?.(card);
      setPending(null);
    } catch (e) {
      setDuplicateError(e?.message || "Couldn't duplicate this app.");
      // The share or the owner's app may be gone; the server's list knows.
      if (e?.status === 404) load();
    } finally {
      setBusy(false);
    }
  };

  // Outside the card, so a refusal that empties the list still shows its sentence.
  const disclaimer = (
    <ConfirmModal
      open={!!pending}
      title={duplicateDisclaimerTitle(pending)}
      message={duplicateDisclaimer(pending)}
      confirmLabel="Duplicate"
      cancelLabel="Cancel"
      busy={busy}
      busyLabel="Duplicating…"
      error={duplicateError}
      onClose={closeDisclaimer}
      onConfirm={confirmDuplicate}
    />
  );

  // One tree shape whether or not the card shows, so the disclaimer never remounts.
  const showCard = apps.length > 0 || Boolean(loadError);
  return (
    <>
      {showCard && (
        <RailCard title={SHARED_WITH_YOU_LABEL} defaultOpen maxBodyHeight={240}>
          <section aria-label={SHARED_WITH_YOU_LABEL}>
            {loadError && <p className="text-xs px-1 pb-0.5 text-danger">{loadError}</p>}
            <ul className="m-0 p-0 list-none flex flex-col gap-0.5">
              {apps.map((app) => (
                <li
                  key={app.shareId}
                  className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1"
                  title={app.description || undefined}
                >
                  <span className="inline-flex" style={{ color: 'var(--ink-4)' }}>{Ico.globe(14)}</span>
                  <span className="flex flex-col min-w-0">
                    <span className="text-sm text-ink truncate">{app.name}</span>
                    <span className="text-[11px] leading-[1.35] text-ink-4 [overflow-wrap:anywhere]">{sharedByLine(app)}</span>
                  </span>
                  <Button
                    size="xs"
                    variant="tinted"
                    aria-label={`Duplicate ${app.name}`}
                    onClick={() => { setDuplicateError(''); setPending(app); }}
                  >
                    Duplicate
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        </RailCard>
      )}
      {disclaimer}
    </>
  );
}
