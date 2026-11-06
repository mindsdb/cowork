import { useEffect, useRef, useState } from 'react';

import Ico from '../Icons';
import Tooltip from '../ui/Tooltip';
import { copyText } from '../../lib/clipboard';

const ICON_SZ = 16;

/**
 * The action row under a chat turn, shared by Cowork chat and Code Mode:
 * Edit (user turns), Copy, and Delete. Edit and Delete appear only when their
 * handler is given; Copy only when there is text to copy.
 *
 * Hidden at rest and revealed on hover of the parent `.user-turn` /
 * `.answer-turn`; `isLast` keeps the most recent exchange's row visible.
 * Styles live with the turn rules in globals.css (`.turn-actions`).
 */
export function TurnActions({
  text = '',
  copyLabel = 'Copy',
  onEdit,
  onDelete,
  isLast = false,
  align = 'left',
}: {
  text?: string;
  copyLabel?: string;
  onEdit?: (() => void) | null;
  onDelete?: (() => void) | null;
  isLast?: boolean;
  align?: 'left' | 'right';
}) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  // The live region exists once the reader has copied from this turn, so a
  // transcript of idle turns doesn't carry one status region per message.
  const [announced, setAnnounced] = useState(false);
  // A streamed update, a different turn, or a newer click invalidates the
  // result of a copy still in flight.
  const attempt = useRef(0);
  useEffect(() => {
    setStatus('idle');
    return () => { attempt.current += 1; };
  }, [text]);
  useEffect(() => {
    if (status !== 'copied') return undefined;
    const timer = window.setTimeout(() => setStatus('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [status]);

  const onCopy = async () => {
    const current = ++attempt.current;
    setAnnounced(true);
    setStatus('copying');
    const ok = await copyText(text);
    if (current === attempt.current) setStatus(ok ? 'copied' : 'failed');
  };
  const copied = status === 'copied';
  const canCopy = !!text.trim();

  return (
    <div className={`turn-actions${isLast ? ' is-last' : ''} ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
      {onEdit && (
        <Tooltip content="Edit and resend">
          <button type="button" className="turn-action-btn" onClick={onEdit} aria-label="Edit and resend this message">
            {Ico.edit(ICON_SZ)}
          </button>
        </Tooltip>
      )}
      {canCopy && (
        <Tooltip content={copied ? 'Copied' : copyLabel}>
          <button
            type="button"
            className={`turn-action-btn${copied ? ' is-done' : ''}`}
            aria-label={copyLabel}
            disabled={status === 'copying'}
            onClick={() => void onCopy()}
          >
            {copied ? Ico.check(ICON_SZ) : Ico.copy(ICON_SZ)}
          </button>
        </Tooltip>
      )}
      {onDelete && (
        <Tooltip content="Delete">
          <button type="button" className="turn-action-btn turn-action-btn--danger" aria-label="Delete" onClick={onDelete}>
            {Ico.trash(ICON_SZ)}
          </button>
        </Tooltip>
      )}
      {canCopy && announced && (
        <span role="status" className={status === 'failed' ? 'turn-actions__error' : 'sr-only'}>
          {copied ? 'Copied' : status === 'failed' ? 'Could not copy. Try again.' : ''}
        </span>
      )}
    </div>
  );
}
