import { useEffect, useState } from 'react';
import Ico from './Icons';
import { Button, Card, Textarea, Spinner, Tooltip } from './ui';
import Badge from './ui/Badge';
import { Modal, ModalHeader, ModalBody } from './ui/Modal';
import { resolveApproval } from '../api';

// Approval card — a parked consequential action (approve-before-act).
// Pending: Send it / Edit / Skip. Auth kind: hand the tab to the human.
// Edit opens a small editor modal and resolves with the EDITED text — the
// user's words win, and the server executes exactly those words.
const STATUS_META = {
  approved: { label: 'Sent', variant: 'success' },
  edited: { label: 'Edited & sent', variant: 'success' },
  skipped: { label: 'Skipped', variant: 'muted' },
  expired: { label: 'Expired', variant: 'muted' },
  failed: { label: 'Failed — try again', variant: 'danger' },
};

export default function ApprovalCard({ approval, onOpenTab }) {
  const [busy, setBusy] = useState(null); // 'send' | 'skip' | 'edit' | null
  const [error, setError] = useState(null);
  const [resolved, setResolved] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState('');

  if (!approval || !approval.id) return null;
  const desc = approval.actionDescriptor || {};
  const status = resolved?.status || approval.status;
  const pending = status === 'pending' || status === 'failed';
  const isAuth = approval.kind === 'auth';
  const title = isAuth ? `Sign in to ${desc.appName || 'this app'}` : (desc.summary || 'Approval');
  const draft = approval.draft || '';
  const meta = STATUS_META[status];

  const resolve = async (resolution, editedDraft) => {
    if (busy) return;
    setBusy(resolution === 'skipped' ? 'skip' : 'send');
    setError(null);
    try {
      const res = await resolveApproval(approval.id, resolution, editedDraft);
      setResolved({ status: res.approval?.status || resolution });
    } catch (e) {
      setError(e?.message || 'Could not resolve — try again');
    } finally {
      setBusy(null);
    }
  };

  const openEditor = () => {
    setEditText(draft);
    setEditOpen(true);
  };

  const receiptError = resolved?.status === 'failed' && approval.receipt?.error;
  // Resolved receipts carry a human line (e.g. the digest's "See you at
  // 9:00.") — render it quietly when present.
  const receiptNote = resolved?.receipt?.summary || resolved?.receipt?.noted || approval.receipt?.summary || null;

  return (
    <>
      <Card padding="compact" style={{ marginTop: 4, maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            aria-hidden="true"
            style={{
              width: 40, height: 40, borderRadius: 'var(--r-lg)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent)', background: 'var(--surface-2)', border: '1px solid var(--line)',
            }}
          >
            {isAuth ? (Ico.key ? Ico.key(18) : Ico.lock(18)) : Ico.sparkle(18)}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="s-h3" style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }} aria-live="polite">
              {receiptError ? String(approval.receipt.error) : isAuth ? 'Hand this to yourself — Anton never touches logins' : 'Waiting for your review'}
            </div>
          </div>

          {meta && !pending && <Badge variant={meta.variant} size="sm">{meta.label}</Badge>}
          {pending && <Badge variant="accent" size="sm">Needs you</Badge>}
        </div>

        {draft && (
          <div style={{
            marginTop: 10, fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-2)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 4, overflow: 'hidden',
          }}>
            {draft}
          </div>
        )}

        {error && <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--danger)' }}>{error}</div>}
        {receiptNote && <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ok)' }}>{String(receiptNote)}</div>}

        {pending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            {isAuth ? (
              <>
                <Button size="sm" variant="primary" disabled={!!busy} onClick={() => onOpenTab?.(desc.tabId)}>
                  Open tab to sign in
                </Button>
                <Button size="sm" variant="subtle" disabled={!!busy} onClick={() => resolve('skipped')}>
                  {busy === 'skip' ? <Spinner style={{ width: 12, height: 12 }} /> : 'Skip'}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="primary" disabled={!!busy} onClick={() => resolve('approved')}>
                  {busy === 'send' ? <Spinner style={{ width: 12, height: 12 }} /> : 'Send it'}
                </Button>
                {draft && (
                  <Button size="sm" variant="subtle" disabled={!!busy} onClick={openEditor}>
                    Edit
                  </Button>
                )}
                <Tooltip content="Skipped — Anton learns from this too" delay={250}>
                  <span>
                    <Button size="sm" variant="subtle" disabled={!!busy} onClick={() => resolve('skipped')}>
                      {busy === 'skip' ? <Spinner style={{ width: 12, height: 12 }} /> : 'Skip'}
                    </Button>
                  </span>
                </Tooltip>
              </>
            )}
          </div>
        )}
      </Card>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} size="md" labelledBy="approval-edit-title">
        <ModalHeader id="approval-edit-title" title={`Edit — ${title}`} onClose={() => setEditOpen(false)} />
        <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Textarea
            value={editText}
            onChange={(v) => setEditText(v)}
            rows={10}
            autoFocus
            style={{ fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.5 }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button size="sm" variant="subtle" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!!busy || !editText.trim()}
              onClick={() => { setEditOpen(false); resolve('edited', editText); }}
            >
              {busy === 'send' ? <Spinner style={{ width: 12, height: 12 }} /> : 'Send edited'}
            </Button>
          </div>
        </div>
        </ModalBody>
      </Modal>
    </>
  );
}
