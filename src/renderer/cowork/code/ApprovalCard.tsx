import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import type { ApprovalDecision, PendingApproval } from './api';
import { compactPath } from './presentation';


export function ApprovalCard({
  approval,
  busy,
  onDecision,
}: {
  approval: PendingApproval;
  busy: boolean;
  onDecision: (decision: ApprovalDecision) => void;
}) {
  return (
    <section className="code-approval" aria-label="Approval required">
      <div className="code-approval__signal">{Ico.lock(14)}</div>
      <div className="code-approval__content">
        <div className="code-approval__eyebrow">YOUR DECISION</div>
        <h2>{approval.title || 'The agent needs approval'}</h2>
        <pre className="code-approval__detail">{approval.detail}</pre>
        <div className="code-approval__context">
          {approval.cwd && <span title={approval.cwd}>{compactPath(approval.cwd)}</span>}
          {approval.risk && <span>{approval.risk}</span>}
        </div>
        <div className="code-approval__actions">
          <Button size="sm" variant="danger" disabled={busy} onClick={() => onDecision('deny')}>Deny</Button>
          {approval.allow_session && (
            <Button size="sm" variant="default" disabled={busy} onClick={() => onDecision('approve_session')}>Allow similar this task</Button>
          )}
          <Button size="sm" variant="primary" disabled={busy} onClick={() => onDecision('approve_once')}>Approve once</Button>
        </div>
      </div>
    </section>
  );
}
