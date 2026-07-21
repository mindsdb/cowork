// Schedule a new task — modal that replaces the previous inline form.
// Used for both create and edit; pass `task` to enable edit mode.
//
// Layout: title (full width) → cadence + next-run (two columns) →
// project (full width) → status toggle → prompt textarea (full width,
// the most important field, sits last so it gets the room it needs).

import { useEffect, useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui';
import Ico from '../Icons';
import { GENERAL_PROJECT_ID } from '../../lib/scheduleProject';

const FONT_BODY = 'var(--font-body)';

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function defaultNextRun() {
  return toLocalInput(new Date(Date.now() + 60 * 60 * 1000).toISOString());
}

const fieldLabel = {
  fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 500,
  color: 'var(--ink-3)', letterSpacing: '0.02em',
  textTransform: 'uppercase',
  marginBottom: 6,
};

const fieldInput = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 10px', borderRadius: 7,
  background: 'var(--surface-2)',
  border: '1px solid var(--line)',
  color: 'var(--ink)',
  fontFamily: FONT_BODY, fontSize: 13.5,
  outline: 'none',
};

// Native <select> elements paint their own chevron inside the right
// padding area, so the same `padding: 10px` that's fine on a text
// input feels cramped here — the chevron ends up flush with the
// border. Bumping the right padding gives the indicator some air.
const fieldSelect = {
  ...fieldInput,
  paddingRight: 28,
};

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={fieldLabel}>{label}</span>
      {children}
    </label>
  );
}


