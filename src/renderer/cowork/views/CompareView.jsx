// Compare models: one task given to two models, side by side.
//
// Each side is an ordinary conversation the server keeps in a hidden project,
// so a pane is a ChatView in `pane` mode fed from that conversation. The
// screen runs the two sides' streams itself rather than through App's
// single app-wide stream slot, which holds one turn at a time.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { host } from '../../platform/host';
import ChatView from './ChatView';
import ModelSelect from '../components/ModelSelect.jsx';
import { ConfirmModal } from '../components/ConfirmModal';
import { PageHeader } from '../components/collection';
import { Alert, Button, CardRow, EmptyState, Select, Spinner, Textarea } from '../components/ui';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import Ico from '../components/Icons';
import { buildModelPickerOptions } from '../lib/modelPickerOptions';
import { initialStreamState, reduceStream } from '../lib/responseStreamAdapter';
import { relativeAge } from '../lib/formatTime';
import { projectLabel } from '../lib/projectLabel';
import {
  cancelResponse,
  continueComparisonSide,
  createComparison,
  deleteComparison,
  fetchComparison,
  fetchComparisons,
  fetchInFlightStatus,
  fetchSession,
  recordComparisonVerdict,
  streamMessage,
  tailInFlight,
  uploadAttachments,
} from '../api';
import {
  SIDE_LABELS,
  VERDICT_LABELS,
  divergedAt,
  formatDuration,
  judgeableTurn,
  messagesUpToTurn,
  sendTargets,
  titleFromPrompt,
  totalDurationMs,
  turnDurationMs,
  turnsOf,
} from '../lib/compareSides';

// Web turns do not carry a reasoning effort yet, so offering the pick there
// would show a setting that does nothing.
const EFFORT_SUPPORTED = !host.isWeb;

const EMPTY_START = '__empty__';

// Failures of the connection itself. Anything else the agent reported is saved
// with the turn and drawn by the transcript as its error card, so repeating it
// above the pane would show it twice.
const TRANSPORT_ERRORS = new Set(['stream_error', 'reconnect_error', 'stalled']);

function modelName(models, id) {
  return models.find((m) => m.id === id)?.name || id;
}

function sideTitle(label, side, models) {
  const effort = side?.reasoningEffort ? ` · ${side.reasoningEffort}` : '';
  return `${label.toUpperCase()} · ${modelName(models, side?.model)}${effort}`;
}

export default function CompareView({ models = [], modelMeta, projects = [], agentLabel, onOpenTask }) {
  const [comparisons, setComparisons] = useState(undefined);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('list');
  const [openId, setOpenId] = useState(null);
  // The new-comparison form's prompt, sent by the detail screen once both
  // sides have loaded.
  const [firstSend, setFirstSend] = useState(null);

  const reload = useCallback(async () => {
    try {
      setComparisons(await fetchComparisons());
      setLoadError('');
    } catch (err) {
      setLoadError(err?.message || 'Could not load comparisons.');
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  if (comparisons === null) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <PageHeader title="Compare models" />
        <EmptyState
          icon={Ico.columns(28)}
          title="Update needed"
          description="This version of the app's server can't run comparisons yet. Restart the app to update it."
        />
      </div>
    );
  }

  if (mode === 'new') {
    return (
      <NewComparison
        models={models}
        modelMeta={modelMeta}
        projects={projects}
        onCancel={() => setMode('list')}
        onStarted={(comparison, firstSend) => {
          setFirstSend(firstSend);
          setOpenId(comparison.id);
          setMode('detail');
          reload();
        }}
      />
    );
  }

  if (mode === 'detail' && openId) {
    return (
      <ComparisonDetail
        comparisonId={openId}
        models={models}
        projects={projects}
        agentLabel={agentLabel}
        firstSend={firstSend?.comparisonId === openId ? firstSend : null}
        onFirstSendDone={() => setFirstSend(null)}
        onBack={() => { setMode('list'); setOpenId(null); reload(); }}
        onDeleted={() => { setMode('list'); setOpenId(null); reload(); }}
        onOpenTask={onOpenTask}
      />
    );
  }

  return (
    <ComparisonHistory
      comparisons={comparisons}
      error={loadError}
      models={models}
      onNew={() => setMode('new')}
      onOpen={(id) => { setOpenId(id); setMode('detail'); }}
    />
  );
}

function ComparisonHistory({ comparisons, error, models, onNew, onOpen }) {
  const rows = comparisons || [];
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PageHeader
        title="Compare models"
        subtitle="Give the same task to two models and see how each one handles it."
        actions={<Button variant="primary" onClick={onNew}>New comparison</Button>}
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-8">
        {error && <Alert variant="danger">{error}</Alert>}
        {comparisons === undefined && !error && <div className="py-10 text-center"><Spinner /></div>}
        {comparisons !== undefined && rows.length === 0 && !error && (
          <EmptyState
            icon={Ico.columns(28)}
            title="No comparisons yet"
            description="Pick two models and a task. Both work on it at the same time, each on its own copy of the files."
            action={<Button variant="primary" onClick={onNew}>New comparison</Button>}
          />
        )}
        {rows.map((c) => {
          const [a, b] = c.sides || [];
          const turns = Math.max(a?.turnCount || 0, b?.turnCount || 0);
          return (
            <CardRow
              key={c.id}
              as="div"
              onActivate={() => onOpen(c.id)}
              className="grid gap-[14px] py-3 px-[14px] items-center grid-cols-[minmax(0,2.4fr)_minmax(0,1.6fr)_90px_130px_90px]"
            >
              <span className="truncate text-ink">{c.title}</span>
              <span className="truncate text-ink-3">
                {modelName(models, a?.model)} vs {modelName(models, b?.model)}
              </span>
              <span className="text-ink-3 font-mono text-xs">{turns} {turns === 1 ? 'turn' : 'turns'}</span>
              <span className="text-ink-3 text-xs truncate">{c.verdict ? VERDICT_LABELS[c.verdict] : 'No verdict'}</span>
              <span className="text-ink-4 font-mono text-xs">{relativeAge(c.createdAt)}</span>
            </CardRow>
          );
        })}
      </div>
    </div>
  );
}

