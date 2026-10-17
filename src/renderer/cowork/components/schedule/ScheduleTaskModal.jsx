// Schedule a new task, or edit one: the same modal for both; pass `task` to
// edit.
//
// Layout: what to do (the prompt) first, then when, read back as a sentence
// with the next few runs, then the name and project. Pausing lives on the
// task's page and row, not here.
//
// "When" is one line of compact controls sized to their values (how often,
// the day or date when that needs one, the time, the zone), the way calendar
// and scheduler forms read: "Every week · Monday · at 9:00 AM".

import { useEffect, useMemo, useState } from 'react';
import { projectLabel } from '../../lib/projectLabel';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import { Alert, Button, Field, Select, Input, Textarea, Tooltip } from '../ui';
import { missedRunLabel, missedRunText } from '../../lib/scheduleCopy';
import {
  WEEKDAY_NAMES, defaultWhen, describeWhen, formatRun, nextRuns, timeZoneLabel, whenFromDate,
} from '../../lib/scheduleWhen';
import Ico from '../Icons';
import { host } from '../../../platform/host';
import { askToNotify } from '../../hooks/useAutoPauseNotifications';

const FONT_BODY = 'var(--font-body)';

// Sentinel for the "No project" (unassigned) choice in the Project <Select>.
// It must be a non-empty string: Base UI's <Select.Value> treats an
// empty-string value as "nothing selected" and renders the placeholder, so an
// option with value '' shows "Select…" on the closed control even while its
// item carries a checkmark (ENG-1246). This value never reaches the server —
// `handleSubmit` resolves it to `project_id: null` (server → general), and it
// can't collide with a real project path.
const NO_PROJECT = '__no_project__';

const CADENCE_OPTIONS = [
  { value: 'once',     label: 'Once' },
  { value: 'hourly',   label: 'Every hour' },
  { value: 'daily',    label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly',   label: 'Every week' },
];

// Mon first, as a week reads; values are JS getDay() numbers.
const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: WEEKDAY_NAMES[d] }));

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
      const match = task.projectId ? projects.find((p) => p.id === task.projectId) : null;
      const at = task.nextRunAt && !Number.isNaN(new Date(task.nextRunAt).getTime())
        ? whenFromDate(task.nextRunAt, task.cadence || 'daily')
        : { ...defaultWhen(), cadence: task.cadence || 'daily' };
      setForm({
        title:       task.title || '',
        prompt:      task.prompt || '',
        projectPath: match?.path || defaultProjectPath || NO_PROJECT,
        ...at,
      });
    } else {
      setForm(emptyForm({ defaultProjectPath }));
    }
  }, [open, task?.id, defaultProjectPath, projects]);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const upcoming = useMemo(() => nextRuns(form, new Date(), 3), [form]);
  const zone = timeZoneLabel();

  async function handleSubmit({ runOnce = false } = {}) {
    if (!form.prompt.trim()) {
      setError(`Tell ${agentLabel} what to do.`);
      return;
    }
    const first = upcoming[0];
    if (!first) {
      setError(form.cadence === 'once' ? 'Pick a time in the future.' : 'Pick a time.');
      return;
    }
    setError('');
    // Still inside the click, which browsers require before they will ask.
    askToNotify();
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
      next_run_at:  first.toISOString(),
      project_id:   projectMatch?.id || null,
      // Scheduled tasks always use the user's configured default
      // model — exposing the picker here let people accidentally
      // pin a stale model id that's no longer valid.
      model:        null,
    };
    try {
      await onSubmit(payload, task?.id || null, { runOnce });
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
          ? `Changes apply from the next run.`
          : host.isWeb
            ? `${agentLabel} runs this on its own, even with this tab closed.`
            : `${agentLabel} runs this on its own while MindsHub is open.`}
        onClose={onClose}
      />
      <ModalBody padding="18px 20px">
        <div className="flex flex-col gap-[18px]">
          <Field label={`What should ${agentLabel} do?`}>
            <Textarea
              value={form.prompt}
              onChange={(v) => update('prompt', v)}
              placeholder={`Ask ${agentLabel} to…`}
              rows={4}
              autoFocus
              style={{ ...fieldInput, resize: 'vertical', lineHeight: 1.45 }}
            />
          </Field>

          <div className="flex flex-col gap-2.5">
            <span className="inline-flex items-center gap-1 text-sm font-medium text-ink-2">
              When
              {/* What happens when the app is closed at the task's time:
                  too long to sit under the field, so it's a tooltip. */}
              <Tooltip content={missedRunText(form.cadence)}>
                <button
                  type="button"
                  aria-label={missedRunLabel()}
                  className="inline-flex cursor-help border-0 bg-transparent p-0 text-ink-3 hover:text-ink"
                >
                  {Ico.info(12)}
                </button>
              </Tooltip>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={form.cadence}
                onValueChange={(v) => v && update('cadence', v)}
                ariaLabel="How often"
                width={160}
                style={fieldSelectStyle}
                options={CADENCE_OPTIONS}
              />
              {form.cadence === 'weekly' && (
                <Select
                  value={String(form.weekday)}
                  onValueChange={(v) => v && update('weekday', Number(v))}
                  ariaLabel="Day of the week"
                  width={140}
                  style={fieldSelectStyle}
                  options={WEEKDAY_OPTIONS}
                />
              )}
              {form.cadence === 'once' && (
                <Input
                  type="date"
                  aria-label="Date"
                  value={form.date}
                  onChange={(v) => update('date', v)}
                  style={{ ...fieldInput, width: 170 }}
                />
              )}
              <span className="px-0.5 text-sm text-ink-3">{form.cadence === 'hourly' ? 'at minute' : 'at'}</span>
              <Input
                type="time"
                aria-label="Time"
                value={form.time}
                onChange={(v) => update('time', v)}
                style={{ ...fieldInput, width: 130 }}
              />
              <span className="text-[12.5px] text-ink-3">{zone}</span>
            </div>
            {/* The schedule read back, so what is saved is what was meant. */}
            <div className="flex flex-col gap-1 rounded-card-row bg-surface-2 px-3.5 py-3" aria-live="polite">
              <span className="text-sm font-semibold text-ink">{describeWhen(form)}, {zone}</span>
              <span className="text-[12.5px] text-ink-3">
                {upcoming.length
                  ? `Next ${upcoming.length === 1 ? 'run' : 'runs'}: ${upcoming.map((d) => formatRun(d)).join(' · ')}`
                  : 'That time has passed.'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_1fr] gap-[14px]">
            <Field label="Name" optional>
              <Input
                value={form.title}
                onChange={(v) => update('title', v)}
                placeholder="Named from the prompt"
                style={fieldInput}
              />
            </Field>
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
                  ...projects.map((p) => ({ value: p.path, label: projectLabel(p) })),
                ]}
              />
            </Field>
          </div>

          {error && (
            <Alert variant="danger">{error}</Alert>
          )}
        </div>
      </ModalBody>
      {/* Footer is edit/create only — deleting a schedule lives on the task
          card/detail overflow menu (with its own confirm), not inside this
          form, so the footer never carries a destructive action. */}
      <ModalFooter align="flex-end">
        <div className="inline-flex gap-2">
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {!isEdit && (
            // Create it and try it once now, rather than wait for its time
            // to find out whether the prompt works.
            <Button onClick={() => handleSubmit({ runOnce: true })} disabled={busy}>
              Save and run once
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => handleSubmit()}
            disabled={busy}
          >
            {!isEdit && !busy && Ico.plus(14)}
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Schedule')}
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
    projectPath: defaultProjectPath || NO_PROJECT,
    ...defaultWhen(),
  };
}
