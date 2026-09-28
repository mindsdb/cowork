import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Kbd from '../components/ui/Kbd';
import Tooltip from '../components/ui/Tooltip';
import type { ApprovalDecision, PendingApproval } from './api';
import { DecisionTray, isTrayShortcut } from './DecisionTray';
import { compactPath } from './presentation';


const KINDS: Record<string, { label: string; question: string; icon: () => React.ReactNode }> = {
  command: { label: 'Terminal', question: 'Run this command?', icon: () => Ico.code(12) },
  file_change: { label: 'File change', question: 'Modify protected files?', icon: () => Ico.edit(12) },
  network_or_permission: { label: 'Access', question: 'Grant additional access?', icon: () => Ico.globe(12) },
  elevated_action: { label: 'Elevated access', question: 'Approve elevated action?', icon: () => Ico.lock(12) },
};


export function ApprovalCard({
  approval,
  busy,
  onDecision,
}: {
  approval: PendingApproval;
  busy: boolean;
  onDecision: (decision: ApprovalDecision) => void;
}) {
  const kind = KINDS[approval.kind];
  const decide = (decision: ApprovalDecision) => { if (!busy) onDecision(decision); };
  return (
    <DecisionTray
      label="Approval required"
      kind={kind?.label || 'Approval'}
      icon={kind?.icon() || Ico.lock(12)}
      onKeyDown={(event) => {
        if (isTrayShortcut(event, 'Escape')) { event.preventDefault(); decide('deny'); }
        // A focused button already answers Enter with its own click.
        else if (isTrayShortcut(event, 'Enter') && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); decide('approve_once'); }
      }}
    >
      <h2 className="code-decision-tray__question">{kind?.question || approval.title || 'The agent needs approval'}</h2>
      {approval.detail && <pre className="code-decision-tray__detail">{approval.detail}</pre>}
      {(approval.cwd || approval.risk) && (
        <div className="code-decision-tray__context">
          {approval.cwd && <span title={approval.cwd}>{compactPath(approval.cwd)}</span>}
          {approval.risk && <span title={approval.risk}>{approval.risk}</span>}
        </div>
      )}
      <div className="code-decision-tray__actions">
        <Button size="sm" variant="subtle" disabled={busy} aria-keyshortcuts="Escape" onClick={() => decide('deny')}>
          Deny <Kbd aria-hidden="true">Esc</Kbd>
        </Button>
        <span className="code-decision-tray__spacer" aria-hidden="true" />
        {approval.allow_session && (
          <Tooltip content="Allow this now, and similar commands for the rest of this task">
            <Button size="sm" variant="default" disabled={busy} onClick={() => decide('approve_session')}>Always allow</Button>
          </Tooltip>
        )}
        <Button size="sm" variant="primary" disabled={busy} aria-keyshortcuts="Enter" onClick={() => decide('approve_once')}>
          Allow once <Kbd aria-hidden="true">⏎</Kbd>
        </Button>
      </div>
    </DecisionTray>
  );
}
