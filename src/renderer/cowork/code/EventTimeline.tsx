import { memo, useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import type { CodingEvent, CodingSession } from './api';
import { CODE_STATUS, codingSessionStatus, isActiveStatus } from './presentation';
import './event-timeline.css';


const ACTIVITY_TYPES = new Set<CodingEvent['type']>(['reasoning', 'tool', 'command', 'file_change', 'diff', 'usage']);
const TIMELINE_WINDOW_SIZE = 300;

type TimelineItem =
  | { kind: 'event'; event: CodingEvent }
  | { kind: 'activity'; events: CodingEvent[] }
  | { kind: 'errors'; events: CodingEvent[] };


function lastEvent(item: TimelineItem | undefined): CodingEvent | undefined {
  if (!item) return undefined;
  return item.kind === 'event' ? item.event : item.events.at(-1);
}


function appendTimelineEvent(items: TimelineItem[], event: CodingEvent): void {
  // Pending queue entries stay actionable beside the composer. When they
  // start, the server emits the ordinary completed user message, so showing
  // this provisional event here would duplicate the same instruction.
  if (event.type === 'user_message' && event.phase === 'pending' && event.data.queueId) return;
  // Workspace setup and terminal state live in the task bar/outcome. Keeping
  // raw session notifications here creates contradictory duplicate statuses.
  if (event.type === 'session') return;

  const previousItem = items.at(-1);
  const previousEvent = lastEvent(previousItem);
  const canMerge = (!!event.text || !!event.item_id)
    && previousEvent?.type === event.type
    && previousEvent.item_id === event.item_id
    && previousEvent.turn_id === event.turn_id
    && ['agent_message', 'reasoning', 'command', 'file_change', 'child_work'].includes(event.type);
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

  const kind = ACTIVITY_TYPES.has(event.type) ? 'activity' : event.type === 'error' ? 'errors' : 'event';
  if (kind === 'activity' && previousItem?.kind === 'activity') {
    previousItem.events.push(event);
  } else if (kind === 'errors' && previousItem?.kind === 'errors') {
    previousItem.events.push(event);
  } else if (kind === 'activity' || kind === 'errors') {
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


function durationLabel(events: CodingEvent[]): string {
  const start = Date.parse(events[0]?.timestamp || '');
  const end = Date.parse(events.at(-1)?.timestamp || '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '';
  const seconds = Math.max(1, Math.round((end - start) / 1_000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}


function eventSummary(event: CodingEvent): string {
  const data = event.data;
  for (const key of ['command', 'path', 'name', 'message', 'status']) {
    const value = data[key];
    if (typeof value === 'string' && value) return value;
  }
  return event.title || event.text.split('\n')[0] || 'Agent activity';
}


function ActivityGroup({ events, active }: { events: CodingEvent[]; active: boolean }) {
  const failed = events.some((event) => event.phase === 'failed');
  const [open, setOpen] = useState(failed);
  useEffect(() => { if (failed) setOpen(true); }, [failed]);
  const inProgress = active && events.some((event) => event.phase === 'progress' || event.phase === 'started');
  const fileCount = events.filter((event) => event.type === 'file_change' || event.type === 'diff').length;
  const commandCount = events.filter((event) => event.type === 'command' || event.type === 'tool').length;
  const latest = events[events.length - 1];
  const counts = [
    commandCount ? `${commandCount} ${commandCount === 1 ? 'action' : 'actions'}` : '',
    fileCount ? `${fileCount} ${fileCount === 1 ? 'change' : 'changes'}` : '',
    durationLabel(events),
  ].filter(Boolean).join(' · ');
  return (
    <details
      className={`code-activity-group${failed ? ' is-failed' : ''}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="code-activity-group__icon">
          {inProgress ? <Spinner className="text-xs" /> : failed ? Ico.close(12) : Ico.check(12)}
        </span>
        <span className="code-activity-group__copy">
          <span>{inProgress ? eventSummary(latest) : failed ? 'Some agent activity failed' : 'Agent activity'}</span>
          <small>{counts || 'Details'}</small>
        </span>
        <span className="code-activity-group__chevron">{Ico.chevDown(11)}</span>
      </summary>
      {open && (
        <div className="code-activity-group__body">
          {events.map((event) => (
            <div className="code-activity-row" key={`${event.seq}-${event.type}`}>
              <span className="code-activity-row__kind">{event.type.replace('_', ' ')}</span>
              <div>
                <strong>{eventSummary(event)}</strong>
                {event.text && event.text !== eventSummary(event) && <pre>{event.text}</pre>}
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}


function ErrorGroup({ events }: { events: CodingEvent[] }) {
  const [open, setOpen] = useState(false);
  const attempts = events.length;
  const latest = events[events.length - 1];
  return (
    <details className="code-retry-group" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>{Ico.refresh(12)}</span>
        <span>{attempts > 1 ? `Connection retried ${attempts} times` : latest.title || 'Agent retry'}</span>
        <span className="code-retry-group__chevron">{Ico.chevDown(11)}</span>
      </summary>
      {open && <div>{latest.text || 'The agent could not complete this attempt.'}</div>}
    </details>
  );
}


function PlanEvent({ event }: { event: CodingEvent }) {
  const plan = Array.isArray(event.data.plan) ? event.data.plan : [];
  return (
    <section className="code-plan">
      <div className="code-plan__heading">{event.title || 'Plan'}</div>
      {plan.length ? plan.map((raw, index) => {
        const step = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const rawStatus = typeof step.status === 'string' ? step.status : '';
        const status = rawStatus === 'completed'
          ? 'completed'
          : rawStatus === 'inProgress' || rawStatus === 'in_progress' || rawStatus === 'running'
            ? 'in_progress'
            : 'pending';
        return (
          <div className="code-plan__step" key={`${event.seq}-${index}`}>
            <span className={`code-plan__dot is-${status}`} aria-hidden="true">{status === 'completed' ? '✓' : ''}</span>
            <span>{typeof step.step === 'string' ? step.step : 'Plan step'}</span>
          </div>
        );
      }) : <div className="code-event__text">{event.text || 'The agent updated its plan.'}</div>}
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


function TimelineEvent({ event }: { event: CodingEvent }) {
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
      </article>
    );
  }
  if (event.type === 'plan') return <PlanEvent event={event} />;
  if (event.type === 'child_work') return <ChildWorkEvent event={event} />;
  if (event.type === 'approval') return <div className="code-decision-record"><span>{Ico.check(12)}</span><div><strong>{event.title || 'Approval resolved'}</strong>{event.text && <p>{event.text}</p>}</div></div>;
  return null;
}


function TaskOutcome({
  session,
  events,
  recovering,
  onRecover,
}: {
  session: CodingSession;
  events: CodingEvent[];
  recovering: boolean;
  onRecover: () => Promise<void>;
}) {
  const recoverable = ['interrupted', 'failed', 'recovering'].includes(session.run_status || '');
  const remoteRunActive = ['queued', 'preparing', 'ready', 'running', 'awaiting_approval'].includes(session.run_status || '');
  if (remoteRunActive) return null;
  if (isActiveStatus(session.status) || (session.status === 'ready' && !recoverable)) return null;
  const status = recoverable ? codingSessionStatus(session) : CODE_STATUS[session.status];
  const latestError = [...events].reverse().find((event) => event.type === 'error');
  const errorDetail = session.last_error || latestError?.text || '';
  const recoveryInProgress = recovering || session.run_status === 'recovering';
  const detail = session.status === 'completed'
    ? 'The agent finished this turn. Review the changes or send a follow-up.'
    : recoverable
      ? session.computer_status === 'offline'
        ? 'The task computer disconnected. Your conversation is safe; resume there or choose another compatible computer.'
        : 'The turn stopped before it completed. Your conversation, working copy, and changes are preserved.'
      : 'The active turn was stopped. You can continue in the same task.';
  return (
    <section className={`code-task-outcome is-${status.tone}${recoverable ? ' is-recovery' : ''}`}>
      <span className="code-task-outcome__icon">{session.status === 'completed' ? Ico.check(13) : recoverable ? Ico.refresh(12) : Ico.stop(11)}</span>
      <div className="code-task-outcome__copy">
        <strong>{recoverable ? (recoveryInProgress ? 'Resuming task' : 'Task paused') : status.label}</strong>
        <p>{recoveryInProgress ? 'Reconnecting to the task files…' : detail}</p>
        {errorDetail && !recoveryInProgress && (recoverable || session.status === 'failed') && (
          <details className="code-task-outcome__details">
            <summary>Failure details</summary>
            <p>{errorDetail}</p>
          </details>
        )}
      </div>
      {recoverable && (
        <Button size="sm" variant="tinted" disabled={recoveryInProgress} onClick={() => void onRecover()}>
          {recoveryInProgress ? 'Resuming…' : 'Resume task'}
        </Button>
      )}
    </section>
  );
}


export const EventTimeline = memo(function EventTimeline({
  events,
  session,
  recovering = false,
  onRecover = async () => {},
}: {
  events: CodingEvent[];
  session: CodingSession;
  recovering?: boolean;
  onRecover?: () => Promise<void>;
}) {
  const items = useTimelineItems(events, session.id);
  const [visibleCount, setVisibleCount] = useState(TIMELINE_WINDOW_SIZE);
  useEffect(() => { setVisibleCount(TIMELINE_WINDOW_SIZE); }, [session.id]);
  const hiddenCount = Math.max(0, items.length - visibleCount);
  const visibleItems = hiddenCount ? items.slice(-visibleCount) : items;
  const latestEventSeq = events.at(-1)?.seq || 0;
  const hasRecoveryCard = ['interrupted', 'failed', 'recovering'].includes(session.run_status || '');
  const terminalErrorSeq = hasRecoveryCard
    ? [...events].reverse().find((event) => event.type === 'error')?.seq
    : undefined;
  const active = isActiveStatus(session.status);
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
          <button
            type="button"
            className="code-timeline__earlier"
            onClick={() => setVisibleCount((current) => current + TIMELINE_WINDOW_SIZE)}
          >
            Show {Math.min(hiddenCount, TIMELINE_WINDOW_SIZE)} earlier updates
          </button>
        )}
        {visibleItems.map((item) => {
          const key = item.kind === 'event' ? `${item.event.seq}-${item.event.type}` : `${item.kind}-${item.events[0]?.seq}`;
          if (item.kind === 'activity') return <ActivityGroup key={key} events={item.events} active={active} />;
          if (item.kind === 'errors') {
            const retryEvents = terminalErrorSeq == null
              ? item.events
              : item.events.filter((event) => event.seq !== terminalErrorSeq);
            return retryEvents.length ? <ErrorGroup key={key} events={retryEvents} /> : null;
          }
          return <TimelineEvent key={key} event={item.event} />;
        })}
        {session.status === 'running' && (
          <div className="code-running-indicator"><Spinner className="text-sm" /><span>The coding agent is working…</span></div>
        )}
        <TaskOutcome session={session} events={events} recovering={recovering} onRecover={onRecover} />
      </div>
    </div>
  );
}, (left, right) => (
  left.events === right.events
  && left.session.status === right.session.status
  && left.session.run_status === right.session.run_status
  && left.session.computer_status === right.session.computer_status
  && left.session.last_error === right.session.last_error
  && left.recovering === right.recovering
));
