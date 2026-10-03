import Ico from '../components/Icons';
import type { ActionSpec } from '../components/ui/ActionBar';
import type { ApprovalDecision, PendingApproval } from './api';
import { DecisionTray, isTrayShortcut } from './DecisionTray';
import { compactPath } from './presentation';


const KINDS: Record<string, { label: string; question: string; icon: () => React.ReactNode }> = {
  command: { label: 'Terminal', question: 'Run this command?', icon: () => Ico.code(12) },
  file_change: { label: 'File change', question: 'Modify protected files?', icon: () => Ico.edit(12) },
  network_or_permission: { label: 'Access', question: 'Grant additional access?', icon: () => Ico.globe(12) },
  elevated_action: { label: 'Elevated access', question: 'Approve elevated action?', icon: () => Ico.lock(12) },
};


/**
 * Three answers of rising commitment, all visible: Deny (ghost, Escape),
 * Always allow (outlined, only when the engine offers a session amendment),
 * Allow once (filled, Enter).
 */
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
  const deny: ActionSpec = { label: 'Deny', disabled: busy, shortcut: 'Escape', onClick: () => decide('deny') };
  const always: ActionSpec | null = approval.allow_session
    ? { label: 'Always allow', disabled: busy, tooltip: 'Allow this now, and similar commands for the rest of this task', onClick: () => decide('approve_session') }
    : null;
  return (
    <DecisionTray
      label="Approval required"
      kind={kind?.label || 'Approval'}
      icon={kind?.icon() || Ico.lock(12)}
      aside={approval.cwd && <span className="code-decision-tray__aside" title={approval.cwd}>{compactPath(approval.cwd)}</span>}
      actions={{
        leading: approval.risk && <p className="code-decision-tray__note" title={approval.risk}>{approval.risk}</p>,
        tertiary: always && deny,
        secondary: always || deny,
        primary: { label: 'Allow once', disabled: busy, shortcut: 'Enter', onClick: () => decide('approve_once') },
      }}
      onKeyDown={(event) => {
        if (isTrayShortcut(event, 'Escape')) { event.preventDefault(); decide('deny'); }
        // A focused button already answers Enter with its own click.
        else if (isTrayShortcut(event, 'Enter') && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); decide('approve_once'); }
      }}
    >
      <h2 className="code-decision-tray__question">{kind?.question || approval.title || 'The agent needs approval'}</h2>
      {approval.detail && <pre className="code-decision-tray__detail">{approval.detail}</pre>}
    </DecisionTray>
  );
}
