import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import { WorkingIndicator } from '../components/thinking/WorkingIndicator';
import {
  activityHeadline,
  changeLabel,
  commandOutput,
  displayCommand,
  exitCode,
  fileChanges,
  isIgnoredActivity,
  isPlanUpdate,
  liveStatusLabel,
  planPosition,
  planSteps,
  reasoningHeading,
  reasoningSummary,
  stepFailed,
  stepLabel,
  turnDiffFiles,
  type FileChange,
  type StepIcon,
} from './activitySummary';
import { DiffPatchView } from './DiffPatchView';
import { accountFailure } from './composerNotices';
import { CopyResponseButton } from './CopyResponseButton';
import type { CodingEvent, CodingSession } from './api';
import { CODE_STATUS, compactPath, isActiveStatus } from './presentation';
import type { LatestEvents } from './useCodingSession';
import './event-timeline.css';


const RECOVERABLE_RUNS = ['interrupted', 'failed', 'recovering'];


const ACTIVITY_TYPES = new Set<CodingEvent['type']>(['reasoning', 'tool', 'command', 'file_change', 'diff', 'usage']);
const TIMELINE_WINDOW_SIZE = 300;

type TimelineItem =
  | { kind: 'event'; event: CodingEvent }
  | { kind: 'activity'; events: CodingEvent[] };


function lastEvent(item: TimelineItem | undefined): CodingEvent | undefined {
  if (!item) return undefined;
  return item.kind === 'event' ? item.event : item.events.at(-1);
}


// Slash-command answers arrive as `session` events marked with the command
// name (older servers only attached the /status and /goal snapshot); every
// other session notification is already represented by the task bar or the
// outcome card.
function isCommandAnswer(event: CodingEvent): boolean {
  return (typeof event.data.command === 'string' || 'goal' in event.data) && !!event.text;
}


function appendTimelineEvent(items: TimelineItem[], event: CodingEvent): void {
  // Pending queue entries stay actionable beside the composer. When they
  // start, the server emits the ordinary completed user message, so showing
  // this provisional event here would duplicate the same instruction.
  if (event.type === 'user_message' && event.phase === 'pending' && event.data.queueId) return;
  // Workspace setup and terminal state live in the task bar/outcome. Keeping
  // raw session notifications here creates contradictory duplicate statuses.
  if (event.type === 'session' && !isCommandAnswer(event)) return;
  // A late-confirmed follow-up is the one success worth a line: it tells the
  // user their unconfirmed instruction did reach the agent.
  if (event.type === 'command_result' && event.phase !== 'failed' && event.data.delivery !== 'confirmed') return;
  if (isIgnoredActivity(event)) return;

  const previousItem = items.at(-1);
  const previousEvent = lastEvent(previousItem);
  const canMerge = (!!event.text || !!event.item_id)
    && previousEvent?.type === event.type
    && previousEvent.item_id === event.item_id
    && previousEvent.turn_id === event.turn_id
    && ['agent_message', 'reasoning', 'command', 'file_change', 'child_work', 'plan'].includes(event.type);
  if (canMerge && previousEvent && previousItem) {
    const merged = {
      ...previousEvent,
      ...event,
      title: event.title || previousEvent.title,
      text: previousEvent.text + event.text,
      data: Object.keys(event.data).length ? event.data : previousEvent.data,
    };
    if (previousItem.kind === 'event') previousItem.event = merged;
    else previousItem.events[previousItem.events.length - 1] = merged;
    return;
  }

  // Approvals the user granted are part of the work they unblocked, so they
  // stay inside the activity group instead of splitting it. The pending
  // request is already shown by the approval card; a denial stays visible.
  const grantedApproval = event.type === 'approval' && event.data.decision !== 'deny';
  // A dropped connection that Codex retries is part of the work too, and so
  // is the turn's checklist. A turn that ends on the error gets the outcome
  // card instead, and a proposed plan from plan mode stays a card.
  const kind = ACTIVITY_TYPES.has(event.type) || grantedApproval || event.type === 'error' || isPlanUpdate(event) ? 'activity' : 'event';
  if (kind === 'activity' && previousItem?.kind === 'activity') {
    previousItem.events.push(event);
  } else if (kind === 'activity') {
    items.push({ kind, events: [event] });
  } else {
    items.push({ kind: 'event', event });
  }
}


