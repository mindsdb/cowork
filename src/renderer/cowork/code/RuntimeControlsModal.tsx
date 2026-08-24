import { useEffect, useMemo, useRef, useState } from 'react';
import ModelSelect from '../components/ModelSelect';
import Button from '../components/ui/Button';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import Select from '../components/ui/Select';
import Switch from '../components/ui/Switch';
import {
  buildModelPickerOptions,
  withModelPickerFallback,
  type ModelPickerMeta,
  type ModelPickerSource,
} from '../lib/modelPickerOptions';
import { codingApi, type PermissionMode, type Personality, type ReasoningEffort, type RuntimeControls } from './api';
import { host } from '../../platform/host';
import { PERMISSION_OPTIONS } from './permissions';

const REASONING = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
];
const PERSONALITIES = [
  { value: 'pragmatic', label: 'Pragmatic' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'none', label: 'No personality' },
];


export function RuntimeControlsModal({
  open,
  sessionId,
  value,
  models,
  modelMeta,
  busy,
  onClose,
  onApply,
}: {
  open: boolean;
  sessionId: string;
  value: RuntimeControls;
  models: ModelPickerSource[];
  modelMeta: ModelPickerMeta;
  busy: boolean;
  onClose: () => void;
  onApply: (value: RuntimeControls) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(value);
  const [folderError, setFolderError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [windowsSandbox, setWindowsSandbox] = useState('');
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const wasOpen = useRef(false);
  const initializedSession = useRef('');
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
      await onApply(draft);
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : 'Could not update task controls.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="code-controls-title" closeOnBackdrop={!busy} closeOnEsc={!busy}>
      <ModalHeader
        id="code-controls-title"
        title="Task controls"
        subtitle="These settings apply to future turns in this coding task."
        onClose={busy ? undefined : onClose}
      />
      <ModalBody>
        <div className="code-controls-grid">
          <label className="code-controls-field">
            <span>Model</span>
            <ModelSelect
              value={draft.model}
              onValueChange={(next: string) => update('model', next)}
              options={modelOptions}
              variant="field"
              ariaLabel="Task model"
              disabled={busy}
            />
          </label>
          <label className="code-controls-field">
            <span>Reasoning</span>
            <Select
              value={draft.reasoning_effort || 'high'}
              onValueChange={(next: string) => update('reasoning_effort', next as ReasoningEffort)}
              options={REASONING}
              ariaLabel="Reasoning effort"
              disabled={busy}
            />
          </label>
          <label className="code-controls-field">
            <span>Permissions</span>
            <Select
              value={draft.permission_mode}
              onValueChange={(next: string) => setDraft((current) => ({
                ...current,
                permission_mode: next as PermissionMode,
                network_access: next === 'full_access' ? true : current.network_access,
              }))}
              options={PERMISSION_OPTIONS}
              ariaLabel="Task permissions"
              disabled={busy}
            />
          </label>
          <label className="code-controls-field">
            <span>Personality</span>
            <Select
              value={draft.personality}
              onValueChange={(next: string) => update('personality', next as Personality)}
              options={PERSONALITIES}
              ariaLabel="Agent personality"
              disabled={busy}
            />
          </label>
          <div className="code-controls-toggle">
            <div><strong>Fast</strong><small>Use priority inference when the model supports it.</small></div>
            <Switch checked={draft.service_tier === 'priority'} onCheckedChange={(checked) => update('service_tier', checked ? 'priority' : 'standard')} disabled={busy} aria-label="Fast inference" />
          </div>
          <div className="code-controls-toggle">
            <div><strong>Network access</strong><small>{draft.permission_mode === 'full_access' ? 'Included with full access.' : 'Allow commands to reach external services.'}</small></div>
            <Switch
              checked={draft.network_access}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, network_access: checked, web_search: checked ? current.web_search : false }))}
              disabled={busy || draft.permission_mode === 'full_access'}
              aria-label="Network access"
            />
          </div>
          <div className="code-controls-toggle">
            <div><strong>Web search</strong><small>Let the coding agent search the web when useful.</small></div>
            <Switch
              checked={draft.web_search}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, web_search: checked, network_access: checked || current.network_access }))}
              disabled={busy}
              aria-label="Web search"
            />
          </div>
          <div className="code-controls-folders">
            <div className="code-controls-folders__heading">
              <div><strong>Additional folders</strong><small>Let this task work across related local folders.</small></div>
              <Button variant="subtle" size="sm" disabled={busy} onClick={() => void addFolder()}>Add folder</Button>
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
                      aria-label={`Remove additional folder ${path}`}
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
                <strong>Windows sandbox</strong>
                <small>{windowsSandbox ? windowsSandbox.replace(/([A-Z])/g, ' $1').toLowerCase() : 'Checking…'}</small>
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
                >Set up</Button>
              )}
            </div>
          )}
          {submitError && <div className="code-controls-error" role="alert">{submitError}</div>}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !draft.model} onClick={() => void apply()}>Apply</Button>
      </ModalFooter>
    </Modal>
  );
}
