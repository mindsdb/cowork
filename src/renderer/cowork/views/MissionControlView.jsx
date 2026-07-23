// `<MissionControlView>` — the approvals-driven supervision board.
//
// Four quiet columns composed by `useBoard`:
//   Needs You  pending approvals as live ApprovalCards (approve/edit/skip
//              inline, exactly like the cards in the chat transcript)
//   Running    in-flight conversations w/ a live dot + started-at; each row
//              offers a "Peek" slide-over with a read-only transcript
//   Scheduled  digest schedules (drill into the scheduled view)
//   Shipped    recently resolved approvals, today vs earlier, receipt-aware
//
// The headline counts only the Needs-You column — that's the one the user
// must act on; everything else is Anton's side of the fence. Top-right is
// the standard Composer wired into the same new-task flow HomeView uses.
//
// No new design here: PageHeader rhythm for the masthead, CardRow for the
// column rows, Badge for statuses, CSS-var tokens throughout.

import { useEffect, useState } from 'react';
import Ico from '../components/Icons';
import Composer from '../components/Composer';
import ApprovalCard from '../components/ApprovalCard';
import { Button, CardRow, Spinner } from '../components/ui';
import Badge from '../components/ui/Badge';
import { useBoard } from '../components/board/useBoard';
import { fetchSession, openArtifact } from '../api';
import { relativeAge, relativeTime } from '../lib/formatTime';
import { host } from '../../platform/host';

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

// ─── Shipped receipts ──────────────────────────────────────────────────────
// Receipts today are mostly `{executed, resolved_at}` — nothing worth
// quoting, so the honest fallback is "Approved · <relative time>". When a
// receipt carries a summary-ish field (result.summary / error) we show it;
// when it references an artifact we surface it as a real "open" affordance.

function receiptSummary(a) {
  const r = a?.receipt;
  if (!r || typeof r !== 'object') return null;
  const summary = r.result?.summary || r.error || null;
  return summary ? String(summary) : null;
}

function receiptArtifactRef(a) {
  const r = a?.receipt;
  if (!r || typeof r !== 'object') return null;
  return r.artifact || r.artifactPath || r.artifact_path || r.result?.artifact || null;
}

function artifactName(ref) {
  const s = String(ref || '');
  return s.split('/').filter(Boolean).pop() || s;
}

function ShippedRow({ approval: a, onClick }) {
  const rel = relativeAge(a.resolvedAt || a.createdAt) || 'just now';
  const summary = receiptSummary(a);
  const artifactRef = receiptArtifactRef(a);
  return (
    <CardRow
      as="div"
      onActivate={onClick}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px' }}
    >
      <span aria-hidden style={{ color: 'var(--ink-4)', display: 'inline-flex', flexShrink: 0, marginTop: 2 }}>{Ico.check(13)}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="s-h3" style={{
          color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{approvalTitle(a)}</span>
        <span style={{ ...QUIET, fontSize: 11.5 }}>
          {summary || `${a.status === 'edited' ? 'Edited & sent' : 'Approved'} · ${rel}`}
        </span>
        {artifactRef && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openArtifact(String(artifactRef)).catch(() => {}); }}
            title={String(artifactRef)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
              background: 'none', border: 0, padding: 0, cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'var(--accent)',
            }}
          >
            <span aria-hidden style={{ display: 'inline-flex' }}>{Ico.externalLink(11)}</span>
            {artifactName(artifactRef)}
          </button>
        )}
      </span>
    </CardRow>
  );
}

// ─── Peek slide-over ───────────────────────────────────────────────────────
// Read-only transcript for a running conversation — role + text, no composer.
// Slides over the right edge (~420px) without leaving the board; Esc or the
// close button dismisses. "Watch live" hands off to the embedded browser
// (Electron-only — the web shell has no browser surface).

