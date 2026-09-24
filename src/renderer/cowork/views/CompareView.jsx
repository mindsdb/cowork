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
import { OverflowMenu } from '../components/OverflowMenu';
import { PageHeader } from '../components/collection';
import { Alert, Badge, Button, CardRow, EmptyState, Select, Spinner, Tooltip } from '../components/ui';
import { ProviderIcon } from '../components/ProviderIcon';
import { SearchInput, SortPill } from '../components/collection';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import Ico from '../components/Icons';
import { buildModelPickerOptions } from '../lib/modelPickerOptions';
import { modelMaker } from '../lib/modelCatalog';
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
  VERDICT_ORDER,
  composerBlock,
  divergedAt,
  formatDuration,
  judgeableTurn,
  firstUserText,
  messagesUpToTurn,
  withoutFirstPrompt,
  sendTargets,
  sideNames,
  sideStatus,
  titleFromPrompt,
  totalDurationMs,
  turnDurationMs,
  turnsOf,
  verdictLabel,
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

function namesFor(models, a, b) {
  return sideNames(
    { name: modelName(models, a?.model), effort: a?.reasoningEffort },
    { name: modelName(models, b?.model), effort: b?.reasoningEffort },
  );
}

// Re-renders once a second while `active`, for a live "Working · 41s".
function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const STATUS_DOT = {
  working: 'bg-accent pulse-dot',
  done: 'bg-success',
  failed: 'bg-danger',
  muted: 'bg-ink-4',
};

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
        <PageHeader title="Compare Models" />
        <EmptyState
          icon={Ico.columns(28)}
          title="Update needed"
          description="This version of the app's server can't run comparisons yet. Restart the app to update it."
        />
      </div>
    );
  }

  // With nothing in the history yet, the start screen is the page.
  const firstVisit = mode === 'list' && Array.isArray(comparisons) && comparisons.length === 0;
  if (mode === 'new' || firstVisit) {
    return (
      <NewComparison
        models={models}
        modelMeta={modelMeta}
        projects={projects}
        onCancel={firstVisit ? null : () => setMode('list')}
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

const HISTORY_GRID = 'minmax(0, 3fr) minmax(0, 2fr) 56px 150px 72px 16px';
// Below this many comparisons a search box is clutter; above it, finding one
// by eye stops being quick.
const FILTER_THRESHOLD = 10;

const VERDICT_FILTERS = [
  { id: 'all', label: 'All verdicts' },
  { id: 'none', label: 'No verdict' },
  { id: 'judged', label: 'Has a verdict' },
];

const SORTS = [
  { id: 'recent', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'prompt', label: 'Prompt (A–Z)' },
];

function ModelTag({ id, name }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <ProviderIcon maker={modelMaker(id || '', name)} size={13} />
      <span className="truncate text-[13px] text-ink font-medium">{name}</span>
    </span>
  );
}

function VerdictChip({ verdict, names }) {
  if (!verdict) return <Badge variant="muted">No verdict</Badge>;
  if (verdict === 'a' || verdict === 'b') {
    return <Badge variant="accent" className="max-w-full truncate">{names[verdict]} preferred</Badge>;
  }
  return <Badge>{verdict === 'tie' ? 'Tie' : 'Neither'}</Badge>;
}

function HistoryHeaderRow() {
  const Cell = ({ children }) => (
    <div className="font-[family-name:var(--font-mono)] text-[10.5px] text-ink-4 tracking-[0.10em] uppercase">{children}</div>
  );
  return (
    <div
      className="grid gap-[14px] py-[10px] px-[14px] border-b border-t-0 border-x-0 border-solid border-line"
      style={{ gridTemplateColumns: HISTORY_GRID }}
    >
      <Cell>Prompt</Cell>
      <Cell>Models</Cell>
      <Cell>Turns</Cell>
      <Cell>Verdict</Cell>
      <Cell>Started</Cell>
      <Cell />
    </div>
  );
}

function modelFilterOptions(rows, models) {
  const ids = [...new Set(rows.flatMap((c) => (c.sides || []).map((s) => s.model)).filter(Boolean))];
  return [
    { id: 'all', label: 'All models' },
    ...ids.map((id) => ({ id, label: modelName(models, id) })).sort((x, y) => x.label.localeCompare(y.label)),
  ];
}

export function filterComparisons(rows, { query = '', verdict = 'all', sort = 'recent', model = 'all' } = {}, nameOf = (id) => id) {
  const q = query.trim().toLowerCase();
  const out = rows.filter((c) => {
    if (model !== 'all' && !(c.sides || []).some((s) => s.model === model)) return false;
    if (verdict === 'none' && c.verdict) return false;
    if (verdict === 'judged' && !c.verdict) return false;
    if (!q) return true;
    const haystack = [c.title, ...(c.sides || []).flatMap((s) => [s.model, nameOf(s.model)])].join(' ').toLowerCase();
    return haystack.includes(q);
  });
  const time = (c) => Date.parse(c.createdAt || '') || 0;
  if (sort === 'oldest') out.sort((x, y) => time(x) - time(y));
  else if (sort === 'prompt') out.sort((x, y) => (x.title || '').localeCompare(y.title || ''));
  else out.sort((x, y) => time(y) - time(x));
  return out;
}

function ComparisonHistory({ comparisons, error, models, onNew, onOpen }) {
  const [query, setQuery] = useState('');
  const [verdict, setVerdict] = useState('all');
  const [model, setModel] = useState('all');
  const [sort, setSort] = useState('recent');
  const all = comparisons || [];
  const filtering = all.length > FILTER_THRESHOLD;
  const rows = filtering
    ? filterComparisons(all, { query, verdict, sort, model }, (id) => modelName(models, id))
    : all;
  const newButton = (
    <Button variant="primary" onClick={onNew}>{Ico.plus(14)} New comparison</Button>
  );
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PageHeader
        title="Comparisons"
        subtitle="View your past model comparisons."
        actions={newButton}
      />
      <div className="flex-1 min-h-0 overflow-y-auto pb-8">
        <div className="max-w-[1080px] mx-auto w-full px-7 flex flex-col gap-3">
          {error && <Alert variant="danger">{error}</Alert>}
          {comparisons === undefined && !error && <div className="py-10 text-center"><Spinner /></div>}
          {filtering && (
            <div className="flex items-center gap-2.5 flex-wrap">
              <SearchInput value={query} onChange={setQuery} placeholder="Search prompts and models" shortcut="" />
              <SortPill label="Model" value={model} onChange={setModel} options={modelFilterOptions(all, models)} />
              <SortPill label="Verdict" value={verdict} onChange={setVerdict} options={VERDICT_FILTERS} />
              <SortPill value={sort} onChange={setSort} options={SORTS} />
            </div>
          )}
          {all.length > 0 && (
            <div className="rounded-[12px] border border-solid border-line overflow-hidden">
              <HistoryHeaderRow />
              {rows.map((c) => {
                const [a, b] = c.sides || [];
                const turns = Math.max(a?.turnCount || 0, b?.turnCount || 0);
                const names = namesFor(models, a, b);
                return (
                  <CardRow
                    key={c.id}
                    as="div"
                    onActivate={() => onOpen(c.id)}
                    aria-label={`Open comparison: ${c.title}`}
                    className="group grid gap-[14px] py-3 px-[14px] items-center cursor-pointer transition-colors hover:bg-surface-2"
                    style={{ gridTemplateColumns: HISTORY_GRID }}
                  >
                    <span className="truncate text-[14px] text-ink font-medium" title={c.title}>{c.title}</span>
                    <span className="flex items-center gap-2 min-w-0">
                      <ModelTag id={a?.model} name={names.a} />
                      <span aria-label="versus" className="text-ink-4 flex-shrink-0">↔</span>
                      <ModelTag id={b?.model} name={names.b} />
                    </span>
                    <span className="text-ink-3 font-mono text-xs">{turns}</span>
                    <span className="min-w-0"><VerdictChip verdict={c.verdict} names={names} /></span>
                    <span className="text-ink-4 font-mono text-xs">{relativeAge(c.createdAt)}</span>
                    <span aria-hidden className="text-ink-4 opacity-0 group-hover:opacity-100 transition-opacity">{Ico.chevRight(14)}</span>
                  </CardRow>
                );
              })}
              {rows.length === 0 && (
                <div className="py-10 text-center text-[13px] text-ink-4">No comparisons match.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const EXAMPLES = [
  { label: 'Summarize a document', prompt: 'Read the attached document and give me a one-page summary with the key points and anything I should watch out for.' },
  { label: 'Analyze data', prompt: 'Analyze the attached data, find the three most interesting patterns, and chart them.' },
  { label: 'Build a dashboard', prompt: 'Build a one-page HTML dashboard from the attached data with the main numbers and two charts.' },
  { label: 'Write a plan', prompt: 'Write a step-by-step project plan with milestones, owners and risks for launching a new internal tool.' },
  { label: 'Explain code', prompt: 'Explain what the attached code does, how it is structured, and the three changes you would make first.' },
];

function SideIcon({ model, name }) {
  return model
    ? <ProviderIcon maker={modelMaker(model, name)} size={30} />
    : <span className="text-ink-4 text-lg">?</span>;
}

function SidePicker({ label, value, onChange, models, modelMeta }) {
  const options = useMemo(() => buildModelPickerOptions(models, modelMeta), [models, modelMeta]);
  const efforts = EFFORT_SUPPORTED ? modelMeta?.modelEfforts || {} : undefined;
  return (
    <div className="flex-1 min-w-0 flex items-center gap-2 h-12 pl-3 pr-1.5 rounded-[12px] border border-solid border-line bg-surface">
      <span
        aria-hidden
        className="inline-grid place-items-center w-6 h-6 rounded-[6px] bg-surface-2 font-mono text-[11.5px] text-ink-3 flex-shrink-0"
      >
        {label.toUpperCase()}
      </span>
      <ModelSelect
        value={value.model}
        onValueChange={(model) => onChange({ model, reasoningEffort: '' })}
        options={options}
        variant="unstyled"
        className="meta-pill flex-1 min-w-0 justify-between"
        ariaLabel={`Model ${label.toUpperCase()}`}
        placeholder="Choose a model"
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
    { value: EMPTY_START, label: 'No project files' },
    ...projects.map((p) => ({ value: String(p.id), label: projectLabel(p) })),
  ];
  const nameA = modelName(models, sides.a.model);
  const nameB = modelName(models, sides.b.model);

  const start = async () => {
    if (!ready) return;
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
      {onCancel && <PageHeader onBack={onCancel} backLabel="Comparisons" current="New comparison" />}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center px-7 pb-12">
        <div className="w-full max-w-[640px] flex flex-col items-center gap-5">
          <div className="flex items-center gap-5" aria-hidden>
            <span className="compare-vs-orb inline-grid place-items-center w-16 h-16 rounded-full bg-surface border border-solid border-line">
              <SideIcon model={sides.a.model} name={nameA} />
            </span>
            <span className="font-[family-name:var(--font-display)] text-xl font-semibold text-ink-3 tracking-[0.08em]">VS</span>
            <span className="compare-vs-orb compare-vs-orb--right inline-grid place-items-center w-16 h-16 rounded-full bg-surface border border-solid border-line">
              <SideIcon model={sides.b.model} name={nameB} />
            </span>
          </div>
          <div className="text-center">
            <h1 className="m-0 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.004em] text-strong">Compare two models</h1>
            <p className="mt-2 mb-0 text-[14px] text-ink-3">Give the same task to two models and see how each handles it.</p>
          </div>

          <div className="composer-wrap w-full">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); start(); }
              }}
              rows={3}
              placeholder="What should both models do?"
              aria-label="Task for both models"
              className="block w-full border-0 outline-0 resize-none bg-transparent font-[family-name:var(--font-sans)] text-[length:var(--text-md)] leading-[1.5] text-strong px-[18px] pt-4 pb-1 min-h-[88px] placeholder:text-[color:var(--frost-500)]"
            />
            <div className="composer-toolbar">
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => { setFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
              />
              <button type="button" className="meta-pill" onClick={() => fileInput.current?.click()}>
                {Ico.attach(14)}
                <span>{files.length === 0 ? 'Add files' : files.length === 1 ? files[0].name : `${files.length} files`}</span>
              </button>
              <Select
                value={source}
                onValueChange={setSource}
                options={projectOptions}
                variant="pill"
                aria-label="Start from a project"
              />
              <span className="flex-1" />
              <Tooltip content="Start comparison">
                <button
                  type="button"
                  className="send-btn"
                  aria-label="Start comparison"
                  disabled={!ready}
                  onClick={start}
                >
                  {Ico.send(15)}
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="w-full flex items-center gap-2 max-sm:flex-col">
            <SidePicker label="a" value={sides.a} onChange={(next) => setSides((prev) => ({ ...prev, a: next }))} models={models} modelMeta={modelMeta} />
            <Tooltip content="Swap sides">
              <Button
                icon
                variant="subtle"
                aria-label="Swap sides"
                onClick={() => setSides((prev) => ({ a: prev.b, b: prev.a }))}
              >
                {Ico.swap(15)}
              </Button>
            </Tooltip>
            <SidePicker label="b" value={sides.b} onChange={(next) => setSides((prev) => ({ ...prev, b: next }))} models={models} modelMeta={modelMeta} />
          </div>

          {error && <Alert variant="danger" className="w-full">{error}</Alert>}
          <Button variant="primary" size="lg" disabled={!ready} onClick={start}>
            {busy ? 'Starting…' : <>Start comparison {Ico.chevRight(14)}</>}
          </Button>
          <p className="m-0 text-xs text-ink-4 text-center max-w-[520px]">
            Each model works on its own copy of the files. Nothing is published or sent through
            messaging apps until you continue with one side.
          </p>

          {!prompt.trim() && (
            <div className="w-full flex flex-col items-center gap-2">
              <span className="text-xs text-ink-4">Try an example</span>
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((example) => (
                  <Button key={example.label} size="sm" variant="subtle" onClick={() => setPrompt(example.prompt)}>
                    {example.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
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
  const [judging, setJudging] = useState(false);

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

  const comparedMessages = (label) => messagesUpToTurn(
    tasks[label]?.messages || [],
    sides[label]?.continuedAt ? sides[label].continuedTurnCount : null,
  );
  // The first prompt is the page's title, so the panes open on the answers.
  // Later messages stay in the panes: a follow-up can go to one side only.
  const shownMessages = (label) => withoutFirstPrompt(comparedMessages(label));
  const firstPrompt = firstUserText(comparedMessages('a')) || firstUserText(comparedMessages('b'));
  const turns = { a: turnsOf(comparedMessages('a')), b: turnsOf(comparedMessages('b')) };
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
  // All or nothing: a message meant for both must not quietly reach only the
  // side that happens to be free, which would make the two diverge.
  const names = namesFor(models, sides.a, sides.b);
  const block = composerBlock(target, sideState, names);

  const submit = () => {
    const text = draft.trim();
    // The composer is not rendered while blocked; this covers a state change
    // landing between the last render and the key press.
    if (!text || block) return;
    setDraft('');
    sendToSides(text, targets);
  };

  const judge = async (winner) => {
    if (judgeable === null) return;
    setJudging(true);
    try {
      setComparison(await recordComparisonVerdict(comparisonId, judgeable, winner));
    } catch (err) {
      setError(err?.message || 'Could not save the verdict.');
    } finally {
      setJudging(false);
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
        <PageHeader onBack={onBack} backLabel="Comparisons" current="Comparison" />
        {error ? <div className="px-7"><Alert variant="danger">{error}</Alert></div> : <div className="py-10 text-center"><Spinner /></div>}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PageHeader
        onBack={onBack}
        backLabel="Comparisons"
        actions={(
          <OverflowMenu
            label="Comparison actions"
            icon={Ico.moreVert(16)}
            triggerClassName="h-8 w-8 justify-center rounded-lg hover:bg-surface-2"
            items={[
              { id: 'delete', label: 'Delete comparison', icon: Ico.trash(14), danger: true, onClick: () => setConfirmDelete(true) },
            ]}
          />
        )}
      />
      <div className="px-7 pb-3 flex flex-col gap-1">
        <h1 className="m-0 font-[family-name:var(--font-display)] text-[22px] leading-7 font-semibold text-strong" title={firstPrompt || comparison.title}>
          {comparison.title}
        </h1>
        <span className="text-[12.5px] text-ink-3">
          {names.a} vs {names.b} · Started {relativeAge(comparison.createdAt) || 'just now'}
        </span>
      </div>
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
            name={names[label]}
            side={sides[label]}
            task={tasks[label] ? { ...tasks[label], messages: shownMessages(label) } : null}
            turns={turns[label]}
            busy={!!busy[label]}
            error={errors[label]}
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
          <VerdictBar
            turnIndex={judgeable}
            showTurn={Math.max(turns.a.length, turns.b.length) > 1}
            chosen={verdictFor(judgeable)}
            saving={judging}
            names={names}
            sides={sides}
            onChoose={judge}
          />
        )}
        <div className="flex items-end gap-3 max-md:flex-col max-md:items-stretch">
          <div className="composer-wrap flex-1 min-w-0 max-w-none">
            {block ? (
              // A message cannot go out right now. Say so where the text box
              // would be, rather than showing a box that looks usable.
              <div role="status" aria-label="Follow-up message" className="flex items-center gap-2 min-h-[56px] px-[18px] text-[13.5px] text-ink-2">
                {!block.canSwitch && SIDE_LABELS.some((l) => sideState[l].busy) && <Spinner />}
                <span>{block.message}</span>
              </div>
            ) : (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder={target === 'both' ? 'Ask a follow-up question to both models…' : `Ask ${names[target]} a follow-up…`}
                aria-label="Follow-up message"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
                className="block w-full border-0 outline-0 resize-none bg-transparent font-[family-name:var(--font-sans)] text-[length:var(--text-md)] leading-[1.5] text-strong px-[18px] pt-3.5 pb-1 min-h-[56px] placeholder:text-[color:var(--frost-500)]"
              />
            )}
            {!block && (
              <div className="composer-toolbar">
                <span className="text-xs text-ink-4 px-2">
                  {target === 'both' ? 'Both models get this message.' : `Only ${names[target]} gets this; the two will diverge.`}
                </span>
                <span className="flex-1" />
                <button type="button" className="send-btn" aria-label="Send" disabled={!draft.trim()} onClick={submit}>
                  {Ico.send(15)}
                </button>
              </div>
            )}
          </div>
          {(!block || block.canSwitch) && (
            <ToggleGroup
              value={target}
              onValueChange={setTarget}
              aria-label="Send to"
              className="mb-1.5"
              options={[
                { value: 'both', label: 'Both' },
                { value: 'a', label: names.a },
                { value: 'b', label: names.b },
              ]}
            />
          )}
        </div>
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
          name={names[continuing]}
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

// "Which answer was better?" as one contained question: the two models (by
// name and icon) and the two non-answers as pills, the pick shown filled with
// a check, and "Saved" once the server has it -- read from the comparison the
// server returned, so it never claims a save that did not happen.
function VerdictBar({ turnIndex, showTurn, chosen, saving, names, sides, onChoose }) {
  return (
    <div
      role="group"
      aria-label="Which answer was better?"
      className="flex items-center gap-3 flex-wrap px-4 py-2.5 rounded-[12px] border border-solid border-line bg-surface"
    >
      <span className="flex items-baseline gap-2">
        <span className="text-[13.5px] font-medium text-ink">Which answer was better?</span>
        {showTurn && <span className="text-xs text-ink-4">Turn {turnIndex + 1}</span>}
      </span>
      <span className="flex-1" />
      <div className="flex items-center gap-1.5 flex-wrap">
        {VERDICT_ORDER.map((winner) => {
          const selected = chosen === winner;
          const side = winner === 'a' || winner === 'b' ? sides[winner] : null;
          return (
            <button
              key={winner}
              type="button"
              aria-pressed={selected}
              disabled={saving}
              onClick={() => onChoose(winner)}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-solid text-[13px] cursor-pointer transition-colors disabled:cursor-default ${
                selected
                  ? 'border-accent bg-accent-bg text-accent'
                  : 'border-line bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink'
              }`}
            >
              {selected && <span aria-hidden className="inline-flex">{Ico.check(13)}</span>}
              {side && <ProviderIcon maker={modelMaker(side.model || '', names[winner])} size={13} />}
              <span>{verdictLabel(winner, names)}</span>
            </button>
          );
        })}
      </div>
      {chosen && (
        <span className="text-xs text-ink-4 inline-flex items-center gap-1" role="status">
          {Ico.check(12)} Saved
        </span>
      )}
    </div>
  );
}

function SidePane({ label, name, side, task, turns, busy, error, projects, agentLabel, onStop, onSendHere, onContinue }) {
  const last = turns[turns.length - 1];
  const total = totalDurationMs(turns);
  const status = sideStatus(turns, { busy, continued: !!side?.continuedAt });
  const now = useNow(status.tone === 'working');
  const startedAt = last?.userAt ? Date.parse(last.userAt) : NaN;
  const runningFor = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : null;
  const project = task ? { id: side?.projectId, name: task.projectName, path: task.projectPath } : null;
  return (
    <section
      aria-label={`Side ${label.toUpperCase()}`}
      className="min-h-0 flex flex-col rounded-[14px] border border-solid border-line bg-surface overflow-hidden"
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-x-0 border-t-0 border-solid border-line">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className="inline-grid place-items-center w-5 h-5 rounded-[5px] bg-surface-2 font-mono text-[11px] text-ink-3 flex-shrink-0"
          >
            {label.toUpperCase()}
          </span>
          <ProviderIcon maker={modelMaker(side?.model || '', name)} size={16} />
          <h2 className="m-0 text-[15px] leading-5 font-semibold text-ink truncate" title={side?.model}>{name}</h2>
          {side?.reasoningEffort && !name.includes(side.reasoningEffort) && (
            <span className="text-[11px] text-ink-3 flex-shrink-0">{side.reasoningEffort} effort</span>
          )}
        </div>
        <span className="flex items-center gap-2 flex-shrink-0">
          <span
            className="inline-flex items-center gap-1.5 text-[12px] text-ink-3"
            role="status"
            aria-label={`Side ${label.toUpperCase()} status`}
            title={total.counted > 1 ? `All turns: ${formatDuration(total.total)}` : undefined}
          >
            {status.tone === 'working'
              ? <span aria-hidden className="inline-flex"><Spinner /></span>
              : <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status.tone]}`} />}
            <span>
              {status.label}
              {status.tone === 'working' && runningFor !== null && ` · ${formatDuration(runningFor)}`}
              {status.tone !== 'working' && last && turnDurationMs(last) !== null && ` · ${formatDuration(turnDurationMs(last))}`}
            </span>
          </span>
          {busy && <Button size="xs" variant="subtle" onClick={onStop}>Stop</Button>}
          {!busy && !side?.continuedAt && turns.length > 0 && (
            <Button size="xs" variant="subtle" onClick={onContinue}>Continue with this model</Button>
          )}
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

function ContinueDialog({ name, projects, onClose, onContinue }) {
  const [projectId, setProjectId] = useState(projects[0] ? String(projects[0].id) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <ConfirmModal
      open
      title={`Continue with ${name}`}
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
          setError(err?.message || 'Could not continue with this model.');
          setBusy(false);
        }
      }}
      onClose={onClose}
    />
  );
}
