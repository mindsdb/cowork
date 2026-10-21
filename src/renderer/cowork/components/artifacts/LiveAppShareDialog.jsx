// "Share with…" for a live app: the owner names one colleague by email, or
// shares it with everyone on the stack, and they can then duplicate it from
// "Shared with you". Nobody opens the owner's running app; each copy runs with
// its new owner's own connections. Used by the artifacts view and the rail's
// Artifacts card.

import { useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import { Alert, Button, Field, Input, RadioGroup, Radio } from '../ui';
import { shareLiveApp } from '../../api';
import {
  SHARED_WITH_YOU_LABEL,
  SHARE_WITH_EVERYONE,
  SHARE_WITH_ONE,
  isEmailLike,
} from '../../lib/liveAppSharing';

export function LiveAppShareDialog({ artifact, onClose }) {
  const [audience, setAudience] = useState(SHARE_WITH_ONE);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Who the server shared it with, once it has: an address, or everyone.
  const [sharedWith, setSharedWith] = useState('');
  if (!artifact) return null;

  const everyone = audience === SHARE_WITH_EVERYONE;
  const title = artifact.title || artifact.slug;
  const canShare = !busy && (everyone || isEmailLike(email));
  const close = () => { if (!busy) onClose?.(); };

  const submit = async () => {
    if (!canShare) return;
    setBusy(true);
    setError('');
    try {
      const share = await shareLiveApp({
        projectId: artifact.projectId,
        slug: artifact.slug,
        ...(everyone ? { everyone: true } : { email: email.trim() }),
      });
      setSharedWith(everyone ? 'everyone on this stack' : (share?.email || email.trim()));
    } catch (e) {
      setError(e?.message || "Couldn't share this app.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      size="sm"
      width="min(440px, 94vw)"
      labelledBy="live-app-share-title"
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
    >
      <ModalHeader id="live-app-share-title" title="Share this app" subtitle={title} onClose={close} />
      <ModalBody>
        {sharedWith ? (
          <div className="s-body">
            {`Shared with ${sharedWith}. It shows under "${SHARED_WITH_YOU_LABEL}", where they can duplicate it into their own project.`}
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => { e.preventDefault(); submit(); }}
          >
            <RadioGroup
              value={audience}
              onValueChange={(next) => { setAudience(next); setError(''); }}
              disabled={busy}
              aria-label="Who can duplicate it"
              className="grid gap-2"
            >
              <Radio value={SHARE_WITH_ONE} variant="card" size="sm">
                <span className="text-sm text-ink">One colleague</span>
              </Radio>
              <Radio value={SHARE_WITH_EVERYONE} variant="card" size="sm">
                <span className="text-sm text-ink">Everyone on this stack</span>
              </Radio>
            </RadioGroup>
            {!everyone && (
              <Field label="Colleague's email">
                <Input
                  type="email"
                  value={email}
                  onChange={(next) => { setEmail(next); setError(''); }}
                  placeholder="name@example.com"
                  autoFocus
                  disabled={busy}
                />
              </Field>
            )}
            <div className="s-body" style={{ color: 'var(--ink-3)' }}>
              Each person who duplicates it gets their own copy, which runs with their own connections. Nobody else opens your running app.
            </div>
            {error && <Alert variant="danger">{error}</Alert>}
          </form>
        )}
      </ModalBody>
      <ModalFooter>
        {sharedWith ? (
          <Button variant="primary" onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="subtle" onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={!canShare}>
              {busy ? 'Sharing…' : 'Share'}
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}
