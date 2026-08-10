// Schedule a new task — modal that replaces the previous inline form.
// Used for both create and edit; pass `task` to enable edit mode.
//
// Layout: title (full width) → cadence + next-run (two columns) →
// project (full width) → status toggle → prompt textarea (full width,
// the most important field, sits last so it gets the room it needs).

import { useEffect, useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import { Alert, Button, Field, Select, Input, Textarea } from '../ui';
import { Switch } from '../ui/Switch';
import Ico from '../Icons';

const FONT_BODY = 'var(--font-body)';

// Sentinel for the "No project" (unassigned) choice in the Project <Select>.
// It must be a non-empty string: Base UI's <Select.Value> treats an
// empty-string value as "nothing selected" and renders the placeholder, so an
// option with value '' shows "Select…" on the closed control even while its
// item carries a checkmark (ENG-1246). This value never reaches the server —
// `handleSubmit` resolves it to `project_id: null` (server → general), and it
// can't collide with a real project path.
const NO_PROJECT = '__no_project__';

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

// Unambiguous echo of the datetime-local value. The native <input
// type="datetime-local"> renders in Chromium's UI locale, which in Electron
// can disagree with the OS regional format (e.g. shows DD/MM on an en_US
// machine) — ambiguous for the first 12 days of a month on a control that
// decides when a task runs (ENG-1244). A spelled-out month removes the
// ambiguity regardless of what the native control shows. Takes the local
// "YYYY-MM-DDTHH:mm" string the input holds.
function formatNextRunEcho(local) {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
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

export default function ScheduleTaskModal({
  open, onClose, onSubmit,
  task,                    // when set → edit mode
  projects = [],
  defaultProjectPath = '',
  busy = false,
  agentLabel,
}) {
  const isEdit = !!task;

  const [form, setForm] = useState(() => emptyForm({ defaultProjectPath }));
  const [error, setError] = useState('');

  // Whenever the modal opens (or the editing target changes), reset
  // form state so reopening doesn't show stale fields from a previous
  // pass.
  useEffect(() => {
    if (!open) return;
    setError('');
    if (task) {
      // The server keys the project association by `projectId` (a UUID) and
      // the form's Project select uses the project PATH as its value. Hydrate
      // by resolving the stored id back to a path via `projects` (ENG-1255).
      const taskProjectPath = (() => {
        if (task.projectId) {
          const match = projects.find((p) => p.id === task.projectId);
          if (match?.path) return match.path;
        }
        return '';
      })();
      setForm({
        title:       task.title || '',
        prompt:      task.prompt || '',
        cadence:     task.cadence || 'once',
        nextRunAt:   toLocalInput(task.nextRunAt) || defaultNextRun(),
        projectPath: taskProjectPath || defaultProjectPath || NO_PROJECT,
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
    // The server keys the project association by `project_id` (a UUID); a
    // bare name is silently dropped and the schedule falls back to the general
    // project (ENG-1255). Resolve the selected path → project id via
    // `projects`. The "No project" sentinel sends null (server → general).
    const projectMatch = form.projectPath === NO_PROJECT
      ? null
      : projects.find((p) => p.path === form.projectPath);
    const payload = {
      title:        form.title.trim() || form.prompt.trim().slice(0, 80),
      prompt:       form.prompt,
      cadence:      form.cadence,
      timezone:     Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
      next_run_at:  new Date(form.nextRunAt).toISOString(),
      project_id:   projectMatch?.id || null,
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
              {formatNextRunEcho(form.nextRunAt) && (
                <span style={{
                  marginTop: 5, fontFamily: FONT_BODY, fontSize: 11.5,
                  color: 'var(--ink-3)',
                }}>
                  {formatNextRunEcho(form.nextRunAt)}
                </span>
              )}
            </Field>
          </div>

          <Field label="Project">
            <Select
              value={form.projectPath}
              onValueChange={(v) => update('projectPath', v)}
              ariaLabel="Project"
              style={fieldSelectStyle}
              options={[
                // "No project" is the unassigned mode, not a project — divide
                // it from the real projects (which map 1:1 to the projects page).
                { value: NO_PROJECT, label: 'No project' },
                { separator: true },
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
            <Alert variant="danger">{error}</Alert>
          )}
        </div>
      </ModalBody>
      {/* Footer is edit/create only — deleting a schedule lives on the task
          card/detail overflow menu (with its own confirm), not inside this
          form, so the footer never carries a destructive action. */}
      <ModalFooter align="flex-end">
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
    projectPath: defaultProjectPath || NO_PROJECT,
    enabled: true,
  };
}
