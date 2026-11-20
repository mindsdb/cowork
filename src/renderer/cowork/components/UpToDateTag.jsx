// Calm, non-interactive "synced" status shown in a Share footer when there is
// nothing to save, deliberately not styled as a control, so status reads as
// status and the action button only appears when there is something to do.
// Shared by the artifact and skill Share panels.
//
// `state` lets a setting saved right in the panel (viewer analytics) show its
// save here: "Saving…" while it saves, "Saved" for a moment, then back to
// "Up to date", each fading in (ENG-4455).

import { useEffect, useRef, useState } from 'react';
import Ico from './Icons';
import { Spinner } from './ui';
import { useTranslation } from '../../lib/i18n';

export const SAVED_FLASH_MS = 1800;

/**
 * 'saving' while `busy`, 'saved' for a moment after it ends without `failed`,
 * null otherwise.
 */
export function useSaveStatus(busy, failed = false) {
  const [saved, setSaved] = useState(false);
  const wasBusy = useRef(busy);
  useEffect(() => {
    const landed = wasBusy.current && !busy && !failed;
    wasBusy.current = busy;
    if (!landed) return undefined;
    setSaved(true);
    const timer = setTimeout(() => setSaved(false), SAVED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [busy, failed]);
  useEffect(() => { if (busy || failed) setSaved(false); }, [busy, failed]);
  if (busy) return 'saving';
  return saved ? 'saved' : null;
}

// `label` replaces the idle wording, as a doc's "Updates as you edit" does.
export function UpToDateTag({ state = null, label: idleLabel } = {}) {
  const { t } = useTranslation('shell');
  const label = state === 'saving' ? t('upToDateSaving') : state === 'saved' ? t('upToDateSaved') : (idleLabel ?? t('upToDate'));
  return (
    <span
      key={state || 'idle'}
      role="status"
      aria-live="polite"
      className="up-to-date-tag inline-flex items-center gap-[6px] py-[7px] px-1 font-body font-semibold text-sm text-ink-3"
    >
      {state === 'saving' ? (
        <span className="inline-flex text-ink-3"><Spinner /></span>
      ) : (
        /* var(--ok) has no config utility (distinct from the --success hex), so it stays inline. */
        <span className="inline-flex" style={{ color: 'var(--ok)' }}>{Ico.check(14)}</span>
      )}
      {label}
    </span>
  );
}

export default UpToDateTag;
