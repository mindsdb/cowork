import { useEffect, useState } from 'react';

import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';


/** What Review › Deliver needs to ask for a Git identity and retry the commit. */
export interface GitIdentitySetup {
  /** Prefilled from the signed-in account; the user can change either. */
  name: string;
  email: string;
  /** Saves the identity, then retries the commit that stopped. Throws to show a message. */
  onSubmit: (name: string, email: string) => Promise<void>;
}


export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  const at = trimmed.indexOf('@');
  return at > 0 && at < trimmed.length - 1 && !/\s/.test(trimmed);
}


/**
 * Shown when a commit stopped because Git has no author identity on this
 * computer (a fresh Windows account has none and Git for Windows cannot guess
 * an email). Saving writes only what Git lacks and reruns the same commit.
 */
export function GitIdentityCard({ setup, busy = false }: { setup: GitIdentitySetup; busy?: boolean }) {
  const [name, setName] = useState(setup.name);
  const [email, setEmail] = useState(setup.email);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setName(setup.name);
    setEmail(setup.email);
  }, [setup.email, setup.name]);
  const ready = Boolean(name.trim()) && looksLikeEmail(email);
  const disabled = busy || saving;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await setup.onSubmit(name.trim(), email.trim());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the Git identity.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="code-git-identity" aria-labelledby="code-git-identity-title">
      <div className="code-git-identity__intro">
        <div className="code-field-label" id="code-git-identity-title">Git needs to know who you are</div>
        <p>Commits on this computer need a name and an email. Save them once and the commit runs again. Anything Git already has is kept.</p>
      </div>
      <div className="code-git-identity__form">
        <Input value={name} onChange={setName} placeholder="Your name" aria-label="Name for Git commits" disabled={disabled} />
        <Input value={email} onChange={setEmail} placeholder="you@example.com" type="email" aria-label="Email for Git commits" disabled={disabled} />
        <Button size="sm" variant="primary" disabled={!ready || disabled} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save and commit'}
        </Button>
      </div>
      {error && <Alert variant="danger">{error}</Alert>}
    </section>
  );
}
