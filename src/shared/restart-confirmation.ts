// A restart that stops the sidecar ends every running turn (ENG-3291). Before
// main does that on a user's click, it reports how many tasks are running and
// lets the renderer ask. This is the shape of that report and the copy the
// renderer shows for it. Shared so the main-process handlers and the renderer
// guard agree on one contract.

import { sourceTranslator, type Translate } from './i18n/translate';
import appSource from './i18n/locales/en/app.json';

/* The copy lives in the `app` catalog under `restartConfirm`. The renderer passes its
   `app` translator; without one the copy is English. */
const english: Translate = sourceTranslator(appSource);

export interface RestartConfirmation {
  confirm: true;
  /** Running tasks, or null when the sidecar did not answer in time. */
  runningTasks: number | null;
}

/** What a restart request resolves to: the legacy boolean (installed or
 *  applied, or not), or a request to confirm first. Old shells only ever return
 *  the boolean, so callers must treat a non-object as the old contract. */
export type RestartRequestResult = boolean | RestartConfirmation;

export function needsRestartConfirmation(result: unknown): result is RestartConfirmation {
  return typeof result === 'object' && result !== null && (result as { confirm?: unknown }).confirm === true;
}

export interface RestartConfirmationCopy {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
}

/** The dialog copy. One running task is named in the singular; an unknown
 *  count says so instead of guessing. */
export function restartConfirmationCopy(runningTasks: number | null, t: Translate = english): RestartConfirmationCopy {
  const confirmLabel = t('restartConfirm.confirm');
  const cancelLabel = t('restartConfirm.cancel');
  if (runningTasks === null) {
    return {
      title: t('restartConfirm.unknownTitle'),
      body: t('restartConfirm.unknownBody'),
      confirmLabel,
      cancelLabel,
    };
  }
  return {
    title: t('restartConfirm.title', { count: runningTasks }),
    body: t('restartConfirm.body'),
    confirmLabel,
    cancelLabel,
  };
}
