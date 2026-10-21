// "Shared with you": live apps other people shared with this person, each with
// a Duplicate action behind a disclaimer. Rendered by the rail's Artifacts card
// only on a deployment that runs live apps (lib/liveApps.ts), and only with a
// project to put the copy in.

import { useEffect, useState } from 'react';
import Ico from '../Icons';
import { Button } from '../ui';
import { ConfirmModal } from '../ConfirmModal';
import { duplicateLiveApp, fetchSharedLiveApps } from '../../api';
import { noteArtifactCreated } from '../../lib/artifactsStore';
import {
  SHARED_WITH_YOU_LABEL,
  duplicateDisclaimer,
  duplicateDisclaimerTitle,
  sharedByLine,
} from '../../lib/liveAppSharing';

export function SharedLiveApps({ projectId, onDuplicated }) {
  const [apps, setApps] = useState([]);
  const [loadError, setLoadError] = useState('');
  // The app whose disclaimer is open, and the copy request it confirms.
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [duplicateError, setDuplicateError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchSharedLiveApps()
      .then((list) => { if (!cancelled) { setApps(list); setLoadError(''); } })
      .catch((e) => {
        if (cancelled) return;
        setApps([]);
        // 404: this server runs no live apps after all, so there is nothing to list.
        setLoadError(e?.status === 404 ? '' : "Couldn't load the apps shared with you.");
      });
    return () => { cancelled = true; };
  }, []);

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
    } finally {
      setBusy(false);
    }
  };

  if (apps.length === 0 && !loadError) return null;

  return (
    <section aria-label={SHARED_WITH_YOU_LABEL} className="mt-2">
      <div role="separator" className="h-px bg-[var(--border-0)] my-1 mx-1" />
      <h3 className="m-0 px-1 pt-1 pb-0.5 text-[11px] font-semibold text-ink-4">{SHARED_WITH_YOU_LABEL}</h3>
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
    </section>
  );
}