function firstIndexAfter(events: CodingEvent[], seq: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle].seq <= seq) low = middle + 1;
    else high = middle;
  }
  return low;
}


function pruneTimelineItems(items: TimelineItem[], minimumSeq: number): TimelineItem[] {
  const retained: TimelineItem[] = [];
  for (const item of items) {
    if (item.kind === 'event') {
      if (item.event.seq >= minimumSeq) retained.push(item);
      continue;
    }
    const events = item.events.filter((event) => event.seq >= minimumSeq);
    if (events.length) retained.push({ ...item, events });
  }
  return retained;
}


function useTimelineItems(events: CodingEvent[], sessionId: string): TimelineItem[] {
  const model = useRef({ sessionId: '', firstSeq: 0, lastSeq: 0, items: [] as TimelineItem[] });
  const firstSeq = events[0]?.seq || 0;
  const lastSeq = events.at(-1)?.seq || 0;
  const reset = model.current.sessionId !== sessionId || lastSeq < model.current.lastSeq;
  if (reset || !events.length) {
    model.current = { sessionId, firstSeq, lastSeq: 0, items: [] };
  } else if (firstSeq > model.current.firstSeq) {
    model.current.items = pruneTimelineItems(model.current.items, firstSeq);
    model.current.firstSeq = firstSeq;
  }
  if (lastSeq > model.current.lastSeq) {
    const start = firstIndexAfter(events, model.current.lastSeq);
    for (let index = start; index < events.length; index += 1) {
      appendTimelineEvent(model.current.items, events[index]);
    }
    model.current.lastSeq = lastSeq;
    model.current.firstSeq = firstSeq;
  }
  return model.current.items;
}


