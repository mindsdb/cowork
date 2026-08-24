import { useCallback, useEffect, useMemo, useState } from 'react';

import { ConfirmModal } from '../components/ConfirmModal';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import { host } from '../../platform/host';
import { codingApi, type DeliveryPlan, type DeliveryRecord, type ProjectConnection, type PullRequestStatus } from './api';

const PULL_REQUEST_STATE: Record<PullRequestStatus['state'], string> = {
  draft: 'Draft', open: 'Open', merged: 'Merged', closed: 'Closed',
};
const REVIEW_STATE: Record<PullRequestStatus['review_state'], string> = {
  approved: 'Review approved', changes_requested: 'Changes requested', pending: 'Review pending', none: '',
};
const CI_STATE: Record<PullRequestStatus['ci_state'], string> = {
  passing: 'CI passing', failing: 'CI failing', pending: 'CI running', none: '',
};
const NO_CONNECTIONS: ProjectConnection[] = [];

function pullRequestSummary(item: PullRequestStatus): string {
  return [PULL_REQUEST_STATE[item.state], REVIEW_STATE[item.review_state], CI_STATE[item.ci_state]]
    .filter(Boolean)
    .join(' · ');
}


export function DraftPullRequestSection({
  sessionId,
  taskTitle,
  busy,
  refreshKey,
  onCreate,
  connections = NO_CONNECTIONS,
}: {
  sessionId: string;
  taskTitle: string;
  busy: boolean;
  refreshKey: string;
  onCreate: (title: string, body: string, connectionName: string | null) => Promise<DeliveryRecord[]>;
  connections?: ProjectConnection[];
}) {
  const [plan, setPlan] = useState<DeliveryPlan | null>(null);
  const [title, setTitle] = useState(taskTitle);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const githubConnections = useMemo(
    () => connections.filter((item) => item.provider === 'github'),
    [connections],
  );
  const [connectionName, setConnectionName] = useState(githubConnections[0]?.name || '');

  const load = useCallback(async () => {
    try {
      setPlan(await codingApi.deliveryPlan(sessionId));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not prepare delivery.');
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => { setTitle(taskTitle); setBody(''); setConfirmOpen(false); }, [sessionId, taskTitle]);
  useEffect(() => {
    if (!githubConnections.some((item) => item.name === connectionName)) {
      setConnectionName(githubConnections[0]?.name || '');
    }
  }, [connectionName, githubConnections]);

  if (!plan?.items.length && !error) return null;
  const ready = plan?.items.filter((item) => item.status === 'ready') || [];
  const published = plan?.items.filter((item) => item.status === 'published') || [];
  const summary = published.length
    ? `${published.length} created${ready.length ? ` · ${ready.length} ready` : ''}`
    : ready.length ? `${ready.length} ready` : 'Needs attention';

  return (
    <details className="code-delivery code-draft-prs">
      <summary>Draft pull requests <span className="code-delivery__summary">{summary}</span></summary>
      <div className="code-delivery__body">
        <p>One draft per changed Git folder, in project order.</p>
        {error && <div className="code-delivery__error" role="alert">{error}</div>}
        <ol className="code-delivery-plan">
          {plan?.items.map((item) => (
            <li key={item.folder_id}>
              <span>{item.folder_name}</span>
              {item.external_url ? (
                <div className="code-delivery-plan__published">
                  <button type="button" onClick={() => void host.openExternal(item.external_url!)}>Open draft</button>
                  {item.pull_request_status && <small>{pullRequestSummary(item.pull_request_status)}</small>}
                  {item.pull_request_status?.detail && <small title={item.pull_request_status.detail}>Some status unavailable</small>}
                  {item.status_error && <small title={item.status_error}>Status unavailable</small>}
                </div>
              ) : <small data-status={item.status}>{item.status === 'needs_commit' ? 'Commit changes first' : item.status === 'no_changes' ? 'No changes' : item.status === 'ready' ? 'Ready' : item.detail}</small>}
            </li>
          ))}
        </ol>
        {ready.length > 0 && (
          <div className="code-delivery-compose">
            {githubConnections.length > 1 && (
              <Select
                value={connectionName}
                onValueChange={setConnectionName}
                options={githubConnections.map((item) => ({ value: item.name, label: item.label || item.name }))}
                size="sm"
                ariaLabel="GitHub connection"
              />
            )}
            {githubConnections.length === 0 && <div className="code-delivery__error">Add a GitHub connection in Project settings to create drafts.</div>}
            <Input value={title} onChange={setTitle} placeholder="Pull request title" disabled={busy} />
            <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Optional context for reviewers…" rows={3} disabled={busy} />
            <Button size="sm" variant="primary" disabled={busy || !title.trim() || !connectionName} onClick={() => setConfirmOpen(true)}>
              Create {ready.length} draft pull request{ready.length === 1 ? '' : 's'}
            </Button>
          </div>
        )}
      </div>
      <ConfirmModal
        open={confirmOpen}
        title={`Create ${ready.length} draft pull request${ready.length === 1 ? '' : 's'}?`}
        message="This pushes the task branches to their origin remotes, then creates drafts in the order shown."
        confirmLabel="Create drafts"
        busy={busy}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        onConfirm={async () => {
          try {
            const records = await onCreate(title.trim(), body.trim(), connectionName || null);
            const failure = records.find((item) => item.status === 'failed');
            setError(failure?.detail || '');
            setConfirmOpen(false);
            await load();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not create draft pull requests.');
          }
        }}
      />
    </details>
  );
}
