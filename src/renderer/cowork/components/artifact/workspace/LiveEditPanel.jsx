// Live edit's side panel (ENG-4455): the controls that used to sit in the
// editor's top toolbar, now in the viewer's shared side panel beside the
// Comments inbox and Stats. The canvas stays the editing surface; the panel
// holds what the editor is doing (its status line), the unsaved changes (each
// with its own undo), Source code (the HTML) and Save / Discard. The Navigate
// / Edit text switch floats over the page, as Comments' does.
//
// The editor owns that state (what is selected, the mode it posts to its
// frame, whether the source is open), so it renders its controls itself,
// through a portal into the panel's slot (LiveEditControls). The panel is the
// frame: its header, and the slot.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Ico from '../../Icons';
import { Spinner, Tooltip } from '../../ui';
import { XIcon } from '../comments/icons';
import { PanelGuide } from '../PanelGuide';
import { useTranslation } from '../../../../lib/i18n';

/** The panel's frame: the header with its close, and the slot the editor
    fills (`slotRef` receives the slot's element). */
export function LiveEditPanel({ slotRef, onClose }) {
  const { t } = useTranslation('artifacts');
  return (
    <div className="artifact-live-edit-panel flex flex-col gap-[12px] bg-surface px-3 py-2 font-[family-name:var(--font-body)]">
      <div className="flex shrink-0 items-center justify-between">
        <span className="text-[18px] font-semibold leading-[28px] text-ink">{t('layers.source')}</span>
        {onClose && (
          <Tooltip content={t('liveEditPanel.close')}>
            <button
              type="button"
              aria-label={t('liveEditPanel.close')}
              className="w-[24px] h-[24px] flex items-center justify-center bg-transparent border-0
                rounded-[6px] p-0 cursor-pointer text-ink-3 transition-colors
                hover:text-ink hover:bg-surface-2"
              onClick={onClose}
            >
              <XIcon />
            </button>
          </Tooltip>
        )}
      </div>
      <div ref={slotRef} className="artifact-live-edit-slot" data-testid="live-edit-slot" />
    </div>
  );
}

/**
 * The editor's controls, rendered into the Live edit panel's slot. Nothing
 * renders until the slot is there.
 *
 * @param {{
 *   target: Element | null,
 *   heading: string,
 *   guidance?: string,
 *   isError?: boolean,
 *   active?: boolean,
 *   changes?: { id: string, label: string, text: string, was: string }[],
 *   onUndoChange?: (id: string) => void,
 *   advanced?: { on: boolean, onToggle: () => void } | null,
 *   editActions?: { dirty: boolean, saving: boolean, canEdit: boolean, onSave: () => void, onDiscard: () => void } | null,
 * }} props
 */
export function LiveEditControls({
  target,
  heading,
  guidance = '',
  isError = false,
  active = false,
  changes = [],
  onUndoChange = null,
  advanced = null,
  editActions = null,
}) {
  const { t } = useTranslation('artifacts');
  if (!target) return null;
  const edited = changes?.length > 0;
  return createPortal(
    <div className="artifact-live-edit-controls">
      {/* The edits fill the panel from the top; the status card waits in the
          middle until there are some, then moves to the bottom. */}
      <UnsavedChanges changes={changes} onUndo={onUndoChange} />
      <PanelGuide
        status
        title={heading}
        text={guidance}
        isError={isError}
        active={active}
        placement={edited ? 'bottom' : 'center'}
        after={advanced && (
          <button type="button" className="artifact-live-edit-advanced" onClick={advanced.onToggle}>
            {advanced.on ? Ico.edit(14) : Ico.code(14)}
            {advanced.on ? t('htmlEditor.back') : t('htmlEditor.sourceCode')}
          </button>
        )}
      />
      <div className="artifact-live-edit-actions">
        <SaveDiscardButtons actions={editActions} />
      </div>
    </div>,
    target,
  );
}

/** The edits not saved yet, newest last: what each element says now, what it
    said before, and an × that puts that one back. */
export function UnsavedChanges({ changes, onUndo }) {
  const { t } = useTranslation('artifacts');
  if (!changes?.length) return null;
  return (
    <section className="artifact-live-edit-changes" aria-label={t('liveEditPanel.changes.title')}>
      <div className="artifact-live-edit-changes-title">
        {t('liveEditPanel.changes.title')}
        <span>{changes.length}</span>
      </div>
      <ul>
        {changes.map((change) => (
          <li key={change.id}>
            <div className="artifact-live-edit-change-text">
              <span className="artifact-live-edit-change-label">{change.label}</span>
              <span className="artifact-live-edit-change-now">{change.text || t('liveEditPanel.changes.emptyText')}</span>
              {change.was && (
                <span className="artifact-live-edit-change-was">{t('liveEditPanel.changes.was', { text: change.was })}</span>
              )}
            </div>
            {onUndo && (
              <Tooltip content={t('liveEditPanel.changes.undo')}>
                <button
                  type="button"
                  className="artifact-live-edit-change-undo"
                  aria-label={t('liveEditPanel.changes.undoNamed', { label: change.label, text: change.text })}
                  onClick={() => onUndo(change.id)}
                >
                  <XIcon />
                </button>
              </Tooltip>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// How long "Saved" stays on the button once a save lands.
export const SAVED_FLASH_MS = 2000;

/** Save and Discard for Live edit's unsaved text. The Save button shows its
    own progress: "Saving…" with a spinner, then "Saved" with a check for a
    moment once it lands, then the pair goes, as there is nothing to save. */
export function SaveDiscardButtons({ actions }) {
  const { t } = useTranslation('artifacts');
  const saving = !!actions?.saving;
  const dirty = !!actions?.dirty;
  const [justSaved, setJustSaved] = useState(false);
  const wasSavingRef = useRef(saving);

  useEffect(() => {
    const landed = wasSavingRef.current && !saving && !dirty;
    wasSavingRef.current = saving;
    if (!landed) return undefined;
    setJustSaved(true);
    const timer = setTimeout(() => setJustSaved(false), SAVED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [saving, dirty]);
  useEffect(() => { if (dirty) setJustSaved(false); }, [dirty]);

  if (!actions?.canEdit) return null;
  if (!dirty && !saving) {
    if (!justSaved) return null;
    return (
      <button type="button" className="artifact-save-edit is-saved" disabled aria-live="polite">
        {Ico.check(14)} {t('revisionBar.saved')}
      </button>
    );
  }
  return (
    <>
      <button type="button" className="is-secondary artifact-discard-edit" disabled={saving} onClick={actions.onDiscard}>
        {t('revisionBar.discard')}
      </button>
      <Tooltip content={t('revisionBar.saveTooltip')}>
        <button
          type="button"
          className="artifact-save-edit"
          disabled={saving}
          aria-busy={saving}
          aria-live="polite"
          onClick={actions.onSave}
        >
          {saving ? <Spinner /> : Ico.save(14)} {saving ? t('revisionBar.saving') : t('revisionBar.save')}
        </button>
      </Tooltip>
    </>
  );
}

export default LiveEditPanel;
