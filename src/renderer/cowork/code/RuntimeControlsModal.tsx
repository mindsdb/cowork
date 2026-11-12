import { useEffect, useMemo, useRef, useState } from 'react';
import ModelSelect from '../components/ModelSelect';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import Select from '../components/ui/Select';
import Switch from '../components/ui/Switch';
import Tooltip from '../components/ui/Tooltip';
import {
  buildModelPickerOptions,
  withModelPickerFallback,
  type ModelPickerMeta,
  type ModelPickerSource,
} from '../lib/modelPickerOptions';
import { codingApi, type PermissionMode, type Personality, type RuntimeControls } from './api';
import { effortLabel, effortLevelsFor, resolveEffort } from './reasoning';
import { host } from '../../platform/host';
import { permissionOptions } from './permissions';
import { useTranslation } from '../../lib/i18n';

const PERSONALITY_VALUES = ['pragmatic', 'friendly', 'none'] as const;

/* Statuses this modal sets itself; anything else comes from the server and
   is shown as received. */
const SANDBOX_STATUS_KEYS: Record<string, string> = {
  unknown: 'runtimeControls.sandbox.unknown',
  unavailable: 'runtimeControls.sandbox.unavailable',
  'setup started': 'runtimeControls.sandbox.setupStarted',
  'setup failed': 'runtimeControls.sandbox.setupFailed',
  ready: 'runtimeControls.sandbox.ready',
};


