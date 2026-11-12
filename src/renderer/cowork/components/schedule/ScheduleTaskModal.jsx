// Schedule a new task, or edit one: the same modal for both; pass `task` to
// edit.
//
// Layout: the name, what to do (the prompt), then when, read back as a
// sentence with the next few runs, then the project and model side by side.
// Pausing lives on the task's page and row, not here.
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
  INTERVAL_MINUTES, defaultWhen, describeWhen, formatRun, nextRuns, timeZoneLabel, weekdayName, whenFromDate,
} from '../../lib/scheduleWhen';
import Ico from '../Icons';
import ModelSelect from '../ModelSelect.jsx';
import { buildModelPickerOptions, offeredModels, withModelPickerFallback } from '../../lib/modelPickerOptions';
import { modelPickerMode } from '../../../lib/modelPicker';
import { PLATFORM_UI } from '../../../lib/deployment';
import { productName } from '../../../lib/deploymentBrand';
import { host } from '../../../platform/host';
import { askToNotify } from '../../hooks/useAutoPauseNotifications';
import { scheduleState } from './ScheduleStatusBadge';
import { useTranslation } from '../../../lib/i18n';

const FONT_BODY = 'var(--font-body)';

// Sentinel for the "No project" (unassigned) choice in the Project <Select>.
// It must be a non-empty string: Base UI's <Select.Value> treats an
// empty-string value as "nothing selected" and renders the placeholder, so an
// option with value '' shows "Select…" on the closed control even while its
// item carries a checkmark (ENG-1246). This value never reaches the server —
// `handleSubmit` resolves it to `project_id: null` (server → general), and it
// can't collide with a real project path.
const NO_PROJECT = '__no_project__';

// The server's value for "run on the account's default models". A run whose
// pinned model can't be served falls back to it.
const DEFAULT_MODEL = 'default';

// Cadence values and their label keys (scheduleTaskModal.cadence.*).
const CADENCE_OPTIONS = [
  { value: 'once',     key: 'once' },
  { value: 'every_15_minutes', key: 'every15' },
  { value: 'every_30_minutes', key: 'every30' },
  { value: 'hourly',   key: 'hourly' },
  { value: 'daily',    key: 'daily' },
  { value: 'weekdays', key: 'weekdays' },
  { value: 'weekly',   key: 'weekly' },
];