function durationLabel(startedAt: number, endedAt: number): string {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) return '';
  const seconds = Math.max(1, Math.round((endedAt - startedAt) / 1_000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}


type ActivityRow =
  | { kind: 'step'; key: string; event: CodingEvent }
  | { kind: 'change'; key: string; change: FileChange };


// One row per step, at its latest state. Granted approvals are left out:
// the command they unblocked already shows. A request stays only while no
// decision followed. The turn diff is summarised after the answer instead.
function activityRows(events: CodingEvent[]): ActivityRow[] {
  const decided = new Set(events.filter((event) => event.type === 'approval' && event.phase === 'completed').map((event) => event.data.approvalId));
  const latest = new Map<string, CodingEvent>();
  for (const event of events) if (event.item_id) latest.set(event.item_id, event);
  // Each checklist update is the whole list, so only the latest is kept.
  const latestPlan = events.filter(isPlanUpdate).at(-1);
  const rows: ActivityRow[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type === 'usage' || event.type === 'diff') continue;
    if (isPlanUpdate(event) && event !== latestPlan) continue;
    if (event.type === 'reasoning' && !reasoningSummary(event)) continue;
    if (event.type === 'approval' && (event.phase === 'completed' || decided.has(event.data.approvalId))) continue;
    const id = event.item_id || `seq-${event.seq}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const current = (event.item_id && latest.get(event.item_id)) || event;
    if (current.type === 'reasoning' && !reasoningSummary(current)) continue;
    // The live status line names the step in progress.
    const live = current.phase === 'started' || current.phase === 'progress';
    if (live && ['command', 'tool', 'file_change'].includes(current.type)) continue;
    if (current.type === 'file_change') {
      fileChanges(current).forEach((change, index) => rows.push({ kind: 'change', key: `${id}-${index}`, change }));
    } else {
      rows.push({ kind: 'step', key: id, event: current });
    }
  }
  return rows;
}


const STEP_ICON: Record<StepIcon, (size: number) => ReactNode> = {
  read: Ico.doc,
  search: Ico.search,
  list: Ico.folder,
  command: Ico.code,
  edit: Ico.edit,
  tool: Ico.cube,
  image: Ico.image,
  thought: Ico.brain,
  compact: Ico.list,
  plan: Ico.taskCheck,
  retry: Ico.refresh,
  approval: Ico.key,
};


function StepHead({ icon, verb, target, failed, extra }: { icon: StepIcon; verb: string; target: string; failed?: boolean; extra?: ReactNode }) {
  return (
    <>
      <span className="code-step__icon" aria-hidden="true">{STEP_ICON[icon](13)}</span>
      <span className="code-step__label">
        {verb && <span className="code-step__verb">{verb}</span>}
        {verb && target ? ' ' : ''}
        <span className="code-step__target">{target}</span>
      </span>
      {failed && <span className="code-step__status">Failed</span>}
      {extra}
    </>
  );
}


// A step with nothing more to show is a plain line; otherwise the line
// opens onto its detail. A failure starts closed like any other step: the
// agent usually moves past it, and its failed marker already says so.
function Step({ head, failed = false, detail }: { head: ReactNode; failed?: boolean; detail?: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  const className = `code-step${failed ? ' is-failed' : ''}`;
  if (!detail) return <div className={className}><div className="code-step__head">{head}</div></div>;
  return (
    <div className={`${className}${open ? ' is-open' : ''}`}>
      <button type="button" className="code-step__head" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {head}
        <span className="code-step__chevron" aria-hidden="true">{Ico.chevDown(11)}</span>
      </button>
      {open && <div className="code-step__detail">{detail()}</div>}
    </div>
  );
}


function stepDetail(event: CodingEvent): (() => ReactNode) | undefined {
  if (event.type === 'command') {
    const output = commandOutput(event);
    const code = exitCode(event);
    return () => (
      <div className="code-step__shell">
        <pre className="code-step__command"><span aria-hidden="true">$ </span>{displayCommand(event)}</pre>
        {stepFailed(event) && code !== null && <div className="code-step__exit">Exit code {code}</div>}
        {output && <pre className="code-step__output">{output}</pre>}
      </div>
    );
  }
  if (isPlanUpdate(event)) {
    const explanation = typeof event.data.explanation === 'string' ? event.data.explanation : '';
    return () => (
      <div className="code-step__plan">
        {explanation && <p>{explanation}</p>}
        <PlanSteps event={event} />
      </div>
    );
  }
  if (event.type === 'reasoning') {
    // The heading already names the thought; the detail is the rest of it.
    const summary = reasoningSummary(event).replace(`**${reasoningHeading(event)}**`, '').trim();
    return summary ? () => <p className="code-step__thought">{summary}</p> : undefined;
  }
  const result = event.type === 'tool' && event.data.result && typeof event.data.result === 'object'
    ? (event.data.result as { content?: Array<{ text?: unknown }> }).content?.map((part) => (typeof part.text === 'string' ? part.text : '')).join('\n')
    : '';
  return result ? () => <pre className="code-step__output">{result}</pre> : undefined;
}


function StepRow({ event }: { event: CodingEvent }) {
  const failed = stepFailed(event);
  return <Step head={<StepHead {...stepLabel(event)} failed={failed} />} failed={failed} detail={stepDetail(event)} />;
}


function LineCounts({ additions, deletions }: { additions: number; deletions: number }) {
  if (!additions && !deletions) return null;
  return (
    <span className="code-line-counts">
      <span className="is-addition">+{additions}</span> <span className="is-deletion">−{deletions}</span>
    </span>
  );
}


function changeDetail(change: FileChange): (() => ReactNode) | undefined {
  if (!change.patch) return undefined;
  return () => (
    <div className="code-step__diff">
      <div className="code-step__diff-path" title={change.path}>{compactPath(change.path)}</div>
      <DiffPatchView patch={change.patch} onSelectionChange={() => {}} />
    </div>
  );
}


function ChangeRow({ change }: { change: FileChange }) {
  return (
    <Step
      head={<StepHead icon="edit" {...changeLabel(change)} extra={<LineCounts additions={change.additions} deletions={change.deletions} />} />}
      detail={changeDetail(change)}
    />
  );
}


function stepHeadline(row: ActivityRow): string {
  const label = row.kind === 'change' ? changeLabel(row.change) : stepLabel(row.event);
  return [label.verb, label.target].filter(Boolean).join(' ');
}


function ActivityGroup({ events }: { events: CodingEvent[] }) {
  const rows = activityRows(events);
  // Retries are recoverable, so they do not count as failures.
  const failures = rows.filter((row) => row.kind === 'step' && stepFailed(row.event)).length;
  const failed = failures > 0;
  const [open, setOpen] = useState(false);
  // A lone step's headline already names it, so the group opens straight
  // onto its detail instead of repeating the line.
  const [only] = rows;
  const headline = activityHeadline(events);
  const sole = rows.length === 1 && headline === stepHeadline(only)
    ? (only.kind === 'change' ? changeLabel(only.change) : stepLabel(only.event))
    : null;
  const single = sole ? (only.kind === 'change' ? changeDetail(only.change) : stepDetail(only.event)) : undefined;
  // Like the step rows, a single step's target reads darker than its verb.
  const copy = sole
    ? <span className="code-activity-group__copy">{sole.verb && <>{sole.verb} </>}<span className="code-activity-group__target">{sole.target}</span></span>
    : <span className="code-activity-group__copy">{headline}</span>;
  if (sole && !single) return <div className="code-activity-group"><div className="code-activity-group__line">{copy}</div></div>;
  return (
    <details
      className={`code-activity-group${failed ? ' is-failed' : ''}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {copy}
        {failed && <small>{failures} failed</small>}
        <span className="code-activity-group__chevron">{Ico.chevDown(11)}</span>
      </summary>
      {open && (
        <div className="code-activity-group__body">
          {single ? <div className="code-step__detail">{single()}</div> : rows.map((row) => (row.kind === 'change'
            ? <ChangeRow key={row.key} change={row.change} />
            : <StepRow key={row.key} event={row.event} />))}
        </div>
      )}
    </details>
  );
}