export function RuntimeControlsModal({
  open,
  sessionId,
  value,
  models,
  modelMeta,
  busy,
  applyBlockedReason,
  onClose,
  onApply,
}: {
  open: boolean;
  sessionId: string;
  value: RuntimeControls;
  models: ModelPickerSource[];
  modelMeta: ModelPickerMeta;
  busy: boolean;
  // Set while the server would reject the update (e.g. mid-turn). Fields stay
  // editable so a draft survives until Apply unlocks.
  applyBlockedReason?: string;
  onClose: () => void;
  onApply: (value: RuntimeControls) => Promise<void> | void;
}) {
  const { t } = useTranslation('code');
  const [draft, setDraft] = useState(value);
  const [folderError, setFolderError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [windowsSandbox, setWindowsSandbox] = useState('');
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const wasOpen = useRef(false);
  const initializedSession = useRef('');
  const errorRef = useRef<HTMLDivElement>(null);
  // The form overflows the modal, so an error at its end can land below the
  // fold. Scroll it into view, next to the footer where the user clicked Apply.
  useEffect(() => {
    if (submitError) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [submitError]);
  useEffect(() => {
    const shouldInitialize = open && (!wasOpen.current || initializedSession.current !== sessionId);
    wasOpen.current = open;
    if (shouldInitialize) {
      initializedSession.current = sessionId;
      setDraft({ ...value, additional_dirs: [...value.additional_dirs] });
      setFolderError('');
      setSubmitError('');
    }
  }, [open, sessionId, value]);
  const modelOptions = useMemo(
    () => buildModelPickerOptions(withModelPickerFallback(models, value.model), modelMeta),
    [modelMeta, models, value.model],
  );
  useEffect(() => {
    if (!open || host.getPlatform() !== 'win32') return;
    let alive = true;
    codingApi.platformStatus(sessionId)
      .then((status) => { if (alive) setWindowsSandbox(status.windows_sandbox || 'unknown'); })
      .catch(() => { if (alive) setWindowsSandbox('unavailable'); });
    return () => { alive = false; };
  }, [open, sessionId]);
  const update = <Key extends keyof RuntimeControls>(key: Key, next: RuntimeControls[Key]) => {
    setDraft((current) => ({ ...current, [key]: next }));
  };
  // Effort levels are whatever the gateway advertises for the model in hand.
  // Switching to a model that lacks the current level moves to its default, so
  // the update never carries a level the new model cannot run.
  const effortLevels = useMemo(() => effortLevelsFor(draft.model, modelMeta.modelEfforts), [draft.model, modelMeta.modelEfforts]);
  // The catalog lists levels only for models that have them, so a model
  // missing from the listing (delisted, or not loaded yet) is unknown, not
  // level-less. Only a listed model with no levels drops the stored effort.
  const offersNoEffort = !effortLevels && models.some((model) => model.id === draft.model);
  const chooseModel = (next: string) => {
    setDraft((current) => {
      const levels = effortLevelsFor(next, modelMeta.modelEfforts);
      const keepEffort = !levels || !current.reasoning_effort || levels.levels.includes(current.reasoning_effort);
      return { ...current, model: next, reasoning_effort: keepEffort ? current.reasoning_effort : levels.modelDefault };
    });
  };
  const addFolder = async () => {
    setFolderError('');
    const result = await host.pickCodeFolder();
    if (result.ok && result.path) {
      update('additional_dirs', Array.from(new Set([...draft.additional_dirs, result.path])));
    } else if (!result.cancelled && result.reason) {
      setFolderError(result.reason);
    }
  };
  const apply = async () => {
    setSubmitError('');
    try {
      // A model with no levels rejects any effort, including one the task
      // still stores from an earlier model. The draft keeps it so switching
      // back restores it; only the update drops it.
      await onApply(offersNoEffort ? { ...draft, reasoning_effort: null } : draft);
    } catch (reason) {
      setSubmitError(reason instanceof Error && reason.message ? reason.message : t('runtimeControls.tryAgain'));
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="code-controls-title" dismissible={!busy}>
      <ModalHeader
        id="code-controls-title"
        title={t('runtimeControls.title')}
        subtitle={t('runtimeControls.subtitle')}
        onClose={onClose}
      />
      <ModalBody>
        <div className="code-controls-grid">
          <Field className="min-w-0" label={t('runtimeControls.model')}>
            <ModelSelect
              value={draft.model}
              onValueChange={chooseModel}
              options={modelOptions}
              variant="field"
              ariaLabel={t('runtimeControls.modelAriaLabel')}
              disabled={busy}
            />
          </Field>
          {effortLevels && (
            <Field className="min-w-0" label={t('runtimeControls.reasoning')}>
              <Select
                value={resolveEffort(draft.reasoning_effort, null, effortLevels) || ''}
                onValueChange={(next: string) => update('reasoning_effort', next)}
                options={effortLevels.levels.map((level) => ({
                  value: level,
                  label: effortLabel(level),
                  description: level === effortLevels.modelDefault ? t('runtimeControls.modelDefault') : undefined,
                }))}
                ariaLabel={t('runtimeControls.reasoningAriaLabel')}
                placeholder={t('runtimeControls.effortPlaceholder')}
                disabled={busy}
              />
            </Field>
          )}
          <Field className="min-w-0" label={t('runtimeControls.permissions')}>
            <Select
              value={draft.permission_mode}
              onValueChange={(next: string) => setDraft((current) => ({
                ...current,
                permission_mode: next as PermissionMode,
                network_access: next === 'full_access' ? true : current.network_access,
              }))}
              options={permissionOptions(draft.permission_mode)}
              ariaLabel={t('runtimeControls.permissionsAriaLabel')}
              disabled={busy}
            />
          </Field>
          <Field className="min-w-0" label={t('runtimeControls.personality')}>
            <Select
              value={draft.personality}
              onValueChange={(next: string) => update('personality', next as Personality)}
              options={PERSONALITY_VALUES.map((personality) => ({ value: personality, label: t(`runtimeControls.personalities.${personality}`) }))}
              ariaLabel={t('runtimeControls.personalityAriaLabel')}
              disabled={busy}
            />
          </Field>
          <div className="code-controls-toggle">
            <div><strong>{t('runtimeControls.fast.title')}</strong><small>{t('runtimeControls.fast.description')}</small></div>
            <Switch checked={draft.service_tier === 'priority'} onCheckedChange={(checked) => update('service_tier', checked ? 'priority' : 'standard')} disabled={busy} aria-label={t('runtimeControls.fast.ariaLabel')} />
          </div>
          <div className="code-controls-toggle">
            <div><strong>{t('runtimeControls.network.title')}</strong><small>{draft.permission_mode === 'full_access' ? t('runtimeControls.network.includedWithFullAccess') : t('runtimeControls.network.description')}</small></div>
            <Switch
              checked={draft.network_access}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, network_access: checked, web_search: checked ? current.web_search : false }))}
              disabled={busy || draft.permission_mode === 'full_access'}
              aria-label={t('runtimeControls.network.title')}
            />
          </div>
          <div className="code-controls-toggle">
            <div><strong>{t('runtimeControls.webSearch.title')}</strong><small>{t('runtimeControls.webSearch.description')}</small></div>
            <Switch
              checked={draft.web_search}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, web_search: checked, network_access: checked || current.network_access }))}
              disabled={busy}
              aria-label={t('runtimeControls.webSearch.title')}
            />
          </div>
          <div className="code-controls-folders">
            <div className="code-controls-folders__heading">
              <div><strong>{t('runtimeControls.folders.title')}</strong><small>{t('runtimeControls.folders.description')}</small></div>
              <Button variant="subtle" size="sm" disabled={busy} onClick={() => void addFolder()}>{t('runtimeControls.folders.add')}</Button>
            </div>
            {draft.additional_dirs.length > 0 && (
              <div className="code-controls-folders__list">
                {draft.additional_dirs.map((path) => (
                  <div key={path} title={path}>
                    <span>{path}</span>
                    <Button
                      icon
                      variant="subtle"
                      size="sm"
                      disabled={busy}
                      aria-label={t('runtimeControls.folders.removeAriaLabel', { path })}
                      onClick={() => update('additional_dirs', draft.additional_dirs.filter((item) => item !== path))}
                    >×</Button>
                  </div>
                ))}
              </div>
            )}
            {folderError && <small className="code-controls-folders__error">{folderError}</small>}
          </div>
          {host.getPlatform() === 'win32' && (
            <div className="code-controls-windows">
              <div>
                <strong>{t('runtimeControls.sandbox.title')}</strong>
                <small>{windowsSandbox
                  ? (SANDBOX_STATUS_KEYS[windowsSandbox] ? t(SANDBOX_STATUS_KEYS[windowsSandbox]) : windowsSandbox.replace(/([A-Z])/g, ' $1').toLowerCase())
                  : t('runtimeControls.sandbox.checking')}</small>
              </div>
              {windowsSandbox && windowsSandbox !== 'ready' && (
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={busy || sandboxBusy}
                  onClick={() => {
                    setSandboxBusy(true);
                    codingApi.setupWindowsSandbox(sessionId)
                      .then((status) => setWindowsSandbox(status.windows_sandbox || (status.setup_started ? 'setup started' : 'unknown')))
                      .catch(() => setWindowsSandbox('setup failed'))
                      .finally(() => setSandboxBusy(false));
                  }}
                >{t('runtimeControls.sandbox.setUp')}</Button>
              )}
            </div>
          )}
          {submitError && (
            <div ref={errorRef} className="code-controls-error">
              <Alert variant="danger" title={t('runtimeControls.applyFailed')}>{submitError}</Alert>
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter cancel={<Button variant="subtle" disabled={busy} onClick={onClose}>{t('runtimeControls.cancel')}</Button>}>
        {/* `.btn:disabled` sets pointer-events: none, so a hint on the button
            itself never shows. The wrapper takes the hover instead. */}
        <Tooltip content={applyBlockedReason}>
          <span className="inline-flex">
            <Button
              variant="primary"
              disabled={busy || !draft.model || !!applyBlockedReason}
              onClick={() => void apply()}
            >{t('runtimeControls.apply')}</Button>
          </span>
        </Tooltip>
      </ModalFooter>
    </Modal>
  );
}
