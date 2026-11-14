// Compare models: one task given to two models, side by side.
//
// Each side is an ordinary conversation the server keeps in a hidden project,
// so a pane is a ChatView in `pane` mode fed from that conversation. The
// screen runs the two sides' streams itself rather than through App's
// single app-wide stream slot, which holds one turn at a time.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { host } from '../../platform/host';
import ChatView from './ChatView';
import ModelSelect from '../components/ModelSelect.jsx';
import TaskModePills from '../components/taskmodes/TaskModePills';
import ProjectPicker from '../components/ProjectPicker';
import { ConfirmModal } from '../components/ConfirmModal';
import { OverflowMenu } from '../components/OverflowMenu';
import { PageHeader } from '../components/collection';
import { Alert, Badge, Button, CardRow, EmptyState, Select, Spinner, Tooltip } from '../components/ui';
import { ProviderIcon } from '../components/ProviderIcon';
import { SearchInput, SortPill } from '../components/collection';
import Ico from '../components/Icons';
import { buildModelPickerOptions, offeredModels } from '../lib/modelPickerOptions';
import { ComposerFrame } from '../components/chat/ComposerFrame';
import { modelPickerMode } from '../../lib/modelPicker';
import { modelMaker } from '../lib/modelCatalog';
import { initialStreamState, reduceStream } from '../lib/responseStreamAdapter';
import { relativeAge } from '../lib/formatTime';
import { projectLabel } from '../lib/projectLabel';
import { useHubUsageContext } from '../lib/hubUsageContext';
import { USAGE_ACTIONS, deriveComposerWarning, usageActionUrl } from '../lib/usageWarnings';
import {
  trackBillingOpened,
  trackCompareViewOpened,
  trackComparisonContinued,
  trackComparisonFollowUpSent,
  trackComparisonStarted,
  trackComparisonVerdictRecorded,
} from '../lib/analytics';
import { useUsageBarDismiss } from '../lib/usageBarDismiss';
import {
  cancelResponse,
  continueComparisonSide,
  createComparison,
  deleteComparison,
  fetchComparison,
  fetchComparisonUsage,
  fetchComparisons,
  fetchInFlightStatus,
  fetchSession,
  recordComparisonVerdict,
  streamMessage,
  tailInFlight,
  uploadAttachments,
  SHORT_REQUEST_TIMEOUT_MS,
} from '../api';
import {
  SIDE_LABELS,
  VERDICT_ORDER,
  combinedCost,
  comparisonCostProps,
  historyCost,
  compareCreditNotice,
  composerBlock,
  divergedAt,
  isCreditFailure,
  silentFor,
  unjudgeableReason,
  formatDuration,
  judgeableTurn,
  firstUserText,
  messagesUpToTurn,
  withoutFirstPrompt,
  sendTargets,
  sideCost,
  sideNames,
  sideStatus,
  titleFromPrompt,
  turnUsageRows,
  formatTokens,
  usageTokens,
  turnsLabel,
  totalDurationMs,
  turnDurationMs,
  turnsOf,
  verdictLabel,
} from '../lib/compareSides';
import i18n, { useTranslation } from '../../lib/i18n';

const tr = (key, vars) => i18n.t(`compare.${key}`, { ns: 'artifacts', ...vars });

// Web turns do not carry a reasoning effort yet, so offering the pick there
// would show a setting that does nothing. When they do, a build under an
// operator's picker must offer only its efforts (operatorEffortLevels), as
// the composer does.
const EFFORT_SUPPORTED = !host.isWeb;

const EMPTY_START = '__empty__';

// Failures of the connection itself. Anything else the agent reported is saved
// with the turn and drawn by the transcript as its error card, so repeating it
// above the pane would show it twice.
const TRANSPORT_ERRORS = new Set(['stream_error', 'reconnect_error', 'stalled', 'interrupted']);
const REFUSED_MESSAGE = () => tr('refused');
// The stream stopped, not the turn: it may still be running. `stalled` is not
// here because the tail cancels a stalled turn before reporting it.
const DROPPED_STREAM = new Set(['stream_error', 'reconnect_error', 'interrupted']);
// A stream that closes without a final event may still be running on the
// server; re-attach this many times before leaving the side as stopped.
const MAX_REATTACH = 2;

// The logo key for a model, the way the model picker resolves it. A model with
// no logo of its own gets ProviderIcon's neutral mark.
function makerOf(id, name) {
  return modelMaker(id || '', name || '').key;
}

function modelName(models, id) {
  return models.find((m) => m.id === id)?.name || id;
}

function namesFor(models, a, b) {
  return sideNames(
    { name: modelName(models, a?.model), effort: a?.reasoningEffort },
    { name: modelName(models, b?.model), effort: b?.reasoningEffort },
  );
}

/** The credits notice a model would get on its own, from the shared usage rules. */
function useCreditNotices(modelIds) {
  const hubUsage = useHubUsageContext();
  const usage = hubUsage?.usage ?? null;
  const providerType = hubUsage?.providerType;
  const notices = modelIds.map((model) => deriveComposerWarning(usage, { providerType, model: model || null }));
  return { notices, isBillingOwner: !!usage?.isBillingOwner };
}

function openBilling(action, isBillingOwner, trigger) {
  trackBillingOpened(trigger);
  host.openExternal(usageActionUrl(action, { isBillingOwner }));
}

const NOTICE_VARIANT = { danger: 'danger', warning: 'warning', info: 'info' };