function SidePicker({ label, value, onChange, models, modelMeta }) {
  const options = useMemo(() => buildModelPickerOptions(models, modelMeta), [models, modelMeta]);
  const efforts = EFFORT_SUPPORTED ? modelMeta?.modelEfforts || {} : undefined;
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-xs text-ink-3 font-mono uppercase tracking-[0.08em]">Model {label.toUpperCase()}</span>
      <ModelSelect
        value={value.model}
        onValueChange={(model) => onChange({ model, reasoningEffort: '' })}
        options={options}
        {...(efforts ? {
          modelEfforts: efforts,
          effort: value.reasoningEffort,
          onEffortChange: (reasoningEffort) => onChange({ ...value, reasoningEffort }),
        } : {})}
      />
    </div>
  );
}

function NewComparison({ models, modelMeta, projects, onCancel, onStarted }) {
  const [prompt, setPrompt] = useState('');
  const [sides, setSides] = useState({ a: { model: '', reasoningEffort: '' }, b: { model: '', reasoningEffort: '' } });
  const [source, setSource] = useState(EMPTY_START);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  const ready = prompt.trim() && sides.a.model && sides.b.model && !busy;
  const projectOptions = [
    { value: EMPTY_START, label: 'Start empty' },
    ...projects.map((p) => ({ value: String(p.id), label: projectLabel(p) })),
  ];

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const comparison = await createComparison({
        title: titleFromPrompt(prompt),
        sides: SIDE_LABELS.map((label) => ({
          model: sides[label].model,
          reasoningEffort: EFFORT_SUPPORTED ? sides[label].reasoningEffort || null : null,
        })),
        sourceProjectId: source === EMPTY_START ? null : source,
      });
      onStarted(comparison, { comparisonId: comparison.id, text: prompt.trim(), files });
    } catch (err) {
      setError(err?.message || 'Could not start the comparison.');
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PageHeader onBack={onCancel} backLabel="Compare models" current="New comparison" />
      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-8">
        <div className="max-w-[760px] mx-auto flex flex-col gap-5">
          <Textarea
            value={prompt}
            onChange={setPrompt}
            rows={5}
            placeholder="Describe the task. Both models get exactly this."
            aria-label="Task for both models"
          />
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            {SIDE_LABELS.map((label) => (
              <SidePicker
                key={label}
                label={label}
                value={sides[label]}
                onChange={(next) => setSides((prev) => ({ ...prev, [label]: next }))}
                models={models}
                modelMeta={modelMeta}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1 items-end">
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="text-xs text-ink-3 font-mono uppercase tracking-[0.08em]">Files</span>
              <Select
                value={source}
                onValueChange={setSource}
                options={projectOptions}
                aria-label="Start from a project"
              />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => { setFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
              />
              <Button variant="subtle" onClick={() => fileInput.current?.click()}>
                {Ico.attach(14)} Attach files
              </Button>
              {files.length > 0 && (
                <span className="text-xs text-ink-3 truncate">
                  {files.length === 1 ? files[0].name : `${files.length} files`}
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-ink-4 m-0">
            Each model works on its own copy of the files. Connected data sources use your real
            credentials, so a task that changes data changes it for both. Nothing is published or
            sent through messaging apps until you continue with one side.
          </p>
          {error && <Alert variant="danger">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="subtle" onClick={onCancel}>Cancel</Button>
            <Button variant="primary" disabled={!ready} onClick={start}>
              {busy ? 'Starting…' : 'Start comparison'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function withStreaming(messages, state) {
  const base = (messages || []).filter((m) => m.role !== '_streaming');
  return [...base, {
    role: '_streaming',
    content: state.bodyText,
    steps: state.steps,
    currentThought: state.currentThought,
    startedAt: state.startedAt,
    streamStatus: state.status,
  }];
}

function useComparisonSides(comparison) {
  const [tasks, setTasks] = useState({});
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});
  const streams = useRef({});

  const sideByLabel = useMemo(
    () => Object.fromEntries((comparison?.sides || []).map((s) => [s.label, s])),
    [comparison],
  );

  const refresh = useCallback(async (label) => {
    const side = sideByLabel[label];
    if (!side) return null;
    const task = await fetchSession(side.conversationId);
    if (task) setTasks((prev) => ({ ...prev, [label]: task }));
    return task;
  }, [sideByLabel]);

  const follow = useCallback((label, open) => {
    let state = initialStreamState();
    setBusy((prev) => ({ ...prev, [label]: true }));
    setErrors((prev) => ({ ...prev, [label]: '' }));
    const finish = (message) => {
      streams.current[label] = null;
      setBusy((prev) => ({ ...prev, [label]: false }));
      if (message) setErrors((prev) => ({ ...prev, [label]: message }));
      refresh(label);
    };
    streams.current[label] = open({
      onEvent(ev) {
        state = reduceStream(state, ev);
        setTasks((prev) => {
          const task = prev[label];
          return task ? { ...prev, [label]: { ...task, messages: withStreaming(task.messages, state) } } : prev;
        });
      },
      onDone() { finish(''); },
      onError(message, event) { finish(TRANSPORT_ERRORS.has(event?.code) ? message : ''); },
    });
  }, [refresh]);

  // Load both sides, and re-attach to a turn still running on the server --
  // the sides keep working when the user leaves this screen.
  useEffect(() => {
    if (!comparison) return undefined;
    let cancelled = false;
    (async () => {
      for (const side of comparison.sides) {
        const task = await refresh(side.label);
        if (cancelled || !task || side.continuedAt) continue;
        const status = await fetchInFlightStatus(side.conversationId);
        if (cancelled || !status?.in_flight) continue;
        follow(side.label, (callbacks) => tailInFlight(side.conversationId, callbacks));
      }
    })();
    return () => {
      cancelled = true;
      for (const ctrl of Object.values(streams.current)) ctrl?.abort?.();
      streams.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparison?.id]);

  const send = useCallback((label, text, attachmentIds = []) => {
    const side = sideByLabel[label];
    if (!side) return;
    setTasks((prev) => {
      const task = prev[label];
      if (!task) return prev;
      const user = { role: 'user', content: text, created_at: new Date().toISOString() };
      return { ...prev, [label]: { ...task, messages: [...task.messages, user] } };
    });
    follow(label, (callbacks) => streamMessage(side.conversationId, text, {
      projectId: side.projectId,
      model: side.model,
      ...(EFFORT_SUPPORTED && side.reasoningEffort ? { reasoningEffort: side.reasoningEffort } : {}),
      attachmentIds,
      ...callbacks,
    }));
  }, [sideByLabel, follow]);

  const stop = useCallback((label) => {
    const side = sideByLabel[label];
    if (side) cancelResponse(side.conversationId);
  }, [sideByLabel]);

  return { tasks, busy, errors, send, stop, refresh };
}

function ComparisonDetail({ comparisonId, models, projects, agentLabel, firstSend, onFirstSendDone, onBack, onDeleted, onOpenTask }) {
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState('');
  const [target, setTarget] = useState('both');
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [continuing, setContinuing] = useState(null);

  const loadComparison = useCallback(async () => {
    try {
      setComparison(await fetchComparison(comparisonId));
    } catch (err) {
      setError(err?.message || 'Could not load this comparison.');
    }
  }, [comparisonId]);

  useEffect(() => { loadComparison(); }, [loadComparison]);

  const { tasks, busy, errors, send, stop } = useComparisonSides(comparison);
  const sides = useMemo(
    () => Object.fromEntries((comparison?.sides || []).map((s) => [s.label, s])),
    [comparison],
  );

  const shownMessages = (label) => messagesUpToTurn(
    tasks[label]?.messages || [],
    sides[label]?.continuedAt ? sides[label].continuedTurnCount : null,
  );
  const turns = { a: turnsOf(shownMessages('a')), b: turnsOf(shownMessages('b')) };
  const diverged = divergedAt(turns.a, turns.b);
  const judgeable = judgeableTurn(turns.a, turns.b);
  const verdictFor = (turnIndex) => comparison?.verdicts?.find((v) => v.turnIndex === turnIndex)?.winner || null;
  const loaded = SIDE_LABELS.every((label) => tasks[label]);

  const sendToSides = useCallback(async (text, labels, files = []) => {
    for (const label of labels) {
      let attachmentIds = [];
      if (files.length) {
        const task = tasks[label];
        try {
          const uploaded = await uploadAttachments(files, { projectName: task?.projectName, sessionId: sides[label].conversationId });
          attachmentIds = uploaded.map((a) => a.id).filter(Boolean);
        } catch (err) {
          setError(err?.message || 'Could not attach the files.');
          return;
        }
      }
      send(label, text, attachmentIds);
    }
  }, [tasks, sides, send]);

  // The prompt from the new-comparison form goes to both sides once both have
  // loaded, so neither starts ahead of the other. The parent drops it as it is
  // sent, which is what keeps a later render from sending it again.
  useEffect(() => {
    if (!firstSend || !loaded) return;
    onFirstSendDone?.();
    sendToSides(firstSend.text, SIDE_LABELS, firstSend.files || []);
  }, [firstSend, loaded, sendToSides, onFirstSendDone]);

  const sideState = Object.fromEntries(SIDE_LABELS.map((label) => [label, {
    continued: !!sides[label]?.continuedAt,
    busy: !!busy[label],
  }]));
  const targets = sendTargets(target, sideState);
  const skipped = (target === 'both' ? SIDE_LABELS : [target]).filter((l) => !targets.includes(l));
  // All or nothing: a message meant for both must not quietly reach only the
  // side that happens to be free, which would make the two diverge.
  const canSend = targets.length > 0 && skipped.length === 0;

  const submit = () => {
    const text = draft.trim();
    if (!text || !canSend) return;
    setDraft('');
    sendToSides(text, targets);
  };

  const judge = async (winner) => {
    if (judgeable === null) return;
    try {
      setComparison(await recordComparisonVerdict(comparisonId, judgeable, winner));
    } catch (err) {
      setError(err?.message || 'Could not save the verdict.');
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteComparison(comparisonId);
      onDeleted();
    } catch (err) {
      setError(err?.message || 'Could not delete the comparison.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (!comparison) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <PageHeader onBack={onBack} backLabel="Compare models" current="Comparison" />
        {error ? <div className="px-7"><Alert variant="danger">{error}</Alert></div> : <div className="py-10 text-center"><Spinner /></div>}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PageHeader
        onBack={onBack}
        backLabel="Compare models"
        current={comparison.title}
        actions={<Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>}
      />
      {error && <div className="px-7 pb-2"><Alert variant="danger">{error}</Alert></div>}
      {diverged !== null && (
        <div className="px-7 pb-2 text-xs text-ink-3" role="status">
          The sides diverged at turn {diverged + 1}: from there on they were not asked the same thing.
        </div>
      )}
      <div className="flex-1 min-h-0 grid grid-cols-2 max-md:grid-cols-1 gap-3 px-4">
        {SIDE_LABELS.map((label) => (
          <SidePane
            key={label}
            label={label}
            side={sides[label]}
            task={tasks[label] ? { ...tasks[label], messages: shownMessages(label) } : null}
            turns={turns[label]}
            busy={!!busy[label]}
            error={errors[label]}
            models={models}
            projects={projects}
            agentLabel={agentLabel}
            onStop={() => stop(label)}
            onSendHere={(text) => sendToSides(text, sendTargets(label, sideState))}
            onContinue={() => setContinuing(label)}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
      <div className="px-7 pt-3 pb-5 flex flex-col gap-2 max-w-[1100px] w-full mx-auto">
        {judgeable !== null && (
          <div className="flex items-center gap-2 flex-wrap" aria-label="Which was better?">
            <span className="text-xs text-ink-3">Turn {judgeable + 1}: which was better?</span>
            {Object.entries(VERDICT_LABELS).map(([winner, text]) => (
              <Button
                key={winner}
                size="sm"
                variant={verdictFor(judgeable) === winner ? 'primary' : 'subtle'}
                aria-pressed={verdictFor(judgeable) === winner}
                onClick={() => judge(winner)}
              >
                {text}
              </Button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <Textarea
              value={draft}
              onChange={setDraft}
              rows={2}
              placeholder={target === 'both' ? 'Follow up with both models' : `Follow up with ${target.toUpperCase()} only`}
              aria-label="Follow-up message"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
              }}
            />
          </div>
          <ToggleGroup
            value={target}
            onValueChange={setTarget}
            aria-label="Send to"
            options={[
              { value: 'both', label: 'Both' },
              { value: 'a', label: 'A only' },
              { value: 'b', label: 'B only' },
            ]}
          />
          <Button variant="primary" disabled={!draft.trim() || !canSend} onClick={submit}>Send</Button>
        </div>
        {skipped.length > 0 && (
          <span className="text-xs text-ink-4">
            {skipped.map((l) => l.toUpperCase()).join(' and ')} {skipped.length === 1 ? 'is' : 'are'} not taking messages right now
            {sideState[skipped[0]]?.continued ? ' (continued as a task).' : ' (still answering).'}
          </span>
        )}
        {target !== 'both' && (
          <span className="text-xs text-ink-4">Sending to one side makes the two diverge.</span>
        )}
      </div>
      <ConfirmModal
        open={confirmDelete}
        title="Delete this comparison?"
        message="Both sides and everything they built are removed. A side you continued as a task stays."
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={doDelete}
        onClose={() => setConfirmDelete(false)}
      />
      {continuing && (
        <ContinueDialog
          label={continuing}
          projects={projects}
          onClose={() => setContinuing(null)}
          onContinue={async (projectId) => {
            const result = await continueComparisonSide(comparisonId, continuing, projectId);
            setContinuing(null);
            await loadComparison();
            onOpenTask?.(result?.conversationId);
          }}
        />
      )}
    </div>
  );
}

function SidePane({ label, side, task, turns, busy, error, models, projects, agentLabel, onStop, onSendHere, onContinue }) {
  const last = turns[turns.length - 1];
  const total = totalDurationMs(turns);
  const project = task ? { id: side?.projectId, name: task.projectName, path: task.projectPath } : null;
  return (
    <section
      aria-label={`Side ${label.toUpperCase()}`}
      className="min-h-0 flex flex-col rounded-[14px] border border-solid border-line bg-surface overflow-hidden"
    >
      <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-x-0 border-t-0 border-solid border-line">
        <span className="font-mono text-xs text-ink truncate">{sideTitle(label, side, models)}</span>
        <span className="flex items-center gap-2 flex-shrink-0">
          <span className="font-mono text-[11px] text-ink-3" title="Time on the latest turn · on all turns">
            {busy ? 'working…' : formatDuration(turnDurationMs(last))} · {formatDuration(total.counted ? total.total : null)}
          </span>
          {busy && <Button size="xs" variant="subtle" onClick={onStop}>Stop</Button>}
          {side?.continuedAt
            ? <span className="text-[11px] text-ink-3">Continued as a task</span>
            : !busy && turns.length > 0 && <Button size="xs" variant="subtle" onClick={onContinue}>Continue with {label.toUpperCase()}</Button>}
        </span>
      </header>
      {error && <div className="px-4 pt-2"><Alert variant="danger">{error}</Alert></div>}
      <div className="flex-1 min-h-0 flex flex-col">
        {task ? (
          <ChatView
            pane
            task={task}
            project={project}
            projects={projects}
            agentLabel={agentLabel}
            onSend={onSendHere}
          />
        ) : (
          <div className="py-10 text-center"><Spinner /></div>
        )}
      </div>
    </section>
  );
}

function ContinueDialog({ label, projects, onClose, onContinue }) {
  const [projectId, setProjectId] = useState(projects[0] ? String(projects[0].id) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <ConfirmModal
      open
      title={`Continue with ${label.toUpperCase()}`}
      message={(
        <div className="flex flex-col gap-3">
          <span>
            This side becomes an ordinary task in the project you pick, with its history and artifacts.
            The comparison keeps what was compared.
          </span>
          <Select
            value={projectId}
            onValueChange={setProjectId}
            options={projects.map((p) => ({ value: String(p.id), label: projectLabel(p) }))}
            aria-label="Project to continue in"
          />
        </div>
      )}
      confirmLabel="Continue"
      busy={busy}
      error={error}
      onConfirm={async () => {
        if (!projectId) return;
        setBusy(true);
        setError('');
        try {
          await onContinue(projectId);
        } catch (err) {
          setError(err?.message || 'Could not continue with this side.');
          setBusy(false);
        }
      }}
      onClose={onClose}
    />
  );
}
