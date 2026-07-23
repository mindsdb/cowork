// `<MissionControlView>` — the approvals-driven supervision board.
//
// Four quiet columns composed by `useBoard`:
//   Needs You  pending approvals (drill into the conversation)
//   Running    in-flight conversations w/ a live dot + started-at
//   Scheduled  digest schedules (drill into the scheduled view)
//   Shipped    recently resolved approvals, today vs earlier
//
// The headline counts only the Needs-You column — that's the one the user
// must act on; everything else is Anton's side of the fence. Top-right is
// the standard Composer wired into the same new-task flow HomeView uses.
//
// No new design here: PageHeader rhythm for the masthead, CardRow for the
// column rows, Badge for statuses, CSS-var tokens throughout.

import Ico from '../components/Icons';
import Composer from '../components/Composer';
import { CardRow, Spinner } from '../components/ui';
import Badge from '../components/ui/Badge';
import { useBoard } from '../components/board/useBoard';
import { relativeAge, relativeTime } from '../lib/formatTime';

const QUIET = { fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-3)' };

function approvalTitle(a) {
  const desc = a?.actionDescriptor || {};
  return a?.kind === 'auth'
    ? `Sign in to ${desc.appName || 'this app'}`
    : (desc.summary || 'Approval');
}

// Same mapping as ScheduleCard's cadenceLabel.
function cadenceLabel(cadence) {
  return {
    once: 'One-off',
    hourly: 'Hourly',
    daily: 'Daily',
    weekdays: 'Weekdays',
    weekly: 'Weekly',
  }[cadence] || cadence || '';
}

function Column({ title, count, isEmpty, empty, children }) {
  return (
    <section aria-label={title} style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8,
        padding: '0 4px 6px', borderBottom: '1px solid var(--line)',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600,
        }}>{title}</span>
        <span style={{
          marginLeft: 'auto',
          fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-4)',
        }}>{count}</span>
      </div>
      {isEmpty ? <div style={{ ...QUIET, padding: '10px 4px' }}>{empty}</div> : children}
    </section>
  );
}

function GroupLabel({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.1em',
      textTransform: 'uppercase', color: 'var(--ink-4)', padding: '6px 4px 0',
    }}>{children}</div>
  );
}