// Closing shares the composer bar's store and keys, so a warning closed on
// either screen stays closed on both. One that blocks Start has no close: it
// is the only explanation for the disabled button.
function CreditNotice({ notice, isBillingOwner, trigger }) {
  const { t } = useTranslation('artifacts');
  const [dismissed, dismiss] = useUsageBarDismiss();
  if (!notice) return null;
  const key = notice.dismissKey ?? notice.kind;
  const closable = !notice.blocks;
  if (closable && dismissed.includes(key)) return null;
  return (
    <Alert variant={NOTICE_VARIANT[notice.tone] || 'info'} title={notice.title} className="relative w-full pr-10">
      {closable && (
        <button
          type="button"
          onClick={() => dismiss(key)}
          aria-label={t('publish.dismiss')}
          title={t('publish.dismiss')}
          className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-7 h-7 rounded-md border-0 bg-transparent text-[color:inherit] opacity-70 cursor-pointer hover:opacity-100 hover:bg-[rgba(127,127,127,0.12)]"
        >
          <X size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}
      <div className="flex flex-col gap-2">
        <span>{notice.body}</span>
        {notice.actions?.length > 0 && (
          <span className="flex flex-wrap gap-2">
            {notice.actions.map((action) => (
              <Button key={action.key} size="sm" variant={action.key === 'addFunds' ? 'primary' : 'subtle'} onClick={() => openBilling(action, isBillingOwner, trigger)}>
                {action.label}
              </Button>
            ))}
          </span>
        )}
      </div>
    </Alert>
  );
}

// A turn's last calls reach billing a moment after the turn ends, so the cost
// is read once more after this long.
export const SETTLE_REREAD_MS = 3000;

// What each side has cost, read when the screen opens and when a side finishes
// a turn -- never while one is running, where the figure would climb call by
// call. A side still working keeps the figure from its last finished turn even
// when the other side's finish triggers a read.
function useComparisonUsage(comparisonId, busy) {
  const [usage, setUsage] = useState(null);
  const [finishes, setFinishes] = useState(0);
  const wasBusy = useRef({});
  const busyNow = useRef(busy);
  busyNow.current = busy;
  const busyKey = SIDE_LABELS.map((l) => (busy[l] ? '1' : '0')).join('');
  useEffect(() => {
    const finished = SIDE_LABELS.some((l) => wasBusy.current[l] && !busy[l]);
    wasBusy.current = { ...busy };
    if (finished) setFinishes((n) => n + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyKey]);
  useEffect(() => {
    let live = true;
    const read = () => fetchComparisonUsage(comparisonId).then((next) => {
      if (live && next) setUsage((prev) => keepWorkingSides(prev, next, busyNow.current));
    });
    read();
    const settle = finishes ? setTimeout(read, SETTLE_REREAD_MS) : null;
    return () => {
      live = false;
      if (settle) clearTimeout(settle);
    };
  }, [comparisonId, finishes]);
  return usage;
}

function keepWorkingSides(prev, next, busy) {
  if (!prev?.sides) return next;
  const sides = { ...next.sides };
  for (const label of SIDE_LABELS) {
    if (busy[label] && prev.sides[label]) sides[label] = prev.sides[label];
  }
  return { ...next, sides };
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

export default function CompareView({ models = [], modelMeta, projects = [], agentLabel, onOpenTask, onOpenSettings }) {
  const { t } = useTranslation('artifacts');
  useEffect(() => { trackCompareViewOpened(); }, []);
  const [comparisons, setComparisons] = useState(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('list');
  const [openId, setOpenId] = useState(null);
  // The new-comparison form's prompt, sent by the detail screen once both
  // sides have loaded.
  const [firstSend, setFirstSend] = useState(null);

  const reload = useCallback(async () => {
    try {
      const page = await fetchComparisons();
      setComparisons(page ? page.comparisons : null);
      setHasMore(!!page?.hasMore);
      setLoadError('');
    } catch (err) {
      setLoadError(err?.message || t('compare.loadFailed'));
    }
  }, []);

  const loadOlder = useCallback(async () => {
    setLoadingOlder(true);
    try {
      const page = await fetchComparisons({ offset: comparisons?.length || 0 });
      if (page) {
        // A comparison started meanwhile shifts the pages by one; skip repeats.
        setComparisons((prev) => {
          const seen = new Set((prev || []).map((c) => c.id));
          return [...(prev || []), ...page.comparisons.filter((c) => !seen.has(c.id))];
        });
        setHasMore(page.hasMore);
      }
    } catch (err) {
      setLoadError(err?.message || t('compare.loadOlderFailed'));
    } finally {
      setLoadingOlder(false);
    }
  }, [comparisons]);

  useEffect(() => { reload(); }, [reload]);

  if (comparisons === null) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <PageHeader title={t('compare.pageTitle')} />
        <EmptyState
          icon={Ico.columns(32)}
          title={t('compare.updateNeeded')}
          // Desktop updates its own server on restart; on web the server is
          // hosted, so there is nothing for the user to restart.
          description={host.isWeb
            ? t('compare.updateNeededWeb')
            : t('compare.updateNeededDesktop')}
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
        onOpenSettings={onOpenSettings}
      />
    );
  }

  return (
    <ComparisonHistory
      comparisons={comparisons}
      hasMore={hasMore}
      loadingOlder={loadingOlder}
      onLoadOlder={loadOlder}
      error={loadError}
      models={models}
      onNew={() => setMode('new')}
      onOpen={(id) => { setOpenId(id); setMode('detail'); }}
    />
  );
}

const HISTORY_GRID = 'minmax(0, 2.4fr) minmax(0, 2fr) 64px 72px 170px 72px 16px';
// Below this many comparisons a search box is clutter; above it, finding one
// by eye stops being quick.
const FILTER_THRESHOLD = 10;

// Labels are compare.verdictFilters.<id> and compare.sorts.<id>.
const VERDICT_FILTERS = ['all', 'none', 'judged'];

const SORTS = ['recent', 'oldest', 'prompt'];

function ModelTag({ id, name }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <ProviderIcon maker={makerOf(id, name)} size={13} />
      <span className="truncate text-[13px] text-ink font-medium">{name}</span>
    </span>
  );
}

// The "Winner" column: the model's name, Tie, Neither, or a quiet dash while
// nobody has said.
function WinnerChip({ verdict, names }) {
  const { t } = useTranslation('artifacts');
  if (!verdict) return <span className="text-ink-4" aria-label={t('compare.verdictFilters.none')}>—</span>;
  if (verdict === 'a' || verdict === 'b') {
    return <Badge variant="accent" className="max-w-full truncate" title={names[verdict]}>{names[verdict]}</Badge>;
  }
  return <Badge>{verdict === 'tie' ? t('compare.tie') : t('compare.neither')}</Badge>;
}

function HistoryHeaderRow() {
  const { t } = useTranslation('artifacts');
  const Cell = ({ children, center = false }) => (
    <div className={`font-[family-name:var(--font-mono)] text-[10.5px] text-ink-4 tracking-[0.10em] uppercase${center ? ' text-center' : ''}`}>{children}</div>
  );
  return (
    <div
      className="grid gap-[14px] py-[10px] px-[14px] border-b border-t-0 border-x-0 border-solid border-line"
      style={{ gridTemplateColumns: HISTORY_GRID }}
    >
      <Cell>{t('compare.columns.prompt')}</Cell>
      <Cell>{t('compare.columns.models')}</Cell>
      <Cell center>{t('compare.columns.turns')}</Cell>
      <Cell>{t('compare.columns.cost')}</Cell>
      <Cell>{t('compare.columns.winner')}</Cell>
      <Cell>{t('compare.columns.started')}</Cell>
      <Cell />
    </div>
  );
}

function modelFilterOptions(rows, models) {
  const ids = [...new Set(rows.flatMap((c) => (c.sides || []).map((s) => s.model)).filter(Boolean))];
  return [
    { id: 'all', label: tr('allModels') },
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

function ComparisonHistory({ comparisons, hasMore = false, loadingOlder = false, onLoadOlder, error, models, onNew, onOpen }) {
  const { t } = useTranslation('artifacts');
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
    <Button variant="primary" onClick={onNew}>{Ico.plus(14)} {t('compare.newComparison')}</Button>
  );
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PageHeader
        title={t('compare.historyTitle')}
        subtitle={t('compare.historySubtitle')}
        actions={newButton}
      />
      <div className="flex-1 min-h-0 overflow-y-auto pb-8">
        <div className="max-w-[1080px] mx-auto w-full px-7 flex flex-col gap-3">
          {error && <Alert variant="danger">{error}</Alert>}
          {comparisons === undefined && !error && <div className="py-10 text-center"><Spinner /></div>}
          {filtering && (
            <div className="flex items-center gap-2.5 flex-wrap">
              <SearchInput value={query} onChange={setQuery} placeholder={t('compare.search')} shortcut="" />
              <SortPill label={t('compare.modelFilter')} value={model} onChange={setModel} options={modelFilterOptions(all, models)} />
              <SortPill label={t('compare.columns.winner')} value={verdict} onChange={setVerdict} options={VERDICT_FILTERS.map((id) => ({ id, label: t(`compare.verdictFilters.${id}`) }))} />
              <SortPill value={sort} onChange={setSort} options={SORTS.map((id) => ({ id, label: t(`compare.sorts.${id}`) }))} />
            </div>
          )}
          {all.length > 0 && (
            <div className="rounded-[12px] border border-solid border-line overflow-hidden">
              <HistoryHeaderRow />
              {rows.map((c) => {
                const [a, b] = c.sides || [];
                const names = namesFor(models, a, b);
                const turns = turnsLabel(a?.turnCount, b?.turnCount, names);
                const cost = historyCost(c.sides || []);
                return (
                  <CardRow
                    key={c.id}
                    as="div"
                    onActivate={() => onOpen(c.id)}
                    aria-label={t('compare.openComparison', { title: c.title })}
                    className="group grid gap-[14px] py-3 px-[14px] items-center cursor-pointer transition-colors hover:bg-surface-2"
                    style={{ gridTemplateColumns: HISTORY_GRID }}
                  >
                    <span className="truncate text-[14px] text-ink font-medium" title={c.title}>{c.title}</span>
                    {/* One model per line, so each name is shown whole. */}
                    <span className="flex flex-col gap-1 min-w-0">
                      <ModelTag id={a?.model} name={names.a} />
                      <ModelTag id={b?.model} name={names.b} />
                    </span>
                    <span className="text-ink-3 font-mono text-xs text-center" title={turns.title}>{turns.text}</span>
                    <span
                      className="text-ink-3 font-mono text-xs tabular-nums"
                      title={cost ? t('compare.costTitle') : undefined}
                      aria-label={cost ? t('compare.costAria', { cost }) : t('compare.costUnread')}
                    >
                      {cost ?? '—'}
                    </span>
                    <span className="min-w-0"><WinnerChip verdict={c.verdict} names={names} /></span>
                    <span className="text-ink-4 font-mono text-xs">{relativeAge(c.createdAt)}</span>
                    <span aria-hidden className="text-ink-4 opacity-0 group-hover:opacity-100 transition-opacity">{Ico.chevRight(14)}</span>
                  </CardRow>
                );
              })}
              {rows.length === 0 && (
                <div className="py-10 text-center text-[13px] text-ink-4">{t('compare.noMatch')}</div>
              )}
            </div>
          )}
          {hasMore && (
            <div className="flex justify-center">
              <Button size="sm" onClick={onLoadOlder} disabled={loadingOlder}>
                {loadingOlder ? t('compare.loading') : t('compare.showOlder')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Starting points, each an angle on which models tend to differ. Every prompt
// works with nothing attached, since most comparisons start empty, and asks
// for one focused output: a model that tries to write everything in a single
// reply runs out of output budget, which then reads as the model failing.
// Each example's label, hint and prompt are read through i18n
// (compare.examples.<id>), so they follow the current language.
function example(id, icon) {
  return {
    id,
    icon,
    get pillLabel() { return tr(`examples.${id}.pillLabel`); },
    get hint() { return tr(`examples.${id}.hint`); },
    get prompt() { return tr(`examples.${id}.prompt`); },
  };
}

export const EXAMPLES = [
  example('website', 'appWindow'),
  example('games', 'gamepad'),
  example('visualization', 'chartColumn'),
  example('spreadsheet', 'table'),
  example('research', 'telescope'),
  example('slides', 'presentation'),
  example('reasoning', 'brain'),
  example('writing', 'edit'),
];

function SideIcon({ model, name }) {
  return model
    ? <ProviderIcon maker={makerOf(model, name)} size={30} />
    : <span className="text-ink-4 text-lg">?</span>;
}

function SidePicker({ label, value, onChange, models, modelMeta }) {
  const { t } = useTranslation('artifacts');
  // Under an operator's picker, only the models the operator offers, as in
  // the composer.
  const options = useMemo(
    () => buildModelPickerOptions(
      modelPickerMode() !== 'off' ? offeredModels(models, modelMeta?.modelEnabled) : models,
      modelMeta,
    ),
    [models, modelMeta],
  );
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
        ariaLabel={t('compare.modelSide', { side: label.toUpperCase() })}
        placeholder={t('compare.chooseModel')}
        // Opening re-checks the wallet (App throttles it), so a top-up unlocks rows here too.
        onOpenChange={(opened) => { if (opened) Promise.resolve(modelMeta?.onRefresh?.()).catch(() => {}); }}
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
  const { t } = useTranslation('artifacts');
  const [prompt, setPrompt] = useState('');
  const [sides, setSides] = useState({ a: { model: '', reasoningEffort: '' }, b: { model: '', reasoningEffort: '' } });
  const [source, setSource] = useState(EMPTY_START);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  const nameA = modelName(models, sides.a.model);
  const nameB = modelName(models, sides.b.model);
  const credits = useCreditNotices([sides.a.model, sides.b.model]);
  const creditNotice = compareCreditNotice(credits.notices);
  // A side that could not run at all would stop on its first step.
  const ready = prompt.trim() && sides.a.model && sides.b.model && !busy && !creditNotice?.blocks;

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
      trackComparisonStarted(comparison, {
        fileCount: files.length,
        exampleId: EXAMPLES.find((example) => example.prompt === prompt)?.id,
      });
      onStarted(comparison, { comparisonId: comparison.id, text: prompt.trim(), files });
    } catch (err) {
      setError(err?.message || t('compare.startFailed'));
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {onCancel && <PageHeader onBack={onCancel} backLabel={t('compare.historyTitle')} current={t('compare.newComparison')} />}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center px-7 pb-12">
        <div className="w-full max-w-[640px] flex flex-col items-center gap-5">
          <div className="flex items-center gap-5" aria-hidden>
            <span className="compare-vs-orb inline-grid place-items-center w-16 h-16 rounded-full bg-surface border border-solid border-line">
              <SideIcon model={sides.a.model} name={nameA} />
            </span>
            <span className="font-[family-name:var(--font-display)] text-xl font-semibold text-ink-3 tracking-[0.08em]">{t('compare.vs')}</span>
            <span className="compare-vs-orb compare-vs-orb--right inline-grid place-items-center w-16 h-16 rounded-full bg-surface border border-solid border-line">
              <SideIcon model={sides.b.model} name={nameB} />
            </span>
          </div>
          <div className="text-center">
            <h1 className="m-0 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.004em] text-strong">{t('compare.newTitle')}</h1>
            <p className="mt-2 mb-0 text-[14px] text-ink-3">{t('compare.newSubtitle')}</p>
          </div>

          <ComposerFrame className="composer-wrap w-full">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); start(); }
              }}
              rows={3}
              placeholder={t('compare.taskPlaceholder')}
              aria-label={t('compare.taskAria')}
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
                <span>{files.length === 0 ? t('compare.addFiles') : files.length === 1 ? files[0].name : t('compare.files', { count: files.length })}</span>
              </button>
              {/* Home's project picker. Picking a project gives each model its
                  own copy of that project's files to work on. */}
              <ProjectPicker
                projects={projects}
                project={projects.find((p) => String(p.id) === source) || null}
                onChange={(picked) => setSource(picked ? String(picked.id) : EMPTY_START)}
                noneLabel={t('compare.noProject')}
              />
              <span className="flex-1" />
              <Tooltip content={t('compare.start')}>
                <button
                  type="button"
                  className="send-btn"
                  aria-label={t('compare.start')}
                  disabled={!ready}
                  onClick={start}
                >
                  {Ico.send(16)}
                </button>
              </Tooltip>
            </div>
          </ComposerFrame>

          <div className="w-full flex items-center gap-2 max-sm:flex-col">
            <SidePicker label="a" value={sides.a} onChange={(next) => setSides((prev) => ({ ...prev, a: next }))} models={models} modelMeta={modelMeta} />
            <Tooltip content={t('compare.swap')}>
              <Button
                icon
                variant="subtle"
                aria-label={t('compare.swap')}
                onClick={() => setSides((prev) => ({ a: prev.b, b: prev.a }))}
              >
                {Ico.swap(16)}
              </Button>
            </Tooltip>
            <SidePicker label="b" value={sides.b} onChange={(next) => setSides((prev) => ({ ...prev, b: next }))} models={models} modelMeta={modelMeta} />
          </div>

          <CreditNotice notice={creditNotice} isBillingOwner={credits.isBillingOwner} trigger="compare_start" />
          {error && <Alert variant="danger" className="w-full">{error}</Alert>}
          <Button variant="primary" size="lg" disabled={!ready} onClick={start}>
            {busy ? t('comments.card.starting') : <>{t('compare.start')} {Ico.chevRight(14)}</>}
          </Button>
          <p className="m-0 text-xs text-ink-4 text-center max-w-[520px]">
            {t('compare.isolationNote')}
          </p>

          {!prompt.trim() && (
            <TaskModePills modes={EXAMPLES} label={t('compare.examplesLabel')} onPick={(example) => setPrompt(example.prompt)} />
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

function useComparisonSides(comparison, { onRefused } = {}) {
  const [tasks, setTasks] = useState({});
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});
  // A side is ready once its history is in and its in-flight check has
  // answered: until then it may be mid-turn, and a message to it is dropped.
  // A check that failed leaves the side `unknown`, not ready.
  const [ready, setReady] = useState({});
  const [unknown, setUnknown] = useState({});
  const onRefusedRef = useRef(onRefused);
  onRefusedRef.current = onRefused;
  const [lastEventAt, setLastEventAt] = useState({});
  const streams = useRef({});

  const sideByLabel = useMemo(
    () => Object.fromEntries((comparison?.sides || []).map((s) => [s.label, s])),
    [comparison],
  );

  const reattached = useRef({});

  const refresh = useCallback(async (label) => {
    const side = sideByLabel[label];
    if (!side) return null;
    const task = await fetchSession(side.conversationId).catch(() => null);
    if (task) setTasks((prev) => ({ ...prev, [label]: task }));
    return task;
  }, [sideByLabel]);

  // Set below; an interrupted stream uses it to re-attach.
  const followRunningRef = useRef(null);

  const settle = useCallback((label, result) => {
    setUnknown((prev) => ({ ...prev, [label]: result === 'unknown' }));
    setReady((prev) => ({ ...prev, [label]: result !== 'unknown' }));
  }, []);

  const follow = useCallback((label, open, sentText = null) => {
    let state = initialStreamState();
    setBusy((prev) => ({ ...prev, [label]: true }));
    setErrors((prev) => ({ ...prev, [label]: '' }));
    setLastEventAt((prev) => ({ ...prev, [label]: Date.now() }));
    const finish = (message) => {
      streams.current[label] = null;
      setBusy((prev) => ({ ...prev, [label]: false }));
      if (message) setErrors((prev) => ({ ...prev, [label]: message }));
      refresh(label);
    };
    streams.current[label] = open({
      onEvent(ev) {
        setLastEventAt((prev) => ({ ...prev, [label]: Date.now() }));
        state = reduceStream(state, ev);
        setTasks((prev) => {
          const task = prev[label];
          return task ? { ...prev, [label]: { ...task, messages: withStreaming(task.messages, state) } } : prev;
        });
      },
      onDone() {
        reattached.current[label] = 0;
        finish('');
      },
      onError(message, event) {
        // The side was already running a turn, so the server never took this
        // message: say so, and hand the text back rather than let it vanish.
        if (event?.code === 'turn_in_progress' && sentText !== null) {
          // The side stays working while this looks for the turn it is
          // running: nothing there has finished, so its cost is not read.
          streams.current[label] = null;
          onRefusedRef.current?.(label, sentText);
          refresh(label);
          // A re-attach clears the side's message, so it is set again after.
          // The refusal proves a turn is running there, so a check that does
          // not find one leaves the side unknown rather than ready.
          const unfound = () => {
            settle(label, 'unknown');
            finish(REFUSED_MESSAGE());
          };
          Promise.resolve(followRunningRef.current?.(label)).then((result) => {
            if (result !== 'attached') unfound();
            else setErrors((prev) => ({ ...prev, [label]: REFUSED_MESSAGE() }));
          }, unfound);
          return;
        }
        const ended = () => finish(TRANSPORT_ERRORS.has(event?.code) ? message : '');
        const tries = reattached.current[label] || 0;
        if (!DROPPED_STREAM.has(event?.code) || tries >= MAX_REATTACH) {
          // A stream that stalled, or kept dropping until the re-attaches ran
          // out, says nothing about the turn: it may still be running. The side
          // stays unknown, and takes no message, until a status check answers.
          if (TRANSPORT_ERRORS.has(event?.code)) settle(label, 'unknown');
          ended();
          return;
        }
        // The side stays busy while it re-attaches: a drop is not the turn
        // finishing, and its cost is read only once the turn has.
        reattached.current[label] = tries + 1;
        streams.current[label] = null;
        Promise.resolve(followRunningRef.current?.(label)).then((result) => {
          if (result === 'unknown') settle(label, 'unknown');
          if (result !== 'attached') ended();
        }, () => { settle(label, 'unknown'); ended(); });
      },
    });
  }, [refresh, settle]);

  // Attach to a turn still running on the server, if there is one:
  // 'attached', 'idle', or 'unknown' when the check itself failed.
  const followRunning = useCallback(async (label) => {
    const side = sideByLabel[label];
    if (!side || side.continuedAt) return 'idle';
    let status;
    try {
      status = await fetchInFlightStatus(side.conversationId, { strict: true, timeoutMs: SHORT_REQUEST_TIMEOUT_MS });
    } catch {
      return 'unknown';
    }
    if (!status?.in_flight || streams.current[label]) return 'idle';
    follow(label, (callbacks) => tailInFlight(side.conversationId, callbacks));
    return 'attached';
  }, [sideByLabel, follow]);

  const recheck = useCallback(async (labels) => {
    for (const label of labels) settle(label, await followRunning(label));
  }, [followRunning, settle]);
  followRunningRef.current = followRunning;

  // Load one side, or say it could not be loaded; then re-attach to a turn it
  // is still running.
  const load = useCallback(async (label) => {
    setErrors((prev) => ({ ...prev, [label]: '' }));
    setReady((prev) => ({ ...prev, [label]: false }));
    const task = await refresh(label);
    if (!task) {
      setErrors((prev) => ({ ...prev, [label]: tr('loadSideFailed') }));
      return null;
    }
    settle(label, await followRunning(label));
    return task;
  }, [refresh, followRunning, settle]);

  // Load both sides, and re-attach to a turn still running on the server --
  // the sides keep working when the user leaves this screen.
  useEffect(() => {
    if (!comparison) return undefined;
    let cancelled = false;
    (async () => {
      for (const side of comparison.sides) {
        if (cancelled) return;
        await load(side.label);
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
    }), text);
  }, [sideByLabel, follow]);

  const stop = useCallback((label) => {
    const side = sideByLabel[label];
    if (side) cancelResponse(side.conversationId);
  }, [sideByLabel]);

  return { tasks, busy, errors, ready, unknown, lastEventAt, send, stop, refresh, load, recheck };
}

function ComparisonDetail({ comparisonId, models, projects, agentLabel, firstSend, onFirstSendDone, onBack, onDeleted, onOpenTask, onOpenSettings }) {
  const { t } = useTranslation('artifacts');
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState('');
  const [target, setTarget] = useState('both');
  const [draft, setDraft] = useState('');
  const [rechecking, setRechecking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [continuing, setContinuing] = useState(null);
  const [judging, setJudging] = useState(false);
  // One switch for both panes, so their turns line up row for row.
  const [usageOpen, setUsageOpen] = useState(false);

  const loadComparison = useCallback(async () => {
    try {
      setComparison(await fetchComparison(comparisonId));
    } catch (err) {
      setError(err?.message || t('compare.loadOneFailed'));
    }
  }, [comparisonId]);

  useEffect(() => { loadComparison(); }, [loadComparison]);

  const { tasks, busy, errors, ready, unknown, lastEventAt, send, stop, load, recheck } = useComparisonSides(comparison, {
    onRefused: (_label, text) => setDraft((current) => current || text),
  });
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
  const continueTracked = useRef(new Set());
  const verdictFor = (turnIndex) => comparison?.verdicts?.find((v) => v.turnIndex === turnIndex)?.winner || null;
  const loaded = SIDE_LABELS.every((label) => tasks[label]);

  // Every side's files go up before any side is sent to, so a failed upload
  // sends nothing rather than starting one side alone. False when it failed.
  const sendToSides = useCallback(async (text, labels, files = []) => {
    const attachmentIds = {};
    for (const label of labels) {
      attachmentIds[label] = [];
      if (!files.length) continue;
      try {
        const uploaded = await uploadAttachments(files, { projectName: tasks[label]?.projectName, sessionId: sides[label].conversationId });
        attachmentIds[label] = uploaded.map((a) => a.id).filter(Boolean);
      } catch (err) {
        setError(err?.message || t('compare.attachFailed'));
        return false;
      }
    }
    for (const label of labels) send(label, text, attachmentIds[label]);
    return true;
  }, [tasks, sides, send]);

  // The prompt from the new-comparison form goes to both sides once both have
  // loaded, so neither starts ahead of the other. The parent keeps it until it
  // has gone out to both; a failure leaves it for Try again.
  const [firstSendFailed, setFirstSendFailed] = useState(false);
  const firstSending = useRef(false);
  const sendFirst = useCallback(async () => {
    if (!firstSend || firstSending.current) return;
    firstSending.current = true;
    setFirstSendFailed(false);
    setError('');
    const sent = await sendToSides(firstSend.text, SIDE_LABELS, firstSend.files || []);
    firstSending.current = false;
    if (sent) onFirstSendDone?.();
    else setFirstSendFailed(true);
  }, [firstSend, sendToSides, onFirstSendDone]);
  useEffect(() => {
    if (firstSend && loaded && !firstSendFailed) sendFirst();
  }, [firstSend, loaded, firstSendFailed, sendFirst]);

  const sideState = Object.fromEntries(SIDE_LABELS.map((label) => [label, {
    continued: !!sides[label]?.continuedAt,
    busy: !!busy[label],
  }]));
  const targets = sendTargets(target, sideState);
  // All or nothing: a message meant for both must not quietly reach only the
  // side that happens to be free, which would make the two diverge.
  const names = namesFor(models, sides.a, sides.b);
  const credits = useCreditNotices([sides.a?.model, sides.b?.model]);
  // A side whose state is unknown may still be mid-turn: its cost waits too.
  const holding = Object.fromEntries(SIDE_LABELS.map((label) => [label, !!busy[label] || !!unknown[label]]));
  const usage = useComparisonUsage(comparisonId, holding);
  const combined = combinedCost(usage);
  // A side is held back for credits while its last turn stopped for them and
  // the account still cannot pay for its model. The next usage refresh (every
  // 30s, and on window focus) lifts it once funds arrive.
  const outOfCredits = SIDE_LABELS.filter((l, i) => (
    isCreditFailure(turns[l][turns[l].length - 1]) && credits.notices[i]?.kind === 'balance_empty'
  ));
  // A continued side takes no messages, so it is never waited for.
  const unloaded = SIDE_LABELS.filter((label) => !(tasks[label] && ready[label]) && !sides[label]?.continuedAt);
  let starting = null;
  if (unloaded.some((label) => !tasks[label] && errors[label])) starting = 'loadFailed';
  else if (unloaded.some((label) => unknown[label])) starting = 'checkFailed';
  else if (unloaded.length) starting = 'loading';
  else if (firstSend) starting = firstSendFailed ? 'firstFailed' : 'sending';
  const block = composerBlock(target, sideState, names, { outOfCredits, starting });
  const cannotJudge = unjudgeableReason(turns.a, turns.b, names);

  const submit = () => {
    const text = draft.trim();
    // The composer is not rendered while blocked; this covers a state change
    // landing between the last render and the key press.
    if (!text || block) return;
    setDraft('');
    const turnIndex = Math.max(turns.a.length, turns.b.length);
    sendToSides(text, targets).then((sent) => {
      if (sent) trackComparisonFollowUpSent(comparisonId, target, turnIndex);
    });
  };

  const judge = async (winner) => {
    if (judgeable === null) return;
    setJudging(true);
    const previous = verdictFor(judgeable);
    try {
      setComparison(await recordComparisonVerdict(comparisonId, judgeable, winner));
      trackComparisonVerdictRecorded(comparisonId, {
        turnIndex: judgeable,
        winner,
        models: { a: sides.a?.model, b: sides.b?.model },
        changed: Boolean(previous) && previous !== winner,
        cost: comparisonCostProps(usage, { a: turns.a.length, b: turns.b.length }),
      });
    } catch (err) {
      setError(err?.message || t('compare.verdictFailed'));
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
      setError(err?.message || t('compare.deleteFailed'));
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (!comparison) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <PageHeader onBack={onBack} backLabel={t('compare.historyTitle')} current={t('compare.comparison')} />
        {error ? <div className="px-7"><Alert variant="danger">{error}</Alert></div> : <div className="py-10 text-center"><Spinner /></div>}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PageHeader
        onBack={onBack}
        backLabel={t('compare.historyTitle')}
        actions={(
          <OverflowMenu
            label={t('compare.actions')}
            icon={Ico.moreVert(16)}
            triggerClassName="h-8 w-8 justify-center rounded-lg hover:bg-surface-2"
            items={[
              { id: 'delete', label: t('compare.deleteComparison'), icon: Ico.trash(14), danger: true, onClick: () => setConfirmDelete(true) },
            ]}
          />
        )}
      />
      <div className="px-7 pb-3 flex flex-col gap-1">
        <h1 className="m-0 font-[family-name:var(--font-display)] text-[22px] leading-7 font-semibold text-strong" title={firstPrompt || comparison.title}>
          {comparison.title}
        </h1>
        <span className="text-[12.5px] text-ink-3">
          {t('compare.byline', { a: names.a, b: names.b, started: relativeAge(comparison.createdAt) || t('comments.card.justNow') })}
          {combined && (
            <span title={t('compare.combinedCostTitle')}>
              {' · '}{t('compare.costAria', { cost: combined.text })}
            </span>
          )}
        </span>
      </div>
      {error && (
        <div className="px-7 pb-2">
          <Alert variant="danger">
            <span className="flex flex-wrap items-center gap-3">
              <span>{firstSendFailed ? t('compare.firstSendFailed', { error }) : error}</span>
              {firstSendFailed && <Button size="sm" onClick={sendFirst}>{t('status.tryAgain')}</Button>}
            </span>
          </Alert>
        </div>
      )}
      {diverged !== null && (
        <div className="px-7 pb-2 text-xs text-ink-3" role="status">
          {t('compare.diverged', { turn: diverged + 1 })}
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
            usage={usage?.sides?.[label] || null}
            usageOpen={usageOpen}
            onToggleUsage={() => setUsageOpen((open) => !open)}
            busy={!!busy[label]}
            lastEventAt={lastEventAt[label]}
            error={errors[label]}
            projects={projects}
            agentLabel={agentLabel}
            onStop={() => stop(label)}
            // What the pane itself sends (a pick on a question that timed out)
            // follows the composer's rules for that side alone, so a pane never
            // sends what the composer would refuse, or nothing at all.
            onSendHere={composerBlock(label, sideState, names, { outOfCredits, starting })
              ? undefined
              : (text) => sendToSides(text, [label])}
            onContinue={() => setContinuing(label)}
            onCopyRest={async () => {
              // Reloaded either way: a failed retry can still clear the notice
              // (the server drops it when the files it kept are gone).
              try {
                await continueComparisonSide(comparisonId, label, sides[label].continuedProjectId, names[label]);
              } finally {
                await loadComparison();
              }
            }}
            onRetryLoad={() => load(label)}
            onOpenSettings={onOpenSettings}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
      <div className="px-7 pt-3 pb-5 flex flex-col gap-2 max-w-[1100px] w-full mx-auto">
        {judgeable === null && cannotJudge && (
          <div role="status" className="px-4 py-2.5 rounded-[12px] border border-solid border-line bg-surface text-[13px] text-ink-3">
            {cannotJudge}
          </div>
        )}
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
        <ComposerFrame className="composer-wrap w-full min-w-0 max-w-none">
          {block ? (
            // A message cannot go out right now. Say so where the text box
            // would be, rather than showing a box that looks usable.
            <div role="status" aria-label={t('compare.followUp')} className="flex items-center gap-2 min-h-[56px] px-[18px] text-[13.5px] text-ink-2">
              {!block.canSwitch && !block.action && (starting === 'loading' || starting === 'sending' || SIDE_LABELS.some((l) => sideState[l].busy)) && <Spinner />}
              <span className="flex-1">{block.message}</span>
              {block.action === 'recheck' && (
                <Button
                  size="sm"
                  disabled={rechecking}
                  onClick={async () => {
                    setRechecking(true);
                    try {
                      await recheck(SIDE_LABELS.filter((label) => unknown[label]));
                    } finally {
                      setRechecking(false);
                    }
                  }}
                >
                  {rechecking ? t('compare.checking') : t('compare.checkAgain')}
                </Button>
              )}
              {block.action === 'addFunds' && (
                <Button size="sm" variant="primary" onClick={() => openBilling(USAGE_ACTIONS.addFunds, credits.isBillingOwner, 'compare_follow_up')}>
                  {t('compare.addFunds')}
                </Button>
              )}
              {block.canSwitch && <SendToPicker target={target} names={names} onChange={setTarget} />}
            </div>
          ) : (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder={target === 'both' ? t('compare.followUpBoth') : t('compare.followUpOne', { name: names[target] })}
                aria-label={t('compare.followUp')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
                className="block w-full border-0 outline-0 resize-none bg-transparent font-[family-name:var(--font-sans)] text-[length:var(--text-md)] leading-[1.5] text-strong px-[18px] pt-3.5 pb-1 min-h-[56px] placeholder:text-[color:var(--frost-500)]"
              />
              <div className="composer-toolbar">
                <span className="text-xs text-ink-4 px-2 truncate">
                  {target === 'both' ? t('compare.bothGet') : t('compare.onlyOneGets', { name: names[target] })}
                </span>
                <span className="flex-1" />
                <SendToPicker target={target} names={names} onChange={setTarget} />
                <button type="button" className="send-btn" aria-label={t('comments.composer.send')} disabled={!draft.trim()} onClick={submit}>
                  {Ico.send(16)}
                </button>
              </div>
            </>
          )}
        </ComposerFrame>
      </div>
      <ConfirmModal
        open={confirmDelete}
        title={t('compare.deleteTitle')}
        message={t('compare.deleteMessage')}
        confirmLabel={t('common.delete')}
        destructive
        busy={deleting}
        onConfirm={doDelete}
        onClose={() => setConfirmDelete(false)}
      />
      {continuing && (
        <ContinueDialog
          name={names[continuing]}
          projects={projects}
          onClose={async (openedTaskId) => {
            setContinuing(null);
            if (!openedTaskId) return;
            await loadComparison();
            onOpenTask?.(openedTaskId);
          }}
          onContinue={async (projectId) => {
            const result = await continueComparisonSide(comparisonId, continuing, projectId, names[continuing]);
            // Once per side: Try again after a partial carry retries the files,
            // it isn't a second Continue.
            if (!continueTracked.current.has(continuing)) {
              continueTracked.current.add(continuing);
              trackComparisonContinued(comparisonId, {
                side: continuing,
                models: { a: sides.a?.model, b: sides.b?.model },
                turns: turns[continuing].length,
                carriedAll: result?.carriedAll !== false,
                verdict: comparison?.verdict ?? null,
                cost: comparisonCostProps(usage, { a: turns.a.length, b: turns.b.length }),
              });
            }
            // An older server says nothing about the files: it carried them or failed.
            if (result?.carriedAll === false) return result;
            setContinuing(null);
            await loadComparison();
            onOpenTask?.(result?.conversationId);
            return result;
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
  const { t } = useTranslation('artifacts');
  return (
    <div
      role="group"
      aria-label={t('compare.whichBetter')}
      className="flex items-center gap-3 flex-wrap px-4 py-2.5 rounded-[12px] border border-solid border-line bg-surface"
    >
      <span className="flex items-baseline gap-2">
        <span className="text-[13.5px] font-medium text-ink">{t('compare.whichBetter')}</span>
        {showTurn && <span className="text-xs text-ink-4">{t('compare.turn', { turn: turnIndex + 1 })}</span>}
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
              {selected && <span aria-hidden className="inline-flex">{Ico.check(14)}</span>}
              {side && <ProviderIcon maker={makerOf(side.model, names[winner])} size={13} />}
              <span>{verdictLabel(winner, names)}</span>
            </button>
          );
        })}
      </div>
      {chosen && (
        <span className="text-xs text-ink-4 inline-flex items-center gap-1" role="status">
          {Ico.check(12)} {t('revisionBar.saved')}
        </span>
      )}
    </div>
  );
}

function SidePane({ label, name, side, task, turns, usage, usageOpen, onToggleUsage, onRetryLoad, onOpenSettings, busy, lastEventAt, error, projects, agentLabel, onStop, onSendHere, onContinue, onCopyRest }) {
  const { t } = useTranslation('artifacts');
  const last = turns[turns.length - 1];
  const total = totalDurationMs(turns);
  const status = sideStatus(turns, { busy, continued: !!side?.continuedAt });
  const now = useNow(status.tone === 'working');
  const startedAt = last?.userAt ? Date.parse(last.userAt) : NaN;
  const runningFor = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : null;
  const silent = busy ? silentFor(lastEventAt, now) : null;
  const project = task ? { id: side?.projectId, name: task.projectName, path: task.projectPath } : null;
  const cost = sideCost(usage);
  const lastTurnMs = last ? turnDurationMs(last) : null;
  return (
    <section
      aria-label={t('compare.side', { side: label.toUpperCase() })}
      className="min-h-0 flex flex-col rounded-[14px] border border-solid border-line bg-surface overflow-hidden"
    >
      <header className="flex flex-col gap-1 px-4 py-2.5 border-b border-x-0 border-t-0 border-solid border-line">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className="inline-grid place-items-center w-6 h-6 rounded-[6px] bg-surface-2 font-mono text-[11px] text-ink-3 flex-shrink-0"
          >
            {label.toUpperCase()}
          </span>
          <ProviderIcon maker={makerOf(side?.model, name)} size={16} />
          <h2 className="m-0 flex-1 min-w-0 text-[16px] leading-6 font-semibold text-ink truncate" title={name}>{name}</h2>
          {busy && <Button size="xs" variant="subtle" onClick={onStop}>{t('liveAppShare.stop')}</Button>}
          {!busy && !side?.continuedAt && turns.length > 0 && (
            <Tooltip content={t('compare.continueTooltip')}>
              <Button size="sm" onClick={onContinue}>{t('compare.continue')}</Button>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-3 pl-8 min-w-0">
          <span
            className="flex flex-1 items-center gap-1.5 text-[12px] text-ink-3 min-w-0"
            role="status"
            aria-label={t('compare.sideStatus', { side: label.toUpperCase() })}
            title={total.counted > 1 ? t('compare.allTurns', { duration: formatDuration(total.total) }) : undefined}
          >
            {status.tone === 'working'
              ? <span aria-hidden className="inline-flex"><Spinner /></span>
              : <span aria-hidden className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[status.tone]}`} />}
            <span className="truncate">
              {status.label}
              {status.tone === 'working' && runningFor !== null && ` · ${formatDuration(runningFor)}`}
              {silent !== null && ` · ${t('compare.noActivity', { duration: formatDuration(silent) })}`}
              {status.tone !== 'working' && lastTurnMs !== null && ` · ${turns.length > 1 ? t('compare.lastTurn', { duration: formatDuration(lastTurnMs) }) : formatDuration(lastTurnMs)}`}
              {side?.reasoningEffort && !name.includes(side.reasoningEffort) && ` · ${t('compare.effort', { effort: side.reasoningEffort })}`}
            </span>
          </span>
          {cost && (
            <button
              type="button"
              onClick={onToggleUsage}
              aria-expanded={!!usageOpen}
              aria-label={t('compare.costToggle', { side: label.toUpperCase(), cost: cost.text, open: usageOpen ? 'yes' : 'no' })}
              className="flex-shrink-0 inline-flex items-center gap-1 border-0 bg-transparent p-0 font-body text-[12.5px] text-ink-3 cursor-pointer hover:text-ink"
            >
              <span className="font-semibold text-ink tabular-nums">{cost.text}</span>
              <span>{t('compare.total')}</span>
              <ChevronDown
                size={14}
                strokeWidth={1.75}
                aria-hidden="true"
                className={`transition-transform ${usageOpen ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>
      </header>
      {cost && usageOpen && <UsageTable label={label} usage={usage} turns={turns} notes={cost.notes} />}
      {side?.carryIncomplete && side?.continuedProjectId && <CarryNotice name={name} onCopyRest={onCopyRest} />}
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
            onOpenSettings={onOpenSettings}
          />
        ) : error ? (
          <div className="py-10 flex justify-center">
            <Button size="sm" onClick={onRetryLoad}>{t('compare.retry')}</Button>
          </div>
        ) : (
          <div className="py-10 text-center"><Spinner /></div>
        )}
      </div>
    </section>
  );
}

// Who the follow-up goes to, as a pill in the composer's toolbar like the
// model picker on Home.
function SendToPicker({ target, names, onChange }) {
  const { t } = useTranslation('artifacts');
  return (
    <Select
      value={target}
      onValueChange={onChange}
      options={[
        { value: 'both', label: t('compare.bothModels') },
        { value: 'a', label: names.a },
        { value: 'b', label: names.b },
      ]}
      variant="unstyled"
      className="meta-pill"
      ariaLabel={t('compare.sendTo')}
      menuLabel={t('compare.sendTo')}
    />
  );
}

function UsageTable({ label, usage, turns, notes = [] }) {
  const { t } = useTranslation('artifacts');
  const rows = turnUsageRows(usage, turns);
  const turnCount = usage.turns?.length || 0;
  const num = 'py-1.5 text-right tabular-nums';
  return (
    <div className="px-4 py-3 bg-surface-2 border-b border-x-0 border-t-0 border-solid border-line">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <h3 className="m-0 text-[13px] font-semibold text-ink">{t('compare.usageByTurn')}</h3>
        <span className="text-[12px] text-ink-3 tabular-nums">
          {t('compare.usageSummary', { count: turnCount, tokens: formatTokens(usageTokens(usage)) })}
        </span>
      </div>
      <table aria-label={t('compare.sideUsage', { side: label.toUpperCase() })} className="w-full border-collapse text-[12.5px] text-ink-2">
        <thead>
          <tr className="text-ink-3">
            <th scope="col" className="py-1.5 text-left font-normal">{t('compare.columns.turn')}</th>
            <th scope="col" className={`${num} font-normal`}>{t('compare.columns.time')}</th>
            <th scope="col" className={`${num} font-normal`}>{t('compare.columns.input')}</th>
            <th scope="col" className={`${num} font-normal`}>{t('compare.columns.output')}</th>
            <th scope="col" className={`${num} font-normal`}>{t('compare.columns.cost')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={row.total ? 'border-0 border-t border-solid border-line font-semibold text-ink' : undefined}>
              <th scope="row" className="py-1.5 text-left font-[inherit]">{row.total ? t('compare.columns.total') : row.label.replace('Turn ', '')}</th>
              <td className={num}>{row.time ?? '–'}</td>
              <td className={num} title={row.inputDetail}>{row.input}</td>
              <td className={num}>{row.output}</td>
              <td className={num}>{row.cost}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="m-0 mt-2 text-[11.5px] text-ink-3">
        {t('compare.listPriceNote')}
        {notes.map((note) => ` ${note}`).join('')}
      </p>
    </div>
  );
}

// Some of a continued side's files are still in the comparison; the server
// says so on every load, so this stays until they are all across.
function CarryNotice({ name, onCopyRest }) {
  const { t } = useTranslation('artifacts');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="px-4 pt-2">
      <Alert variant="warning">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex-1 min-w-0">
            {t('compare.carryIncomplete', { name })}
          </span>
          <Button
            size="xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await onCopyRest();
              } catch (err) {
                setError(err?.message || t('compare.copyRestFailed'));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('compare.copyRest')}
          </Button>
        </div>
        {error && <div className="mt-1">{error}</div>}
      </Alert>
    </div>
  );
}

// After a partial carry the task already exists, so the dialog stays to offer
// the rest (the server finishes a carry only into the same project), and
// closing it opens the task.
function ContinueDialog({ name, projects, onClose, onContinue }) {
  const { t } = useTranslation('artifacts');
  const [projectId, setProjectId] = useState(projects[0] ? String(projects[0].id) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [partial, setPartial] = useState(null);
  return (
    <ConfirmModal
      open
      title={t('compare.continueWith', { name })}
      message={partial ? (
        <span role="alert">
          {t('compare.partialCarry', { name })}
        </span>
      ) : (
        <div className="flex flex-col gap-3">
          <span>
            {t('compare.continueBody', { name })}
          </span>
          <Select
            value={projectId}
            onValueChange={setProjectId}
            options={projects.map((p) => ({ value: String(p.id), label: projectLabel(p) }))}
            aria-label={t('compare.projectToContinue')}
          />
        </div>
      )}
      confirmLabel={partial ? t('status.tryAgain') : t('compare.continue')}
      cancelLabel={partial ? t('compare.openTask') : undefined}
      busy={busy}
      error={error}
      onConfirm={async () => {
        if (!projectId) return;
        setBusy(true);
        setError('');
        try {
          const result = await onContinue(projectId);
          if (result?.carriedAll === false) {
            setPartial(result);
            setBusy(false);
          }
        } catch (err) {
          setError(err?.message || t('compare.continueFailed'));
          setBusy(false);
        }
      }}
      onClose={() => onClose(partial?.conversationId)}
    />
  );
}