// Only a turn's answer is worth copying. Agent messages earlier in the turn
// are progress notes between steps, and a live turn has no answer yet.
function answerSeqs(items: TimelineItem[], turnActive: boolean): Set<number> {
  const answers = new Set<number>();
  let lastMessageSeq: number | undefined;
  const closeTurn = () => {
    if (lastMessageSeq !== undefined) answers.add(lastMessageSeq);
    lastMessageSeq = undefined;
  };
  for (const item of items) {
    if (item.kind !== 'event') continue;
    if (item.event.type === 'user_message') closeTurn();
    else if (item.event.type === 'agent_message') lastMessageSeq = item.event.seq;
  }
  if (!turnActive) closeTurn();
  return answers;
}


type RenderItem =
  | TimelineItem
  | { kind: 'worked'; key: string; items: TimelineItem[]; label: string }
  | { kind: 'changes'; key: string; diff: CodingEvent };


function hasVisibleContent(item: TimelineItem): boolean {
  return item.kind === 'event' || activityRows(item.events).length > 0;
}


// Codex can finish a thought, or report usage, after the turn's answer. That
// is still the turn's work, so it moves ahead of the answer and folds with
// the rest instead of trailing it as a group of its own.
function workBeforeAnswers(items: TimelineItem[], answers: Set<number>): TimelineItem[] {
  const ordered: TimelineItem[] = [];
  let answerIndex = -1;
  for (const item of items) {
    if (item.kind === 'event' && item.event.type === 'user_message') answerIndex = -1;
    if (answerIndex >= 0 && item.kind === 'activity') {
      ordered.splice(answerIndex, 0, item);
      answerIndex += 1;
      continue;
    }
    if (item.kind === 'event' && item.event.type === 'agent_message' && answers.has(item.event.seq)) answerIndex = ordered.length;
    ordered.push(item);
  }
  return ordered;
}


// A finished turn folds its work and progress notes under one "Worked for"
// line, leaving the request and the answer. The turn in progress stays
// open, and a turn without an answer keeps its work in view.
function foldFinishedTurns(items: TimelineItem[], answers: Set<number>): RenderItem[] {
  const rendered: RenderItem[] = [];
  let work: TimelineItem[] = [];
  let startedAt = Number.NaN;
  for (const item of workBeforeAnswers(items, answers)) {
    if (item.kind === 'event' && item.event.type === 'user_message') {
      rendered.push(...work, item);
      work = [];
      startedAt = Date.parse(item.event.timestamp);
      continue;
    }
    if (item.kind === 'event' && item.event.type === 'agent_message' && answers.has(item.event.seq)) {
      if (work.some(hasVisibleContent)) {
        const start = Number.isFinite(startedAt) ? startedAt : Date.parse(lastEvent(work[0])?.timestamp || '');
        const duration = durationLabel(start, Date.parse(item.event.timestamp));
        rendered.push({ kind: 'worked', key: `worked-${item.event.seq}`, items: work, label: duration ? `Worked for ${duration}` : 'Worked' });
      } else {
        rendered.push(...work);
      }
      rendered.push(item);
      const diff = work.flatMap((entry) => (entry.kind === 'activity' ? entry.events : [])).filter((event) => event.type === 'diff' && event.text).at(-1);
      if (diff) rendered.push({ kind: 'changes', key: `changes-${item.event.seq}`, diff });
      work = [];
      continue;
    }
    work.push(item);
  }
  rendered.push(...work);
  return rendered;
}


