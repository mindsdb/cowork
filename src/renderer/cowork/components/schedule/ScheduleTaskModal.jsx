// Schedule a new task — modal that replaces the previous inline form.
// Used for both create and edit; pass `task` to enable edit mode.
//
// Layout: title (full width) → cadence + next-run (two columns) →
// project (full width) → status toggle → prompt textarea (full width,
// the most important field, sits last so it gets the room it needs).

import { useEffect, useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import { Button, Select, Input, Textarea } from '../ui';
import { Switch } from '../ui/Switch';
import Ico from '../Icons';

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

// Selects sit alongside the surface-2 text inputs above, so the trigger
// carries the same background/radius (Select's own default is the
// bordered var(--surface) look used in bordered form fields elsewhere).
const fieldSelectStyle = {
  background: 'var(--surface-2)',
  borderRadius: 7,
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
  defaultProjectPath = '',
  busy = false,
  agentLabel,
}) {
  const isEdit = !!task;

  const [form, setForm] = useState(() => emptyForm({ defaultProjectPath }));
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
      // The server stores the project as a NAME (`task.project`) and
      // the form's Project select uses path as its value. Hydrate the
      // form by resolving the name back to a path via `projects`.
      // Earlier versions read `task.projectPath` which the server never
      // sets, so editing always lost the project association.
      const taskProjectPath = (() => {
        if (task.projectPath) return task.projectPath;
        if (task.project) {
          const match = projects.find((p) => p.name === task.project);
          if (match?.path) return match.path;
        }
        return '';
      })();
      setForm({
        title:       task.title || '',
        prompt:      task.prompt || '',
        cadence:     task.cadence || 'once',
        nextRunAt:   toLocalInput(task.nextRunAt) || defaultNextRun(),
        projectPath: taskProjectPath || defaultProjectPath || '',
        enabled:     task.enabled !== false,
      });
    } else {
      setForm(emptyForm({ defaultProjectPath }));
    }
  }, [open, task?.id, defaultProjectPath, projects]);

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
    // The server's `ScheduleRequest` schema accepts `project` as a
    // bare project NAME (not a path) and ignores any unknown fields.
    // The earlier payload sent `project_path: <path>` which silently
    // dropped — every schedule landed with `project: null`, breaking
    // the project-pivoted card / list / count. Resolve the form's
    // path back to a name via `projects` and send the right field.
    const projectMatch = projects.find((p) => p.path === form.projectPath);
    const payload = {
      title:        form.title.trim() || form.prompt.trim().slice(0, 80),
      prompt:       form.prompt,
      cadence:      form.cadence,
      timezone:     Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
      next_run_at:  new Date(form.nextRunAt).toISOString(),
      project:      projectMatch?.name || null,
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
            <Input
              value={form.title}
              onChange={(v) => update('title', v)}
              placeholder="Weekly metrics summary"
              autoFocus
              style={fieldInput}
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Cadence">
              <Select
                value={form.cadence}
                onValueChange={(v) => update('cadence', v)}
                ariaLabel="Cadence"
                style={fieldSelectStyle}
                options={[
                  { value: 'once',     label: 'Once' },
                  { value: 'hourly',   label: 'Hourly' },
                  { value: 'daily',    label: 'Daily' },
                  { value: 'weekdays', label: 'Weekdays' },
                  { value: 'weekly',   label: 'Weekly' },
                ]}
              />
            </Field>
            <Field label="Next run">
              <Input
                type="datetime-local"
                value={form.nextRunAt}
                min={toLocalInput(new Date().toISOString())}
                onChange={(v) => update('nextRunAt', v)}
                style={fieldInput}
              />
            </Field>
          </div>

          <Field label="Project">
            <Select
              value={form.projectPath}
              onValueChange={(v) => update('projectPath', v)}
              ariaLabel="Project"
              style={fieldSelectStyle}
              options={[
                { value: '', label: 'No project' },
                ...projects.map((p) => ({ value: p.path, label: p.name })),
              ]}
            />
          </Field>

          <div>
            <span style={{ ...fieldLabel, display: 'block' }}>Status</span>
            {/* Block-level `flex` with a fixed height (not `inline-flex`): an
                inline-flex row sits on a text baseline in the parent's line
                box, so toggling the label between "Enabled" and "Paused"
                (different descenders) nudged the line-box height ~1px — and
                because the modal is vertically centered, that re-centered the
                whole dialog, reading as a layout shift. A fixed-height block
                row is baseline-independent, so the toggle never moves anything.
                The Switch is the sole control — keyboard-operable, with a
                STABLE aria-label ("Schedule enabled"); aria-checked conveys
                on/off, so the name must not change with state. The visible
                Enabled/Paused text is a non-interactive status echo, hidden
                from assistive tech (the switch already announces state). It's
                deliberately not a clickable <span> (mouse-only + unassociated)
                nor a <label> (the Switch's own hidden input would be
                double-activated). */}
            <div style={{
              display: 'flex', width: 'fit-content', alignItems: 'center', gap: 8, height: 22,
              fontFamily: FONT_BODY, fontSize: 13.5, color: 'var(--ink)',
            }}>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => update('enabled', v)}
                size="sm"
                aria-label="Schedule enabled"
              />
              <span aria-hidden="true" style={{ userSelect: 'none' }}>
                {form.enabled ? 'Enabled' : 'Paused'}
              </span>
            </div>
          </div>

          <Field label="Prompt">
            <Textarea
              value={form.prompt}
              onChange={(v) => update('prompt', v)}
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
              <Button variant="subtle" onClick={() => setConfirmingDelete(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger-solid" onClick={handleDelete} disabled={busy}>
                Delete
              </Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)} disabled={busy}>
              {Ico.trash ? Ico.trash(13) : null}
              Delete
            </Button>
          )
        )}
        {!isEdit && <span />}
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={busy}
          >
            {!isEdit && !busy && Ico.plus(14)}
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Create')}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}


// ── Helpers ──

function emptyForm({ defaultProjectPath }) {
  return {
    title: '',
    prompt: '',
    cadence: 'once',
    nextRunAt: defaultNextRun(),
    projectPath: defaultProjectPath || '',
    enabled: true,
  };
}