export default function ScheduleTaskModal({
  open, onClose, onSubmit, onDelete,
  task,                    // when set → edit mode
  projects = [],
  defaultProjectId = '',
  busy = false,
  agentLabel,
}) {
  const isEdit = !!task;

  const [form, setForm] = useState(() => emptyForm({ defaultProjectId }));
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Whenever the modal opens (or the editing target changes), reset
  // form state so reopening doesn't show stale fields from a previous
  // pass.
  useEffect(() => {
    if (!open) return;
    setError('');
    setConfirmingDelete(false);
    if (task) {
      // The server keys the project by id (`task.projectId`), which is also
      // what the <select> options carry, so hydrate is a direct match. Guard
      // it against a project that's no longer listed (deleted) and against the
      // General bucket — neither is a selectable option — so the control falls
      // back to "No project" rather than a value with no matching <option>.
      const taskProjectId =
        task.projectId && task.projectId !== GENERAL_PROJECT_ID
          && projects.some((p) => p.id === task.projectId)
          ? task.projectId
          : '';
      setForm({
        title:     task.title || '',
        prompt:    task.prompt || '',
        cadence:   task.cadence || 'once',
        nextRunAt: toLocalInput(task.nextRunAt) || defaultNextRun(),
        projectId: taskProjectId || defaultProjectId || '',
        enabled:   task.enabled !== false,
      });
    } else {
      setForm(emptyForm({ defaultProjectId }));
    }
  }, [open, task?.id, defaultProjectId, projects]);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function handleSubmit() {
    if (!form.prompt.trim()) {
      setError('A prompt is required.');
      return;
    }
    const nextRunMs = new Date(form.nextRunAt).getTime();
    if (Number.isNaN(nextRunMs)) {
      setError('Pick a valid next-run time.');
      return;
    }
    if (nextRunMs <= Date.now()) {
      setError('Next run must be in the future.');
      return;
    }
    setError('');
    // The server's `ScheduleCreateRequest` keys the project by id
    // (`project_id: UUID`); a null falls back to the General bucket. An
    // earlier payload sent `project: <name>`, which isn't a field on the
    // schema — pydantic silently dropped it, so every schedule landed
    // project-less. The <select> already carries the project id as its
    // value, so send it straight through.
    const payload = {
      title:        form.title.trim() || form.prompt.trim().slice(0, 80),
      prompt:       form.prompt,
      cadence:      form.cadence,
      timezone:     Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
      next_run_at:  new Date(form.nextRunAt).toISOString(),
      project_id:   form.projectId || null,
      // Scheduled tasks always use the user's configured default
      // model — exposing the picker here let people accidentally
      // pin a stale model id that's no longer valid.
      model:        null,
      enabled:      form.enabled,
    };
    try {
      await onSubmit(payload, task?.id || null);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not save schedule.');
    }
  }

  async function handleDelete() {
    if (!task?.id) return;
    setError('');
    try {
      await onDelete?.(task.id);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not delete schedule.');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      labelledBy="schedule-modal-title"
      // Don't dismiss on backdrop click while saving.
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
    >
      <ModalHeader
        id="schedule-modal-title"
        title={isEdit ? 'Edit scheduled task' : 'Schedule a task'}
        subtitle={isEdit
          ? `Update the cadence or prompt. ${agentLabel} picks up changes on the next run.`
          : `${agentLabel} runs this prompt on the cadence you set, while the desktop app is open.`}
        onClose={onClose}
      />
      <ModalBody padding="18px 20px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Title">
            <input
              type="text"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder="Weekly metrics summary"
              autoFocus
              style={fieldInput}
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Cadence">
              <select
                value={form.cadence}
                onChange={(e) => update('cadence', e.target.value)}
                style={fieldSelect}
              >
                <option value="once">Once</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
              </select>
            </Field>
            <Field label="Next run">
              <input
                type="datetime-local"
                value={form.nextRunAt}
                min={toLocalInput(new Date().toISOString())}
                onChange={(e) => update('nextRunAt', e.target.value)}
                style={fieldInput}
              />
            </Field>
          </div>

          <Field label="Project">
            <select
              value={form.projectId}
              onChange={(e) => update('projectId', e.target.value)}
              style={fieldSelect}
            >
              <option value="">No project</option>
              {projects
                .filter((p) => p.id !== GENERAL_PROJECT_ID)
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>
          </Field>

          <div>
            <span style={{ ...fieldLabel, display: 'block' }}>Status</span>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              fontFamily: FONT_BODY, fontSize: 13.5, color: 'var(--ink)',
              cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => update('enabled', e.target.checked)}
              />
              {form.enabled ? 'Enabled' : 'Paused'}
            </label>
          </div>

          <Field label="Prompt">
            <textarea
              value={form.prompt}
              onChange={(e) => update('prompt', e.target.value)}
              placeholder={`Ask ${agentLabel} to…`}
              rows={6}
              style={{ ...fieldInput, resize: 'vertical', lineHeight: 1.45 }}
            />
          </Field>

          {error && (
            <div style={{
              padding: '8px 10px', borderRadius: 7,
              background: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
              color: 'var(--danger)', fontSize: 12.5,
            }}>{error}</div>
          )}
        </div>
      </ModalBody>
      <ModalFooter align={isEdit ? 'space-between' : 'flex-end'}>
        {isEdit && onDelete && (
          confirmingDelete ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Delete this schedule?</span>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
                style={btnSecondary}
              >Cancel</button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                style={btnDanger}
              >Delete</button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              style={{ ...btnSecondary, color: 'var(--danger)' }}
            >
              {Ico.trash ? Ico.trash(13) : null}
              <span style={{ marginLeft: Ico.trash ? 6 : 0 }}>Delete</span>
            </button>
          )
        )}
        {!isEdit && <span />}
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={busy} style={btnSecondary}>
            Cancel
          </button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={busy}
          >
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Create')}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}


// ── Helpers ──

function emptyForm({ defaultProjectId }) {
  return {
    title: '',
    prompt: '',
    cadence: 'once',
    nextRunAt: defaultNextRun(),
    // The caller passes the currently-selected project as the default, which
    // is often General (the app's default context) — that isn't a selectable
    // option, so normalize it to "No project" rather than an id with no
    // matching <option>.
    projectId: defaultProjectId && defaultProjectId !== GENERAL_PROJECT_ID ? defaultProjectId : '',
    enabled: true,
  };
}

const btnSecondary = {
  display: 'inline-flex', alignItems: 'center',
  background: 'transparent',
  border: '1px solid var(--line)',
  color: 'var(--ink-2)',
  padding: '7px 12px', borderRadius: 7,
  fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
  cursor: 'pointer',
};

const btnDanger = {
  display: 'inline-flex', alignItems: 'center',
  background: 'var(--danger)',
  border: '1px solid var(--danger)',
  color: '#fff',
  padding: '7px 12px', borderRadius: 7,
  fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
  cursor: 'pointer',
};