function WorkedSummary({ label, children }: { label: string; children: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="code-worked" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>{label}</span>
        <span className="code-activity-group__chevron">{Ico.chevDown(11)}</span>
      </summary>
      {open && <div className="code-worked__body">{children()}</div>}
    </details>
  );
}


const TURN_CHANGES_SHOWN = 5;


function TurnChanges({ diff, onOpenReview }: { diff: CodingEvent; onOpenReview?: () => void }) {
  const files = turnDiffFiles(diff.text);
  if (!files.length) return null;
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  return (
    <section className="code-turn-changes" aria-label="Files changed in this turn">
      <header>
        <span className="code-turn-changes__icon" aria-hidden="true">{Ico.edit(13)}</span>
        <strong>Edited {files.length} {files.length === 1 ? 'file' : 'files'}</strong>
        <LineCounts additions={additions} deletions={deletions} />
        {onOpenReview && <Button size="sm" variant="subtle" className="ml-auto" onClick={onOpenReview}>Review</Button>}
      </header>
      <ul>
        {files.slice(0, TURN_CHANGES_SHOWN).map((file) => (
          <li key={file.path}>
            <span className="code-turn-changes__path">{file.path}</span>
            <LineCounts additions={file.additions} deletions={file.deletions} />
          </li>
        ))}
        {files.length > TURN_CHANGES_SHOWN && <li className="code-turn-changes__more">and {files.length - TURN_CHANGES_SHOWN} more</li>}
      </ul>
    </section>
  );
}


// The current turn's checklist, which can sit in an earlier group than the
// work in progress.
function latestTurnPlan(items: TimelineItem[]): CodingEvent | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === 'event' && item.event.type === 'user_message') return undefined;
    if (item.kind === 'activity') {
      const plan = item.events.filter(isPlanUpdate).at(-1);
      if (plan) return plan;
    }
  }
  return undefined;
}


function turnStartedAt(items: TimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === 'event' && item.event.type === 'user_message') return Date.parse(item.event.timestamp);
  }
  return Number.NaN;
}


function elapsedLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}


// The one moving part while the agent works, matching chat mode's thinking
// header: what the agent is doing now, and how long this turn has taken.
function runningLabel(session: CodingSession, liveEvents: CodingEvent[]): string {
  // A new task is running while its workspace is still being copied or checked out.
  if (session.run_status === 'queued' || session.run_status === 'preparing') return 'Preparing the task workspace…';
  if (session.task_mode === 'plan' && !liveEvents.length) return 'Exploring and preparing a plan…';
  return liveStatusLabel(liveEvents);
}


function LiveStatus({ label, step, startedAt }: { label: string; step: string; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="code-running-indicator" role="status">
      <WorkingIndicator label={label} />
      {step && <span className="code-running-indicator__elapsed">{step}</span>}
      {Number.isFinite(startedAt) && <span className="code-running-indicator__elapsed">{elapsedLabel(now - startedAt)}</span>}
    </div>
  );
}


function PlanSteps({ event }: { event: CodingEvent }) {
  return (
    <>
      {planSteps(event).map((step, index) => (
        <div className="code-plan__step" key={`${event.seq}-${index}`}>
          <span className={`code-plan__dot is-${step.status}`} aria-hidden="true">{step.status === 'completed' ? '✓' : ''}</span>
          <span>{step.step}</span>
        </div>
      ))}
    </>
  );
}


// A plan proposed in plan mode, which the user decides on.
function PlanEvent({ event }: { event: CodingEvent }) {
  return (
    <section className="code-plan">
      <div className="code-plan__heading">{event.title || 'Plan'}</div>
      {isPlanUpdate(event)
        ? <PlanSteps event={event} />
        : <MarkdownContent text={event.text || (typeof event.data.text === 'string' ? event.data.text : '') || 'The agent is preparing a plan…'} />}
    </section>
  );
}