// Mon first, as a week reads; values are JS getDay() numbers.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

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
  models = [],
  modelMeta = {},
  defaultProjectPath = '',
  busy = false,
  agentLabel,
}) {
  const { t } = useTranslation('projects');
  const isEdit = !!task;
  const displayName = productName(agentLabel);
  const cadenceOptions = CADENCE_OPTIONS.map(({ value, key }) => ({ value, label: t(`scheduleTaskModal.cadence.${key}`) }));
  const weekdayOptions = WEEKDAY_ORDER.map((d) => ({ value: String(d), label: weekdayName(d) }));

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
        model:       task.model || DEFAULT_MODEL,
        ...at,
      });
    } else {
      setForm(emptyForm({ defaultProjectPath }));
    }
  }, [open, task?.id, defaultProjectPath, projects]);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const upcoming = useMemo(() => nextRuns(form, new Date(), 3), [form]);
  const zone = timeZoneLabel();
  // The same models the chat composer offers. With platform UI off, the
  // operator's picker decides: off shows no field at all (the operator's
  // own models run), and otherwise only the models it offers.
  const pickable = useMemo(() => {
    if (PLATFORM_UI) return models;
    return modelPickerMode() === 'off' ? [] : offeredModels(models, modelMeta?.modelEnabled);
  }, [models, modelMeta?.modelEnabled]);
  const showModel = PLATFORM_UI || pickable.length > 0;
  const modelOptions = useMemo(() => [
    { value: DEFAULT_MODEL, label: t('scheduleTaskModal.accountDefault'), pin: 'top' },
    // A pin the catalog no longer lists stays selectable as itself, where
    // the user picks freely; an operator's list offers only its own models.
    ...buildModelPickerOptions(
      PLATFORM_UI ? withModelPickerFallback(pickable, form.model === DEFAULT_MODEL ? '' : form.model) : pickable,
      modelMeta,
    ),
  ], [pickable, modelMeta, form.model, t]);
  // What is sent: the pick when it's on offer, else the default.
  const sentModel = !showModel
    ? DEFAULT_MODEL
    : (PLATFORM_UI || pickable.some((m) => m.id === form.model) ? form.model : DEFAULT_MODEL);

  async function handleSubmit({ runOnce = false } = {}) {
    if (!form.prompt.trim()) {
      setError(t('scheduleTaskModal.errorNoPrompt', { agent: displayName }));
      return;
    }
    const first = upcoming[0];
    if (!first) {
      setError(form.cadence === 'once' ? t('scheduleTaskModal.errorPickFutureTime') : t('scheduleTaskModal.errorPickTime'));
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
      // Sent even when it's the default, so an edit can clear a pin.
      model:        sentModel,
    };
    // A one-off that already ran stays off when only its time changes, so a
    // new time in the future turns it back on: "from the next run" is true.
    if (isEdit && form.cadence === 'once' && scheduleState(task) === 'done') {
      payload.enabled = true;
    }
    try {
      await onSubmit(payload, task?.id || null, { runOnce });
      onClose?.();
    } catch (err) {
      setError(err?.message || t('scheduleTaskModal.errorSave'));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      labelledBy="schedule-modal-title"
      // Don't dismiss while saving.
      dismissible={!busy}
    >
      <ModalHeader
        id="schedule-modal-title"
        title={isEdit ? t('scheduleTaskModal.editTitle') : t('scheduleTaskModal.createTitle')}
        subtitle={isEdit
          ? t('scheduleTaskModal.editSubtitle')
          : host.isWeb
            ? t('scheduleTaskModal.createSubtitleWeb', { agent: displayName })
            : t('scheduleTaskModal.createSubtitleDesktop', { agent: displayName })}
        onClose={onClose}
      />
      <ModalBody padding="18px 20px">
        <div className="flex flex-col gap-[18px]">
          <Field label={t('scheduleTaskModal.name')} optional>
            <Input
              value={form.title}
              onChange={(v) => update('title', v)}
              placeholder={t('scheduleTaskModal.namePlaceholder')}
              style={fieldInput}
            />
          </Field>

          <Field label={t('scheduleTaskModal.promptLabel', { agent: displayName })}>
            <Textarea
              value={form.prompt}
              onChange={(v) => update('prompt', v)}
              placeholder={t('scheduleTaskModal.promptPlaceholder', { agent: displayName })}
              rows={4}
              autoFocus
              style={{ ...fieldInput, resize: 'vertical', lineHeight: 1.45 }}
            />
          </Field>

          <div className="flex flex-col gap-2.5">
            <span className="inline-flex items-center gap-1 text-sm font-medium text-ink-2">
              {t('scheduleTaskModal.when')}
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
                ariaLabel={t('scheduleTaskModal.howOften')}
                width={160}
                style={fieldSelectStyle}
                options={cadenceOptions}
              />
              {form.cadence === 'weekly' && (
                <Select
                  value={String(form.weekday)}
                  onValueChange={(v) => v && update('weekday', Number(v))}
                  ariaLabel={t('scheduleTaskModal.dayOfWeek')}
                  width={140}
                  style={fieldSelectStyle}
                  options={weekdayOptions}
                />
              )}
              {form.cadence === 'once' && (
                <Input
                  type="date"
                  aria-label={t('scheduleTaskModal.date')}
                  value={form.date}
                  onChange={(v) => update('date', v)}
                  style={{ ...fieldInput, width: 170 }}
                />
              )}
              <span className="px-0.5 text-sm text-ink-3">{INTERVAL_MINUTES[form.cadence] ? t('scheduleTaskModal.atMinute') : t('scheduleTaskModal.at')}</span>
              <Input
                type="time"
                aria-label={t('scheduleTaskModal.time')}
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
                  ? t('scheduleTaskModal.nextRuns', { count: upcoming.length, runs: upcoming.map((d) => formatRun(d)).join(' · ') })
                  : t('scheduleTaskModal.timePassed')}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_1fr] gap-[14px]">
            <Field label={t('scheduleTaskModal.project')}>
              <Select
                value={form.projectPath}
                onValueChange={(v) => update('projectPath', v)}
                ariaLabel={t('scheduleTaskModal.project')}
                style={fieldSelectStyle}
                options={[
                  // "No project" is the unassigned mode, not a project — divide
                  // it from the real projects (which map 1:1 to the projects page).
                  { value: NO_PROJECT, label: t('scheduleCommon.noProject') },
                  { separator: true },
                  ...projects.map((p) => ({ value: p.path, label: projectLabel(p) })),
                ]}
              />
            </Field>
            {showModel && (
              <Field label={t('scheduleTaskModal.model')}>
                <ModelSelect
                  value={sentModel}
                  onValueChange={(v) => v && update('model', v)}
                  ariaLabel={t('scheduleTaskModal.model')}
                  variant="field"
                  style={fieldSelectStyle}
                  options={modelOptions}
                />
              </Field>
            )}
          </div>

          {error && (
            <Alert variant="danger">{error}</Alert>
          )}
        </div>
      </ModalBody>
      {/* Footer is edit/create only — deleting a schedule lives on the task
          card/detail overflow menu (with its own confirm), not inside this
          form, so the footer never carries a destructive action. */}
      <ModalFooter
        cancel={(
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            {t('scheduleTaskModal.cancel')}
          </Button>
        )}
      >
        {!isEdit && (
          // Create it and try it once now, rather than wait for its time
          // to find out whether the prompt works.
          <Button onClick={() => handleSubmit({ runOnce: true })} disabled={busy}>
            {t('scheduleTaskModal.saveAndRunOnce')}
          </Button>
        )}
        <Button
          variant="primary"
          onClick={() => handleSubmit()}
          disabled={busy}
        >
          {!isEdit && !busy && Ico.plus(14)}
          {busy ? t('scheduleTaskModal.saving') : (isEdit ? t('scheduleTaskModal.saveChanges') : t('scheduleTaskModal.schedule'))}
        </Button>
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
    model: DEFAULT_MODEL,
    ...defaultWhen(),
  };
}
