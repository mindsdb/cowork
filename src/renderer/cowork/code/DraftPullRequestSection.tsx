import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConfirmModal } from '../components/ConfirmModal';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Menu from '../components/ui/Menu';
import Select from '../components/ui/Select';
import { deliveryFixCheckPrompt } from './deliveryAutomation';
import { SafeCodeExternalLink } from './SafeCodeExternalLink';
import {
  codingApi,
  type DeliveryPlan,
  type DeliveryAutomationPolicy,
  type DeliveryPlanItem,
  type DeliveryRecord,
  type ProjectConnection,
  type PullRequestCheck,
  type PullRequestFeedback,
  type PullRequestStatus,
} from './api';

export interface DraftPullRequestInput {
  folder_id: string;
  title: string;
  body: string;
}

const NO_CONNECTIONS: ProjectConnection[] = [];
const REFRESH_INTERVAL_MS = 30_000;
const DEFAULT_DELIVERY_POLICY: DeliveryAutomationPolicy = {
  fix_failing_checks: false,
  mark_ready_when_passing: false,
  merge_when_approved: false,
  complete_source_after_merge: false,
  archive_after_merge: false,
  max_fix_attempts: 2,
};

function statusLabel(status: PullRequestStatus): string {
  if (status.state === 'merged') return 'Merged';
  if (status.state === 'closed') return 'Closed';
  if (status.state === 'draft') return 'Draft';
  if (status.review_state === 'changes_requested') return 'Changes requested';
  if (status.ci_state === 'failing') return 'Checks failing';
  if (status.review_state === 'approved' && status.ci_state === 'passing') return 'Ready to merge';
  if (status.ci_state === 'pending') return 'Checks running';
  return 'Open';
}

function itemStatus(item: DeliveryPlanItem): string {
  if (item.status === 'needs_commit') return 'Commit required';
  if (item.status === 'no_changes') return 'No changes';
  if (item.status === 'ready') return `Ready for ${item.base_branch || 'base branch'}`;
  if (item.status === 'published') return statusLabel(item.pull_request_status || {
    state: 'draft', review_state: 'none', ci_state: 'none', detail: '',
  });
  return item.detail || 'Unavailable';
}