function ChildWorkEvent({ event }: { event: CodingEvent }) {
  const status = typeof event.data.status === 'string' ? event.data.status : event.phase || '';
  const running = event.phase === 'started' || event.phase === 'progress' || /running|progress/i.test(status);
  const failed = event.phase === 'failed' || /failed|error/i.test(status);
  const detail = ['description', 'prompt', 'message']
    .map((key) => event.data[key])
    .find((value) => typeof value === 'string' && value !== event.title);
  return (
    <section className={`code-child-work${running ? ' is-running' : ''}${failed ? ' is-failed' : ''}`} aria-label="Parallel Codex work">
      <span className="code-child-work__icon">{running ? <Spinner className="text-xs" /> : failed ? Ico.close(11) : Ico.check(11)}</span>
      <div>
        <small>Parallel work</small>
        <strong>{event.title || 'Codex worker'}</strong>
        {typeof detail === 'string' && <p>{detail}</p>}
      </div>
      <span className="code-child-work__status">{running ? 'Working' : failed ? 'Stopped' : 'Done'}</span>
    </section>
  );
}


function TimelineEvent({ event, copyable = false }: { event: CodingEvent; copyable?: boolean }) {
  if (event.type === 'user_message') {
    return <div className="code-user-message" aria-label="Your message">{event.text}</div>;
  }
  if (event.type === 'agent_message') {
    return (
      <article className="code-agent-message" aria-label="Coding agent message">
        <MarkdownContent
          text={event.text}
          id={`code-event-${event.seq}`}
          complete={event.phase === 'completed'}
          animateStreamingWords={false}
        />
        {copyable && <CopyResponseButton text={event.text} />}
      </article>
    );
  }
  if (event.type === 'plan') return <PlanEvent event={event} />;
  if (event.type === 'child_work') return <ChildWorkEvent event={event} />;
  if (event.type === 'approval' && event.data.decision === 'deny') return <div className="code-decision-record is-failed"><span>{Ico.close(12)}</span><div><strong>Approval denied</strong></div></div>;
  if (event.type === 'approval') return <div className="code-decision-record"><span>{Ico.check(12)}</span><div><strong>{event.title || 'Approval resolved'}</strong>{event.text && <p>{event.text}</p>}</div></div>;
  if (event.type === 'command_result' && event.data.delivery === 'confirmed') return <div className="code-decision-record"><span>{Ico.check(12)}</span><div><strong>{event.title || 'Follow-up delivered'}</strong>{event.text && <p>{event.text}</p>}</div></div>;
  if (event.type === 'command_result') return <div className="code-decision-record is-failed"><span>{Ico.close(12)}</span><div><strong>{event.title || 'Request rejected'}</strong>{event.text && <p>{event.text}</p>}</div></div>;
  if (event.type === 'session') return <div className="code-decision-record is-info"><span>{Ico.list(12)}</span><div><strong>{event.title || 'Task status'}</strong>{event.text && <p>{event.text}</p>}</div></div>;
  return null;
}


function TaskOutcome({
  session,
  latestSession,
  latestError,
  recovering,
}: {
  session: CodingSession;
  latestSession: CodingEvent | undefined;
  latestError: CodingEvent | undefined;
  recovering: boolean;
}) {
  // A paused remote run and its Reopen task action are about the next send,
  // so the composer lip carries them, as it does account and model limits.
  if (RECOVERABLE_RUNS.includes(session.run_status || '')) return null;
  // A finished turn speaks for itself: the answer, its copy button, and the
  // task status in the header. Only a stop or a failure leaves a card.
  if (session.status === 'completed') return null;
  if (['queued', 'preparing', 'ready', 'running', 'awaiting_approval'].includes(session.run_status || '')) return null;
  if (isActiveStatus(session.status) || session.status === 'ready') return null;
  if (accountFailure(session, latestSession, latestError, recovering)) return null;
  const status = CODE_STATUS[session.status];
  const failure = latestSession?.data.status === 'failed' && typeof latestSession.data.code === 'string'
    ? latestSession
    : latestError;
  const technicalDetail = typeof failure?.data.detail === 'string' ? failure.data.detail : '';
  const errorDetail = technicalDetail || session.last_error || failure?.text || '';
  return (
    <section className={`code-task-outcome is-${status.tone}`}>
      <span className="code-task-outcome__icon">{Ico.stop(11)}</span>
      <div className="code-task-outcome__copy">
        <strong>{status.label}</strong>
        {errorDetail && session.status === 'failed' && (
          <details className="code-task-outcome__details">
            <summary>Failure details</summary>
            <p>{errorDetail}</p>
          </details>
        )}
      </div>
    </section>
  );
}


