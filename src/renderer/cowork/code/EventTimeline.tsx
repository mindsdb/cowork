import { useEffect, useMemo, useRef } from 'react';
import Ico from '../components/Icons';
import Spinner from '../components/ui/Spinner';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import type { CodingEvent, CodingSession } from './api';
import { CODE_STATUS, isActiveStatus } from './presentation';


const ACTIVITY_TYPES = new Set<CodingEvent['type']>(['reasoning', 'tool', 'command', 'file_change', 'diff', 'usage']);

type TimelineItem =
  | { kind: 'event'; event: CodingEvent }
  | { kind: 'activity'; events: CodingEvent[] }
  | { kind: 'errors'; events: CodingEvent[] };


function mergedEvents(events: CodingEvent[]): CodingEvent[] {
  const merged: CodingEvent[] = [];
  for (const event of events) {
    const previous = merged.at(-1);
    const canMerge = (!!event.text || !!event.item_id)
      && previous?.type === event.type
      && previous.item_id === event.item_id
      && previous.turn_id === event.turn_id
      && ['agent_message', 'reasoning', 'command', 'file_change'].includes(event.type);
    if (canMerge) {
      merged[merged.length - 1] = {
        ...previous,
        ...event,
        title: event.title || previous.title,
        text: previous.text + event.text,
        data: Object.keys(event.data).length ? event.data : previous.data,
      };
    } else {
      merged.push(event);
    }
  }
  return merged;
}


function timelineItems(events: CodingEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const event of mergedEvents(events)) {
    // Pending queue entries stay actionable beside the composer. When they
    // start, the server emits the ordinary completed user message, so showing
    // this provisional event here would duplicate the same instruction.
    if (event.type === 'user_message' && event.phase === 'pending' && event.data.queueId) continue;
    // Workspace setup and terminal state live in the task bar/outcome. Keeping
    // raw session notifications here creates contradictory duplicate statuses.
    if (event.type === 'session') continue;
    const kind = ACTIVITY_TYPES.has(event.type) ? 'activity' : event.type === 'error' ? 'errors' : 'event';
    const previous = items.at(-1);
    if (kind === 'activity' && previous?.kind === 'activity') {
      previous.events.push(event);
    } else if (kind === 'errors' && previous?.kind === 'errors') {
      previous.events.push(event);
    } else if (kind === 'activity' || kind === 'errors') {
      items.push({ kind, events: [event] });
    } else {
      items.push({ kind: 'event', event });
    }
  }
  return items;
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
    <details className={`code-activity-group${failed ? ' is-failed' : ''}`} open={failed}>
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
    </details>
  );
}


function ErrorGroup({ events }: { events: CodingEvent[] }) {
  const attempts = events.length;
  const latest = events[events.length - 1];
  return (
    <details className="code-retry-group">
      <summary>
        <span>{Ico.refresh(12)}</span>
        <span>{attempts > 1 ? `Connection retried ${attempts} times` : latest.title || 'Agent retry'}</span>
        <span className="code-retry-group__chevron">{Ico.chevDown(11)}</span>
      </summary>
      <div>{latest.text || 'The agent could not complete this attempt.'}</div>
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


function TimelineEvent({ event }: { event: CodingEvent }) {
  if (event.type === 'user_message') {
    return <div className="code-user-message" aria-label="Your message">{event.text}</div>;
  }
  if (event.type === 'agent_message') {
    return (
      <article className="code-agent-message" aria-label="Coding agent message">
        <MarkdownContent text={event.text} id={`code-event-${event.seq}`} complete={event.phase === 'completed'} />
      </article>
    );
  }
  if (event.type === 'plan') return <PlanEvent event={event} />;
  if (event.type === 'approval') return <div className="code-decision-record"><span>{Ico.check(12)}</span><div><strong>{event.title || 'Approval resolved'}</strong>{event.text && <p>{event.text}</p>}</div></div>;
  return null;
}


function TaskOutcome({ session, events }: { session: CodingSession; events: CodingEvent[] }) {
  if (isActiveStatus(session.status) || session.status === 'ready') return null;
  const status = CODE_STATUS[session.status];
  const latestError = [...events].reverse().find((event) => event.type === 'error');
  const detail = session.status === 'completed'
    ? 'The agent finished this turn. Review the changes or send a follow-up.'
    : session.status === 'failed'
      ? session.last_error || latestError?.text || 'The turn did not complete. Send a follow-up to retry in the same workspace.'
      : session.status === 'interrupted'
        ? 'The app stopped during this turn. Send a follow-up to resume the same session and workspace.'
        : 'The active turn was stopped. You can continue in the same session.';
  return (
    <section className={`code-task-outcome is-${status.tone}`}>
      <span className="code-task-outcome__icon">{session.status === 'completed' ? Ico.check(13) : session.status === 'failed' ? Ico.close(13) : Ico.stop(11)}</span>
      <div><strong>{status.label}</strong><p>{detail}</p></div>
    </section>
  );
}


export function EventTimeline({ events, session }: { events: CodingEvent[]; session: CodingSession }) {
  const items = useMemo(() => timelineItems(events), [events]);
  const latestEventSeq = events.at(-1)?.seq || 0;
  const active = isActiveStatus(session.status);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    const element = scrollRef.current;
    if (element && stickToBottom.current) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
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
        {items.map((item) => {
          const key = item.kind === 'event' ? `${item.event.seq}-${item.event.type}` : `${item.kind}-${item.events[0]?.seq}`;
          if (item.kind === 'activity') return <ActivityGroup key={key} events={item.events} active={active} />;
          if (item.kind === 'errors') return <ErrorGroup key={key} events={item.events} />;
          return <TimelineEvent key={key} event={item.event} />;
        })}
        {session.status === 'running' && (
          <div className="code-running-indicator"><Spinner className="text-sm" /><span>The coding agent is working…</span></div>
        )}
        <TaskOutcome session={session} events={events} />
      </div>
    </div>
  );
}
