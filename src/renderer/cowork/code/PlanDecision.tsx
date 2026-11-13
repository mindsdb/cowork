import { useState } from 'react';
import Ico from '../components/Icons';
import { Textarea } from '../components/ui/Input';
import { DecisionTray, isTrayShortcut } from './DecisionTray';
import { useTranslation } from '../../lib/i18n';

export function PlanDecision({ busy, onBuild, onRevise }: {
  busy: boolean;
  onBuild: () => Promise<void>;
  onRevise: (changes: string) => Promise<void>;
}) {
  const { t } = useTranslation('code');
  const [editing, setEditing] = useState(false);
  const [changes, setChanges] = useState('');
  const [error, setError] = useState('');
  const act = async (operation: () => Promise<void>) => {
    setError('');
    try { await operation(); } catch (reason) { setError(reason instanceof Error ? reason.message : t('planDecision.error')); }
  };
  return <DecisionTray
    label={t('planDecision.label')}
    kind={t('planDecision.kind')}
    icon={Ico.list(12)}
    actions={{
      secondary: { label: editing ? t('planDecision.cancelRevision') : t('planDecision.revise'), disabled: busy, onClick: () => setEditing(value => !value) },
      primary: editing
        ? { label: t('planDecision.update'), disabled: busy || !changes.trim(), onClick: () => void act(() => onRevise(changes.trim())) }
        : { label: t('planDecision.build'), disabled: busy, shortcut: 'Enter', tooltip: t('planDecision.buildTooltip'), onClick: () => void act(onBuild) },
    }}
    onKeyDown={event => {
      if (!editing && !busy && isTrayShortcut(event, 'Enter') && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); void act(onBuild); }
    }}
  >
    <h2 className="code-decision-tray__question">{t('planDecision.question')}</h2>
    {editing && <Textarea aria-label={t('planDecision.changesAriaLabel')} placeholder={t('planDecision.changesPlaceholder')} value={changes} onChange={setChanges} rows={3} disabled={busy} />}
    {error && <p className="code-decision__error" role="alert">{error}</p>}
  </DecisionTray>;
}
