import { useState } from 'react';
import Ico from '../components/Icons';
import { Textarea } from '../components/ui/Input';
import { DecisionTray, isTrayShortcut } from './DecisionTray';

export function PlanDecision({ busy, onBuild, onRevise }: {
  busy: boolean;
  onBuild: () => Promise<void>;
  onRevise: (changes: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [changes, setChanges] = useState('');
  const [error, setError] = useState('');
  const act = async (operation: () => Promise<void>) => {
    setError('');
    try { await operation(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not continue. Try again.'); }
  };
  return <DecisionTray
    label="Review plan"
    kind="Plan ready"
    icon={Ico.list(12)}
    actions={{
      secondary: { label: editing ? 'Cancel revision' : 'Revise plan', disabled: busy, onClick: () => setEditing(value => !value) },
      primary: editing
        ? { label: 'Update plan', disabled: busy || !changes.trim(), onClick: () => void act(() => onRevise(changes.trim())) }
        : { label: 'Build from plan', disabled: busy, shortcut: 'Enter', tooltip: 'Builds with this task’s selected permissions', onClick: () => void act(onBuild) },
    }}
    onKeyDown={event => {
      if (!editing && !busy && isTrayShortcut(event, 'Enter') && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); void act(onBuild); }
    }}
  >
    <h2 className="code-decision-tray__question">Start building from this plan?</h2>
    {editing && <Textarea aria-label="Changes to the plan" placeholder="What should change in the plan?" value={changes} onChange={setChanges} rows={3} disabled={busy} />}
    {error && <p className="code-decision__error" role="alert">{error}</p>}
  </DecisionTray>;
}
