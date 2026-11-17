import Ico from '../components/Icons';
import type { ActionSpec } from '../components/ui/ActionBar';
import type { ApprovalDecision, PendingApproval } from './api';
import { DecisionTray, isTrayShortcut } from './DecisionTray';
import { compactPath } from './presentation';
import { useTranslation } from '../../lib/i18n';


// Labels and questions live in the `code` catalog under approval.kinds.<key>.
const KINDS: Record<string, { key: string; icon: () => React.ReactNode }> = {
  command: { key: 'command', icon: () => Ico.code(12) },
  file_change: { key: 'fileChange', icon: () => Ico.edit(12) },
  network_or_permission: { key: 'network', icon: () => Ico.globe(12) },
  elevated_action: { key: 'elevated', icon: () => Ico.lock(12) },
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
  const { t } = useTranslation('code');
  const kind = KINDS[approval.kind];
  const decide = (decision: ApprovalDecision) => { if (!busy) onDecision(decision); };
  const deny: ActionSpec = { label: t('approval.deny'), disabled: busy, shortcut: 'Escape', onClick: () => decide('deny') };
  const always: ActionSpec | null = approval.allow_session
    ? { label: t('approval.alwaysAllow'), disabled: busy, tooltip: t('approval.alwaysAllowTooltip'), onClick: () => decide('approve_session') }
    : null;
  return (
    <DecisionTray
      label={t('approval.label')}
      kind={kind ? t(`approval.kinds.${kind.key}.label`) : t('approval.kind')}
      icon={kind?.icon() || Ico.lock(12)}
      aside={approval.cwd && <span className="code-decision-tray__aside" title={approval.cwd}>{compactPath(approval.cwd)}</span>}
      actions={{
        leading: approval.risk && <p className="code-decision-tray__note" title={approval.risk}>{approval.risk}</p>,
        tertiary: always && deny,
        secondary: always || deny,
        primary: { label: t('approval.allowOnce'), disabled: busy, shortcut: 'Enter', onClick: () => decide('approve_once') },
      }}
      onKeyDown={(event) => {
        if (isTrayShortcut(event, 'Escape')) { event.preventDefault(); decide('deny'); }
        // A focused button already answers Enter with its own click.
        else if (isTrayShortcut(event, 'Enter') && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); decide('approve_once'); }
      }}
    >
      <h2 className="code-decision-tray__question">{(kind && t(`approval.kinds.${kind.key}.question`)) || approval.title || t('approval.fallbackQuestion')}</h2>
      {approval.detail && <pre className="code-decision-tray__detail">{approval.detail}</pre>}
    </DecisionTray>
  );
}