export const EventTimeline = memo(function EventTimeline({
  events,
  latestEvents,
  session,
  recovering = false,
  onOpenReview,
}: {
  events: CodingEvent[];
  latestEvents: LatestEvents;
  session: CodingSession;
  recovering?: boolean;
  onOpenReview?: () => void;
}) {
  const items = useTimelineItems(events, session.id);
  const [visibleCount, setVisibleCount] = useState(TIMELINE_WINDOW_SIZE);
  useEffect(() => { setVisibleCount(TIMELINE_WINDOW_SIZE); }, [session.id]);
  const hiddenCount = Math.max(0, items.length - visibleCount);
  const visibleItems = hiddenCount ? items.slice(-visibleCount) : items;
  const latestEventSeq = events.at(-1)?.seq || 0;
  // A paused run's last error is shown by the composer lip's details, not repeated here.
  const pausedRun = RECOVERABLE_RUNS.includes(session.run_status || '');
  const latestError = latestEvents.error?.latest;
  const terminalErrorSeq = pausedRun ? latestError?.seq : undefined;
  const answers = answerSeqs(items, isActiveStatus(session.status));
  const lastItem = items.at(-1);
  const liveEvents = lastItem?.kind === 'activity' ? lastItem.events : [];
  const renderItem = (item: TimelineItem) => {
    const key = item.kind === 'event' ? `${item.event.seq}-${item.event.type}` : `${item.kind}-${item.events[0]?.seq}`;
    if (item.kind === 'activity') {
      const groupEvents = terminalErrorSeq == null
        ? item.events
        : item.events.filter((event) => event.seq !== terminalErrorSeq);
      // Telemetry alone, such as a token-usage update between two
      // messages, has nothing to open.
      return activityRows(groupEvents).length ? <ActivityGroup key={key} events={groupEvents} /> : null;
    }
    return <TimelineEvent key={key} event={item.event} copyable={answers.has(item.event.seq)} />;
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    const element = scrollRef.current;
    // Live deltas can arrive many times a second. Starting a new smooth-scroll
    // animation for each one keeps layout and the GPU busy long after the text
    // has rendered, and can make typing visibly lag. Batched updates should
    // snap a pinned transcript to its new bottom immediately.
    if (element && stickToBottom.current) element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
  }, [latestEventSeq, session.status]);
  // Stay pinned when the dock grows, e.g. a decision tray opens.
  useEffect(() => {
    const element = scrollRef.current;
    const inner = element?.firstElementChild;
    if (!element || !inner || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
    });
    observer.observe(inner, { box: 'border-box' });
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={scrollRef}
      className="code-timeline scroll-clean"
      aria-live="polite"
      onScroll={(event) => {
        const element = event.currentTarget;
        stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
      }}
    >
      <div className="code-timeline__inner">
        {hiddenCount > 0 && (
          <Button
            size="xs"
            className="code-timeline__earlier"
            onClick={() => setVisibleCount((current) => current + TIMELINE_WINDOW_SIZE)}
          >
            Show {Math.min(hiddenCount, TIMELINE_WINDOW_SIZE)} earlier updates
          </Button>
        )}
        {foldFinishedTurns(visibleItems, answers).map((item) => {
          if (item.kind === 'worked') return <WorkedSummary key={item.key} label={item.label}>{() => item.items.map(renderItem)}</WorkedSummary>;
          if (item.kind === 'changes') return <TurnChanges key={item.key} diff={item.diff} onOpenReview={onOpenReview} />;
          return renderItem(item);
        })}
        {session.status === 'running' && (
          <LiveStatus
            label={runningLabel(session, liveEvents)}
            step={planPosition(latestTurnPlan(items))}
            startedAt={turnStartedAt(items)}
          />
        )}
        <TaskOutcome
          session={session}
          latestSession={latestEvents.session?.latest}
          latestError={latestError}
          recovering={recovering}
        />
      </div>
    </div>
  );
}, (left, right) => (
  left.events === right.events
  && left.latestEvents === right.latestEvents
  && left.session.status === right.session.status
  && left.session.task_mode === right.session.task_mode
  && left.session.run_status === right.session.run_status
  && left.session.computer_status === right.session.computer_status
  && left.session.last_error === right.session.last_error
  && left.recovering === right.recovering
  && left.onOpenReview === right.onOpenReview
));
