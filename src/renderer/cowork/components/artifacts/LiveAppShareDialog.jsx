/*
 * "Let others duplicate…" for a live app: the owner names one colleague by
 * email, or everyone on the stack, and they can then duplicate it from "Apps
 * you can duplicate". The dialog also lists who can, each with "Stop". Nobody opens the owner's running app: the edge serves it
 * only to the person cowork-server's access check names as its launcher. Each
 * copy runs with its new owner's own connections. Used by the artifacts view
 * and the rail's Artifacts card.
 */

import { useEffect, useRef, useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import { Alert, Button, Field, Input, RadioGroup, Radio } from '../ui';
import { fetchLiveAppShares, shareLiveApp, withdrawLiveAppShare } from '../../api';
import { isEmailShaped } from '../../lib/emailAddress';
import {
  SHARED_WITH_YOU_LABEL,
  SHARE_WITH_EVERYONE,
  SHARE_WITH_EVERYONE_LABEL,
  SHARE_WITH_ONE,
  shareAudienceLabel,
} from '../../lib/liveAppSharing';

/*
 * What the owner agrees to, by audience: recipients see the owner's email, a
 * copy is the app as it is when they duplicate it, later edits included, and
 * stopping a share leaves the copies already made.
 */
const AUDIENCE_NOTE = {
  [SHARE_WITH_ONE]: 'They see your email beside the app, and can duplicate it until you stop.',
  [SHARE_WITH_EVERYONE]: 'Everyone on this stack, including people who join later, sees your email beside the app, '
    + 'and can duplicate it until you stop.',
};
const COPY_NOTE = 'Each copy is the app as it is when they duplicate it, including changes you make before then, '
  + 'and runs with its new owner\'s connections. Stopping keeps the copies already made. '
  + 'Nobody else opens your running app.';

const DONE_MESSAGE_ID = 'live-app-share-done';

export function LiveAppShareDialog({ artifact, onClose }) {
  const [audience, setAudience] = useState(SHARE_WITH_ONE);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Who the server shared it with, once it has: an address, or everyone.
  const [sharedWith, setSharedWith] = useState('');
  // The app's current shares, and the one "Stop sharing" is withdrawing.
  const [shares, setShares] = useState([]);
  const [sharesError, setSharesError] = useState('');
  const [withdrawing, setWithdrawing] = useState('');
  // Read out after a share stops, from a region that is always mounted.
  const [announcement, setAnnouncement] = useState('');

  /*
   * The Allow button that had focus is gone once the share succeeds, so focus
   * moves to Done, and the message it describes is read out with it. A ref,
   * not autoFocus: the Modal's focus handling has already run by then.
   */
  const doneRef = useRef(null);
  useEffect(() => {
    if (sharedWith) doneRef.current?.focus();
  }, [sharedWith]);

  /*
   * A stopped share's row, and the button that had focus with it, unmount;
   * focus moves to the next row's "Stop sharing", else to the email field, or
   * the chosen audience when there is none. It waits for the withdraw to
   * finish, so the controls are enabled again.
   */
  const formRef = useRef(null);
  const [focusAfterStop, setFocusAfterStop] = useState(null);
  useEffect(() => {
    if (!focusAfterStop || withdrawing) return;
    const form = formRef.current;
    const next = Array.from(form?.querySelectorAll('[data-share-id]') || [])
      .find((el) => el.dataset.shareId === focusAfterStop.shareId);
    (next || form?.querySelector('input[type="email"]') || form?.querySelector('[role="radio"][aria-checked="true"]'))?.focus();
    setFocusAfterStop(null);
  }, [focusAfterStop, withdrawing]);

  const projectId = artifact?.projectId;
  const slug = artifact?.slug;
  useEffect(() => {
    if (!projectId || !slug) return undefined;
    let cancelled = false;
    fetchLiveAppShares({ projectId, slug })
      .then((list) => { if (!cancelled) { setShares(list); setSharesError(''); } })
      .catch(() => {
        if (!cancelled) setSharesError("Couldn't load who this app is shared with. Close and reopen this dialog to try again.");
      });
    return () => { cancelled = true; };
  }, [projectId, slug]);

  if (!artifact) return null;

  const everyone = audience === SHARE_WITH_EVERYONE;
  const title = artifact.title || artifact.slug;
  const locked = busy || Boolean(withdrawing);
  const canShare = !locked && (everyone || isEmailShaped(email));
  const close = () => { if (!locked) onClose?.(); };

  const submit = async () => {
    if (!canShare) return;
    setBusy(true);
    setError('');
    try {
      const share = await shareLiveApp({
        projectId,
        slug,
        ...(everyone ? { everyone: true } : { email: email.trim() }),
      });
      setSharedWith(everyone ? SHARE_WITH_EVERYONE_LABEL : (share?.email || email.trim()));
    } catch (e) {
      setError(e?.message || "Couldn't let them duplicate this app.");
    } finally {
      setBusy(false);
    }
  };

  const stopSharing = async (share) => {
    if (locked) return;
    const who = shareAudienceLabel(share);
    const at = shares.findIndex((s) => s.shareId === share.shareId);
    const next = shares[at + 1] || shares[at - 1] || null;
    const drop = () => {
      setShares((prev) => prev.filter((s) => s.shareId !== share.shareId));
      setAnnouncement(`${who} can no longer duplicate it.`);
      setFocusAfterStop({ shareId: next?.shareId || '' });
    };
    setWithdrawing(share.shareId);
    setError('');
    setAnnouncement('');
    try {
      await withdrawLiveAppShare(share.shareId);
      drop();
    } catch (e) {
      // A 404 means the share is already gone, which is what the owner asked for.
      if (e?.status === 404) drop();
      else setError(e?.message || "Couldn't stop that.");
    } finally {
      setWithdrawing('');
    }
  };

  return (
    <Modal
      open
      onClose={close}
      size="sm"
      width="min(440px, 94vw)"
      labelledBy="live-app-share-title"
      closeOnBackdrop={!locked}
      closeOnEsc={!locked}
    >
      <ModalHeader id="live-app-share-title" title="Let others duplicate this app" subtitle={title} onClose={close} />
      <ModalBody>
        <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
        {sharedWith ? (
          <div id={DONE_MESSAGE_ID} className="s-body">
            {`${sharedWith} can now duplicate it. They find it under "${SHARED_WITH_YOU_LABEL}" on their Live Artifacts page, with your email.`}
          </div>
        ) : (
          <form
            ref={formRef}
            className="grid gap-3"
            onSubmit={(e) => { e.preventDefault(); submit(); }}
          >
            <RadioGroup
              value={audience}
              onValueChange={(next) => { setAudience(next); setError(''); }}
              disabled={locked}
              aria-label="Who can duplicate it"
              className="grid gap-2"
            >
              <Radio value={SHARE_WITH_ONE} variant="card" size="sm">
                <span className="text-sm text-ink">One colleague</span>
              </Radio>
              <Radio value={SHARE_WITH_EVERYONE} variant="card" size="sm">
                <span className="text-sm text-ink">{SHARE_WITH_EVERYONE_LABEL}</span>
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
                  disabled={locked}
                />
              </Field>
            )}
            {error && <Alert variant="danger">{error}</Alert>}
            {sharesError && <p className="m-0 text-xs text-ink-3">{sharesError}</p>}
            {shares.length > 0 && (
              <section aria-label="Who can duplicate it" className="grid gap-1">
                <h3 className="m-0 text-[11px] font-semibold text-ink-4">Who can duplicate it</h3>
                <ul className="m-0 p-0 list-none grid gap-1">
                  {shares.map((share) => {
                    const who = shareAudienceLabel(share);
                    return (
                      <li key={share.shareId} className="flex items-center gap-2 min-w-0">
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{who}</span>
                        <Button
                          size="xs"
                          variant="subtle"
                          className="shrink-0"
                          data-share-id={share.shareId}
                          aria-label={`Stop letting ${who} duplicate it`}
                          disabled={locked}
                          onClick={() => stopSharing(share)}
                        >
                          {withdrawing === share.shareId ? 'Stopping…' : 'Stop'}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <div className="s-body" style={{ color: 'var(--ink-3)' }}>
              {`${AUDIENCE_NOTE[audience]} ${COPY_NOTE}`}
            </div>
          </form>
        )}
      </ModalBody>
      <ModalFooter>
        {sharedWith ? (
          <Button ref={doneRef} variant="primary" onClick={close} aria-describedby={DONE_MESSAGE_ID}>Done</Button>
        ) : (
          <>
            <Button variant="subtle" onClick={close} disabled={locked}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={!canShare}>
              {busy ? 'Allowing…' : 'Allow'}
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}
