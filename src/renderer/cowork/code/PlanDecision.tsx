import { useState } from 'react';
import Button from '../components/ui/Button';
import Ico from '../components/Icons';
import { Textarea } from '../components/ui/Input';
import Kbd from '../components/ui/Kbd';
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
    onKeyDown={event => {
      if (!editing && !busy && isTrayShortcut(event, 'Enter') && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); void act(onBuild); }
    }}
  >
    <h2 className="code-decision-tray__question">Start building from this plan?</h2>
    <p className="code-decision-tray__note">Planning is read-only. Building uses this task’s selected permissions.</p>
    {editing && <Textarea aria-label="Changes to the plan" placeholder="What should change in the plan?" value={changes} onChange={setChanges} rows={3} disabled={busy} />}
    {error && <p className="code-decision__error" role="alert">{error}</p>}
    <div className="code-decision-tray__actions">
      <Button variant="subtle" size="sm" disabled={busy} onClick={() => setEditing(value => !value)}>{editing ? 'Cancel revision' : 'Revise plan'}</Button>
      <span className="code-decision-tray__spacer" aria-hidden="true" />
      {editing ? <Button variant="primary" size="sm" disabled={busy || !changes.trim()} onClick={() => void act(() => onRevise(changes.trim()))}>Update plan</Button>
        : <Button variant="primary" size="sm" disabled={busy} aria-keyshortcuts="Enter" onClick={() => void act(onBuild)}>Build from plan <Kbd aria-hidden="true">⏎</Kbd></Button>}
    </div>
  </DecisionTray>;
}
