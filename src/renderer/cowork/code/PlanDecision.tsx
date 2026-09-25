import { useState } from 'react';
import Button from '../components/ui/Button';
import { Textarea } from '../components/ui/Input';
import './task-control.css';

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
  return <section className="code-decision code-plan-decision" aria-label="Review plan">
    <header className="code-decision__header"><span className="code-decision__eyebrow">Ready for your review</span><h3>Start building from this plan?</h3><p>Planning is read-only. Building uses this task’s selected permissions.</p></header>
    {editing && <Textarea aria-label="Changes to the plan" placeholder="What should change in the plan?" value={changes} onChange={setChanges} rows={3} disabled={busy} />}
    {error && <p className="code-decision__error" role="alert">{error}</p>}
    <footer><span>You decide when execution begins.</span><div className="code-decision__buttons">
      <Button variant="subtle" size="sm" disabled={busy} onClick={() => setEditing(value => !value)}>{editing ? 'Cancel revision' : 'Revise plan'}</Button>
      {editing ? <Button variant="primary" size="sm" disabled={busy || !changes.trim()} onClick={() => void act(() => onRevise(changes.trim()))}>Update plan</Button>
        : <Button variant="primary" size="sm" disabled={busy} onClick={() => void act(onBuild)}>Build from plan</Button>}
    </div></footer>
  </section>;
}