function PeekPanel({ conversationId, topic, agentLabel = 'Anton', onClose, onWatchLive }) {
  const [messages, setMessages] = useState(null); // null = loading

  useEffect(() => {
    let alive = true;
    setMessages(null);
    fetchSession(conversationId)
      .then((s) => { if (alive) setMessages(Array.isArray(s?.messages) ? s.messages : []); })
      .catch(() => { if (alive) setMessages([]); });
    return () => { alive = false; };
  }, [conversationId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const visible = (messages || []).filter(
    (m) => m && (m.role === 'user' || m.role === 'assistant')
      && typeof m.content === 'string' && m.content.trim(),
  );

  return (
    <aside
      aria-label={`Peek — ${topic}`}
      style={{
        position: 'fixed', top: 9, right: 9, bottom: 9, zIndex: 120,
        width: 420, maxWidth: 'calc(100vw - 48px)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', border: '1px solid var(--line)',
        borderRadius: 14, boxShadow: 'var(--sh-2)',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="s-h3" style={{
            color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{topic}</div>
          <div style={{ ...QUIET, fontSize: 11.5, marginTop: 2 }}>Read-only peek — open the task to reply</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close peek" title="Close">
          {Ico.close(13)}
        </button>
      </div>

      <div className="scroll-clean" style={{
        flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {messages === null ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24, color: 'var(--ink-4)' }}>
            <Spinner />
          </div>
        ) : visible.length === 0 ? (
          <div style={{ ...QUIET, padding: '10px 0' }}>No messages yet — the turn just started.</div>
        ) : (
          visible.map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600,
              }}>{m.role === 'user' ? 'You' : agentLabel}</span>
              <div style={{
                fontFamily: 'var(--font-body)', fontSize: 12.5, lineHeight: 1.55,
                color: 'var(--ink-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>{m.content}</div>
            </div>
          ))
        )}
      </div>

      {host.isElectron && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 16px', borderTop: '1px solid var(--line)', flexShrink: 0,
        }}>
          <Button size="sm" variant="subtle" onClick={onWatchLive}>
            <span aria-hidden style={{ display: 'inline-flex', marginRight: 6 }}>{Ico.globe(12)}</span>
            Watch live
          </Button>
        </div>
      )}
    </aside>
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
  const { needsYou, running, scheduled, shipped, expired, metrics, loading } = useBoard({ tasks });
  // Which running conversation (if any) the Peek slide-over is showing.
  const [peekId, setPeekId] = useState(null);

  const n = needsYou.length;
  const headline = n === 0
    ? `Nothing needs you. ${agentLabel} has the rest.`
    : n === 1
      ? `1 thing needs you. ${agentLabel} has the rest.`
      : `${n} things need you. ${agentLabel} has the rest.`;

  const shippedCount = shipped.today.length + shipped.older.length;

  // Auth approvals hand their browser tab to the user — same wiring as the
  // chat transcript's StepApprovals.
  const openApprovalTab = (tabId) => {
    if (tabId) host.browserActivateTab?.(tabId);
    onNavigate?.('browser');
  };

  const shippedRow = (a) => (
    <ShippedRow
      key={a.id}
      approval={a}
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
        <div style={{ flex: '1 1 300px', minWidth: 240 }}>
          <h1 className="s-h1" style={{ margin: 0, color: 'var(--ink)' }}>
            {headline}
          </h1>
          {/* The claim, measured (M4): quiet readout under the headline —
              shipped vs needs-you, edit/skip quality, median resolve time.
              Hidden when the server has no metrics (old build / down). */}
          {metrics && (metrics.shipped > 0 || metrics.needsYou > 0) && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-4)', display: 'flex', gap: 12, flexWrap: 'wrap' }} data-testid="metrics-row">
              <span>{metrics.shipped} shipped · {metrics.needsYou} needed you{metrics.autonomyRatio != null ? ` (${Math.round(metrics.autonomyRatio * 100)}% autonomous)` : ''}</span>
              {(metrics.editRate > 0 || metrics.skipRate > 0) && (
                <span>{Math.round(metrics.editRate * 100)}% edited · {Math.round(metrics.skipRate * 100)}% skipped</span>
              )}
              {metrics.medianTimeToResolveSeconds != null && (
                <span>resolves in ~{metrics.medianTimeToResolveSeconds < 60
                  ? `${Math.round(metrics.medianTimeToResolveSeconds)}s`
                  : `${Math.round(metrics.medianTimeToResolveSeconds / 60)}m`}</span>
              )}
            </div>
          )}
        </div>
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
              <ApprovalCard key={a.id} approval={a} onOpenTab={openApprovalTab} />
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
                badge={(
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={(e) => { e.stopPropagation(); setPeekId(r.conversationId); }}
                  >
                    Peek
                  </Button>
                )}
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

      {peekId && (
        <PeekPanel
          conversationId={peekId}
          topic={running.find((r) => r.conversationId === peekId)?.topic || 'Conversation'}
          agentLabel={agentLabel}
          onClose={() => setPeekId(null)}
          onWatchLive={() => { setPeekId(null); onNavigate?.('browser'); }}
        />
      )}
    </div>
  );
}