function timestamp(value?: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '' : parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fixFeedbackPrompt(item: DeliveryPlanItem, feedback: PullRequestFeedback): string {
  const location = feedback.path ? `${feedback.path}${feedback.line ? `:${feedback.line}` : ''}` : 'the pull request';
  return `Address this review thread on ${item.external_url}: “${feedback.body || feedback.state}” (${location}). Inspect the surrounding code, make the appropriate change in this isolated task workspace, run the relevant verification, and explain the resolution. Do not resolve the thread, publish, or merge anything.`;
}

function PullRequestDetails({
  item,
  busy,
  onAgentAction,
  onAction,
}: {
  item: DeliveryPlanItem;
  busy: boolean;
  onAgentAction: (prompt: string) => Promise<void>;
  onAction: (item: DeliveryPlanItem, action: 'ready' | 'merge' | 'resolve_thread', threadId?: string) => void;
}) {
  const status = item.pull_request_status;
  if (!item.external_url) return null;
  const failingChecks = status?.checks?.filter((check) => check.state === 'failing') || [];
  const activeFeedback = status?.feedback?.filter((feedback) => !feedback.resolved) || [];
  return (
    <article className="code-pr-card">
      <header>
        <SafeCodeExternalLink value={item.external_url}>
          {item.folder_name}{status?.number ? ` #${status.number}` : ''}
        </SafeCodeExternalLink>
        <span data-state={status?.state || 'draft'}>{status ? statusLabel(status) : 'Draft created'}</span>
      </header>
      {status?.title && <div className="code-pr-card__title">{status.title}</div>}
      <div className="code-pr-card__meta">
        {status?.review_state !== 'none' && <span>{status?.review_state === 'approved' ? 'Review approved' : status?.review_state === 'changes_requested' ? 'Changes requested' : 'Review pending'}</span>}
        {status?.ci_state !== 'none' && <span>{status?.ci_state === 'passing' ? 'Checks passing' : status?.ci_state === 'failing' ? 'Checks failing' : 'Checks running'}</span>}
        {timestamp(status?.updated_at) && <span>Updated {timestamp(status?.updated_at)}</span>}
      </div>
      {!!status?.checks?.length && (
        <details className="code-pr-details">
          <summary>Checks <span>{status.checks.length}</span></summary>
          <div>{status.checks.map((check) => (
            <article className="code-pr-detail-item" key={`${check.id || check.name}:${check.url}`} data-state={check.state}>
              <div>
                <SafeCodeExternalLink value={check.url}>{check.name}</SafeCodeExternalLink>
                <small>{check.state}</small>
              </div>
              {check.detail && <p>{check.detail}</p>}
              {!!check.annotations?.length && (
                <ul>{check.annotations.slice(0, 3).map((annotation, index) => (
                  <li key={`${annotation.path}:${annotation.start_line || 0}:${index}`}>
                    <code>{annotation.path}{annotation.start_line ? `:${annotation.start_line}` : ''}</code>
                    <span>{annotation.title || annotation.message}</span>
                  </li>
                ))}</ul>
              )}
              {check.state === 'failing' && <footer><Button size="xs" variant="subtle" disabled={busy} onClick={() => void onAgentAction(deliveryFixCheckPrompt(item, check))}>Fix with agent</Button></footer>}
            </article>
          ))}</div>
        </details>
      )}
      {activeFeedback.length > 0 && (
        <details className="code-pr-details">
          <summary>Review feedback <span>{activeFeedback.length}</span></summary>
          <div>{activeFeedback.map((feedback) => (
            <article className="code-pr-detail-item" key={`${feedback.thread_id || feedback.id}:${feedback.url}`}>
              <div>
                <SafeCodeExternalLink value={feedback.url}>{feedback.author || 'Reviewer'}</SafeCodeExternalLink>
                <small>{feedback.path}{feedback.line ? `:${feedback.line}` : ''}</small>
              </div>
              <p>{feedback.body || feedback.state}</p>
              <footer>
                <Button size="xs" variant="subtle" disabled={busy} onClick={() => void onAgentAction(fixFeedbackPrompt(item, feedback))}>Fix with agent</Button>
                {feedback.thread_id && <Button size="xs" variant="subtle" disabled={busy} onClick={() => onAction(item, 'resolve_thread', feedback.thread_id)}>Resolve</Button>}
              </footer>
            </article>
          ))}</div>
        </details>
      )}
      {(item.status_error || status?.detail) && <div className="code-pr-card__notice">{item.status_error || status?.detail}</div>}
      <footer>
        {status?.state === 'draft' && <Button size="sm" variant="subtle" disabled={busy} onClick={() => onAction(item, 'ready')}>Mark ready</Button>}
        {status?.review_state === 'changes_requested' && activeFeedback.length === 0 && <Button size="sm" variant="subtle" disabled={busy} onClick={() => void onAgentAction(`Address the unresolved review feedback on ${item.external_url}. Inspect the review on GitHub, make the appropriate changes in this isolated task workspace, run the relevant checks, and summarize what changed. Do not publish or merge anything.`)}>Address feedback</Button>}
        {status?.ci_state === 'failing' && failingChecks.length === 0 && <Button size="sm" variant="subtle" disabled={busy} onClick={() => void onAgentAction(`Fix the failing GitHub checks on ${item.external_url}. Inspect the check details on GitHub, reproduce the failures locally where possible, make the smallest correct changes in this isolated task workspace, and rerun verification. Do not publish or merge anything.`)}>Fix checks</Button>}
        {status?.state === 'open' && status.review_state === 'approved' && status.ci_state === 'passing' && <Button size="sm" variant="primary" disabled={busy} onClick={() => onAction(item, 'merge')}>Merge</Button>}
      </footer>
    </article>
  );
}

export function DraftPullRequestSection({
  sessionId,
  taskTitle,
  busy,
  refreshKey,
  onCreate,
  onCommit,
  onOpenProjectSettings,
  onAgentAction,
  onPullRequestAction,
  deliveryPolicy = DEFAULT_DELIVERY_POLICY,
  onDeliveryPolicyChange = async () => {},
  onArchive,
  connections = NO_CONNECTIONS,
}: {
  sessionId: string;
  taskTitle: string;
  busy: boolean;
  refreshKey: string;
  onCreate: (title: string, body: string, connectionName: string | null, drafts: DraftPullRequestInput[]) => Promise<DeliveryRecord[]>;
  onCommit: (message: string) => Promise<void>;
  onOpenProjectSettings: () => void;
  onAgentAction: (prompt: string) => Promise<void>;
  onPullRequestAction: (item: DeliveryPlanItem, action: 'ready' | 'merge' | 'resolve_thread', threadId?: string) => Promise<void>;
  deliveryPolicy?: DeliveryAutomationPolicy;
  onDeliveryPolicyChange?: (policy: DeliveryAutomationPolicy) => Promise<void>;
  onArchive: () => Promise<void>;
  connections?: ProjectConnection[];
}) {
  const [plan, setPlan] = useState<DeliveryPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState(taskTitle);
  const [body, setBody] = useState('');
  const [commitMessage, setCommitMessage] = useState(taskTitle);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, { title: string; body: string }>>({});
  const [error, setError] = useState('');
  const [lastAttempt, setLastAttempt] = useState<DeliveryRecord[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ item: DeliveryPlanItem; action: 'ready' | 'merge' | 'resolve_thread'; threadId?: string } | null>(null);
  const [policy, setPolicy] = useState(deliveryPolicy);
  const requestGeneration = useRef(0);
  const githubConnections = useMemo(() => connections.filter((item) => item.provider === 'github'), [connections]);
  const githubStatuses = useMemo(
    () => plan?.integrations?.filter((item) => item.provider === 'github') || [],
    [plan?.integrations],
  );
  const usableGithubConnections = useMemo(() => {
    if (!githubStatuses.length) return githubConnections;
    const connectedNames = new Set(
      githubStatuses.filter((item) => item.status === 'connected').map((item) => item.connection_name),
    );
    return githubConnections.filter((item) => connectedNames.has(item.name));
  }, [githubConnections, githubStatuses]);
  const [connectionName, setConnectionName] = useState(githubConnections[0]?.name || '');
  const automationOptions = [
    ['fix_failing_checks', 'Fix failing checks', `Up to ${policy.max_fix_attempts} agent attempts per failure`],
    ['mark_ready_when_passing', 'Mark ready', 'After checks pass'],
    ['merge_when_approved', 'Merge', 'After approval and checks'],
    ['complete_source_after_merge', 'Complete linked issues', 'After final updates and all merges'],
    ['archive_after_merge', 'Archive task', 'After all merges'],
  ] as const;
  const toggleAutomation = (key: typeof automationOptions[number][0]) => {
    const previous = policy;
    const next = { ...policy, [key]: !policy[key] };
    setPolicy(next);
    void onDeliveryPolicyChange(next).catch(() => setPolicy(previous));
  };

  const load = useCallback(async (quiet = false) => {
    const generation = ++requestGeneration.current;
    if (!quiet) setLoading(true);
    try {
      const next = await codingApi.deliveryPlan(sessionId);
      if (requestGeneration.current !== generation) return;
      setPlan(next);
      setError('');
      const readyIds = next.items.filter((item) => item.status === 'ready').map((item) => item.folder_id);
      setSelectedFolders((current) => current.length ? current.filter((id) => readyIds.includes(id)) : readyIds);
    } catch (reason) {
      if (requestGeneration.current !== generation) return;
      setError(reason instanceof Error ? reason.message : 'Could not prepare GitHub delivery.');
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => {
    setTitle(taskTitle);
    setCommitMessage(taskTitle);
    setBody('');
    setOverrides({});
    setLastAttempt([]);
    setConfirmOpen(false);
    setPendingAction(null);
  }, [sessionId, taskTitle]);
  useEffect(() => setPolicy(deliveryPolicy), [deliveryPolicy]);
  useEffect(() => {
    if (!usableGithubConnections.some((item) => item.name === connectionName)) {
      setConnectionName(usableGithubConnections[0]?.name || '');
    }
  }, [connectionName, usableGithubConnections]);
  const hasPublishedPullRequests = !!plan?.items.some((item) => item.status === 'published');
  useEffect(() => {
    if (!hasPublishedPullRequests) return undefined;
    const refresh = () => { if (document.visibilityState === 'visible') void load(true); };
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [hasPublishedPullRequests, load]);

  if (!loading && !plan?.items.length && !error) return null;
  const items = plan?.items || [];
  const ready = items.filter((item) => item.status === 'ready');
  const needsCommit = items.filter((item) => item.status === 'needs_commit');
  const published = items.filter((item) => item.status === 'published');
  const unavailable = items.filter((item) => item.status === 'unavailable');
  const connectedGithub = githubStatuses.length
    ? githubStatuses.some((item) => item.status === 'connected')
    : githubConnections.length > 0;
  const selectedReady = ready.filter((item) => selectedFolders.includes(item.folder_id));
  const failures = lastAttempt.filter((item) => item.status === 'failed');
  const successes = lastAttempt.filter((item) => item.status === 'published');
  const allMerged = published.length > 0 && published.every((item) => item.pull_request_status?.state === 'merged');
  const blockerCount = (connectedGithub ? 0 : 1) + needsCommit.length + unavailable.length;

  return (
    <section className="code-finish-github" aria-label="Finish with GitHub">
      <header className="code-finish-github__header">
        <div><strong>Finish with GitHub</strong><span>{published.length ? `${published.length} published` : blockerCount ? `${blockerCount} ${blockerCount === 1 ? 'item' : 'items'} to resolve` : `${ready.length} ready`}</span></div>
        <div className="code-delivery-header-actions">
          <Menu
            trigger={<Button size="sm" variant="subtle" disabled={busy}>Automation</Button>}
            ariaLabel="Delivery automation"
            width={264}
            side="bottom"
            align="end"
            items={[
              { id: 'heading', heading: <span className="code-delivery-policy-heading">Automation</span> },
              ...automationOptions.map(([key, label, hint]) => ({
                id: key,
                keepOpen: true,
                icon: <span className={`code-delivery-policy-check${policy[key] ? ' is-checked' : ''}`}>{policy[key] ? Ico.check(10) : null}</span>,
                label: <span className="code-delivery-policy-label"><b>{label}</b><small>{hint}</small></span>,
                onClick: () => toggleAutomation(key),
              })),
            ]}
          />
          <Button icon size="sm" variant="subtle" aria-label="Refresh pull requests" disabled={loading} onClick={() => void load()}>{loading ? '…' : Ico.refresh(13)}</Button>
        </div>
      </header>

      {error && <div className="code-delivery__error" role="alert">{error}</div>}
      {lastAttempt.length > 0 && (
        <div className={`code-delivery-attempt${failures.length ? ' has-failures' : ''}`}>
          <span>{successes.length ? `${successes.length} created` : ''}{successes.length && failures.length ? ' · ' : ''}{failures.length ? `${failures.length} failed` : ''}</span>
          {failures.length > 0 && <small>Resolve the affected repository and retry; successful drafts will not be recreated.</small>}
        </div>
      )}

      {published.map((item) => (
        <PullRequestDetails
          key={item.folder_id}
          item={item}
          busy={busy}
          onAgentAction={onAgentAction}
          onAction={(target, action, threadId) => setPendingAction({ item: target, action, threadId })}
        />
      ))}

      {allMerged && <div className="code-finish-complete"><span>All pull requests are merged.</span><Button size="sm" variant="subtle" disabled={busy} onClick={() => void onArchive()}>Archive task</Button></div>}

      <ol className="code-delivery-readiness">
        <li data-state={connectedGithub ? 'ready' : 'blocked'}>
          <span>GitHub account</span>
          <small>{connectedGithub ? 'Connected to this project' : 'Add an account to this project'}</small>
          {!connectedGithub && <Button size="sm" variant="subtle" onClick={onOpenProjectSettings}>Add GitHub</Button>}
        </li>
        {items.filter((item) => item.status !== 'published').map((item) => (
          <li key={item.folder_id} data-state={item.status === 'ready' || item.status === 'no_changes' ? 'ready' : 'blocked'}>
            <span>{item.folder_name}</span><small>{itemStatus(item)}</small>
          </li>
        ))}
      </ol>

      {needsCommit.length > 0 && (
        <div className="code-delivery-resolve">
          <Input value={commitMessage} onChange={setCommitMessage} placeholder="Commit message" disabled={busy} />
          <Button size="sm" variant="subtle" disabled={busy || !commitMessage.trim()} onClick={async () => {
            await onCommit(commitMessage.trim());
            await load();
          }}>Commit {needsCommit.length} {needsCommit.length === 1 ? 'repository' : 'repositories'}</Button>
        </div>
      )}

      {ready.length > 0 && connectedGithub && (
        <div className="code-delivery-compose">
          {usableGithubConnections.length > 1 && (
            <Select value={connectionName} onValueChange={setConnectionName} options={usableGithubConnections.map((item) => ({ value: item.name, label: item.label || item.name }))} size="sm" ariaLabel="GitHub account" />
          )}
          <Input value={title} onChange={setTitle} placeholder="Pull request title" disabled={busy} />
          <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Optional context for reviewers…" rows={3} disabled={busy} />
          {ready.length > 1 && (
            <details className="code-delivery-repositories">
              <summary>Repositories <span>{selectedReady.length} of {ready.length}</span></summary>
              <div>{ready.map((item) => {
                const selected = selectedFolders.includes(item.folder_id);
                const override = overrides[item.folder_id] || { title, body };
                return (
                  <div className="code-delivery-repository" key={item.folder_id}>
                    <label><input type="checkbox" checked={selected} onChange={() => setSelectedFolders((current) => selected ? current.filter((id) => id !== item.folder_id) : [...current, item.folder_id])} /><span><strong>{item.folder_name}</strong><small>into {item.base_branch}</small></span></label>
                    {selected && <details><summary>Edit title or context</summary><div><Input value={override.title} onChange={(value) => setOverrides((current) => ({ ...current, [item.folder_id]: { ...override, title: value } }))} /><textarea value={override.body} onChange={(event) => setOverrides((current) => ({ ...current, [item.folder_id]: { ...override, body: event.target.value } }))} rows={2} /></div></details>}
                  </div>
                );
              })}</div>
            </details>
          )}
          <Button size="sm" variant="primary" disabled={busy || !title.trim() || !connectionName || selectedReady.length === 0} onClick={() => setConfirmOpen(true)}>
            Create {selectedReady.length} draft pull request{selectedReady.length === 1 ? '' : 's'}
          </Button>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title={`Create ${selectedReady.length} draft pull request${selectedReady.length === 1 ? '' : 's'}?`}
        message="This pushes the selected task branches, then creates drafts in the order shown. Existing drafts are left unchanged."
        confirmLabel="Create drafts"
        busy={busy}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        onConfirm={async () => {
          const drafts = selectedReady.map((item) => ({
            folder_id: item.folder_id,
            title: overrides[item.folder_id]?.title || title.trim(),
            body: overrides[item.folder_id]?.body ?? body.trim(),
          }));
          const records = await onCreate(title.trim(), body.trim(), connectionName || null, drafts);
          setLastAttempt(records);
          setConfirmOpen(false);
          await load();
        }}
      />
      <ConfirmModal
        open={pendingAction !== null}
        title={pendingAction?.action === 'merge'
          ? `Merge ${pendingAction.item.folder_name}?`
          : pendingAction?.action === 'resolve_thread'
            ? 'Resolve this review thread?'
            : `Mark ${pendingAction?.item.folder_name || 'pull request'} ready?`}
        message={pendingAction?.action === 'merge'
          ? 'GitHub will merge this pull request using the repository’s default merge method. This cannot be undone here.'
          : pendingAction?.action === 'resolve_thread'
            ? 'Mark this GitHub review conversation as resolved. The thread stays visible in GitHub history.'
            : 'This removes draft status and requests review on GitHub.'}
        confirmLabel={pendingAction?.action === 'merge' ? 'Merge pull request' : pendingAction?.action === 'resolve_thread' ? 'Resolve thread' : 'Mark ready'}
        busy={busy}
        onClose={() => { if (!busy) setPendingAction(null); }}
        onConfirm={async () => {
          if (!pendingAction) return;
          if (pendingAction.threadId) {
            await onPullRequestAction(pendingAction.item, pendingAction.action, pendingAction.threadId);
          } else {
            await onPullRequestAction(pendingAction.item, pendingAction.action);
          }
          setPendingAction(null);
          await load();
        }}
      />
    </section>
  );
}