function Row({ icon, title, meta, badge, onClick }) {
  return (
    <CardRow
      as="div"
      onActivate={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px' }}
    >
      <span aria-hidden style={{ color: 'var(--ink-4)', display: 'inline-flex', flexShrink: 0, alignItems: 'center' }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="s-h3" style={{
          color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{title}</span>
        {meta && <span style={{ ...QUIET, fontSize: 11.5 }}>{meta}</span>}
      </span>
      {badge}
    </CardRow>
  );
}

function LiveDot() {
  return (
    <span
      className="pulse-dot"
      title="Running now"
      style={{
        display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
        background: 'var(--accent, #5d9287)',
        boxShadow: '0 0 0 2px rgba(93,146,135,0.18)',
      }}
    />
  );
}

export default function MissionControlView({
  tasks = [],
  onSelectTask,
  onNavigate,
  agentLabel = 'Anton',
  // Composer wiring — same props HomeView passes; the board's composer
  // submits into the existing new-task flow (App's handleSendFromHome).
  onSend,
  project,
  onProjectChange,
  model,
  onModelChange,
  projects,
  models,
  attachments,
  connectors,
  onNavigateToConnectors,
  onAttachFiles,
  onAddGoogleDriveFiles,
  onRemoveAttachment,
  disabledConnections,
  onUpdateConnectorMute,
  onCreateProject,
}) {
  const { needsYou, running, scheduled, shipped, expired, loading } = useBoard({ tasks });

  const n = needsYou.length;
  const headline = n === 0
    ? `Nothing needs you. ${agentLabel} has the rest.`
    : n === 1
      ? `1 thing needs you. ${agentLabel} has the rest.`
      : `${n} things need you. ${agentLabel} has the rest.`;

  const shippedCount = shipped.today.length + shipped.older.length;

  const shippedRow = (a) => (
    <Row
      key={a.id}
      icon={Ico.check(13)}
      title={approvalTitle(a)}
      meta={`${a.status === 'edited' ? 'Edited & sent' : 'Approved'} · ${relativeAge(a.resolvedAt || a.createdAt) || 'just now'}`}
      onClick={() => a.conversationId && onSelectTask?.(a.conversationId)}
    />
  );

  return (
    <div className="scroll-clean" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {/* Masthead — PageHeader rhythm (28/32/20), headline left, composer right. */}
      <div style={{
        padding: '28px 32px 20px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 24, flexWrap: 'wrap',
      }}>
        <h1 className="s-h1" style={{ margin: 0, color: 'var(--ink)', flex: '1 1 300px', minWidth: 240 }}>
          {headline}
        </h1>
        <div style={{ flex: '0 1 440px', minWidth: 280 }}>
          <Composer
            onSend={onSend}
            project={project}
            onProjectChange={onProjectChange}
            model={model}
            onModelChange={onModelChange}
            projects={projects}
            models={models}
            attachments={attachments}
            connectors={connectors}
            onNavigateToConnectors={onNavigateToConnectors}
            onAttachFiles={onAttachFiles}
            onAddGoogleDriveFiles={onAddGoogleDriveFiles}
            onRemoveAttachment={onRemoveAttachment}
            disabledConnections={disabledConnections}
            onUpdateConnectorMute={onUpdateConnectorMute}
            onCreateProject={onCreateProject}
            hideModel
          />
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48, color: 'var(--ink-4)' }}>
          <Spinner />
        </div>
      ) : (
        <div style={{
          padding: '0 32px 32px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: 20,
          alignItems: 'start',
        }}>
          <Column title="Needs You" count={n} isEmpty={n === 0 && expired.length === 0} empty="Work waiting on you">
            {needsYou.map((a) => (
              <Row
                key={a.id}
                icon={a.kind === 'auth' ? Ico.key(13) : Ico.sparkle(13)}
                title={approvalTitle(a)}
                meta={`${a.kind === 'auth' ? 'Sign-in' : 'Action'} · ${relativeAge(a.createdAt) || 'just now'}`}
                badge={<Badge variant="accent" size="sm">Needs you</Badge>}
                onClick={() => a.conversationId && onSelectTask?.(a.conversationId)}
              />
            ))}
            {expired.length > 0 && (
              <div style={{
                ...QUIET, fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 7,
                            padding: '9px 10px',
              }}>
                <span aria-hidden style={{ display: 'inline-flex', color: 'var(--ink-4)' }}>{Ico.clock(12)}</span>
                {expired.length} approval{expired.length === 1 ? '' : 's'} expired while you were away
              </div>
            )}
          </Column>

          <Column title="Running" count={running.length} isEmpty={running.length === 0} empty={`${agentLabel}'s work in progress`}>
            {running.map((r) => (
              <Row
                key={r.conversationId}
                icon={<LiveDot />}
                title={r.topic}
                meta={`Started ${relativeAge(r.startedAt) || 'just now'}`}
                onClick={() => onSelectTask?.(r.conversationId)}
              />
            ))}
          </Column>

          <Column title="Scheduled" count={scheduled.length} isEmpty={scheduled.length === 0} empty="Nothing scheduled">
            {scheduled.map((s) => (
              <Row
                key={s.id}
                icon={Ico.clock(13)}
                title={s.title || 'Untitled schedule'}
                meta={s.enabled
                  ? `${cadenceLabel(s.cadence)} · Next ${relativeTime(s.nextRunAt || s.next_run_at) ?? '—'}`
                  : cadenceLabel(s.cadence)}
                badge={!s.enabled ? <Badge size="sm" variant="muted">Paused</Badge> : undefined}
                onClick={() => onNavigate?.('scheduled')}
              />
            ))}
          </Column>

          <Column title="Shipped" count={shippedCount} isEmpty={shippedCount === 0} empty="Shipped work lands here">
            {shipped.today.length > 0 && <GroupLabel>Today</GroupLabel>}
            {shipped.today.map(shippedRow)}
            {shipped.older.length > 0 && <GroupLabel>Earlier</GroupLabel>}
            {shipped.older.map(shippedRow)}
          </Column>
        </div>
      )}
    </div>
  );
}
