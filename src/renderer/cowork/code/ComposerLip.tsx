import { useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { ActionBar } from '../components/ui/ActionBar';
import type { ComposerNotice } from './composerNotices';
import './task-control.css';


const ICONS = {
  clock: () => Ico.clock(12),
  warning: () => Ico.warning(12),
  refresh: () => Ico.refresh(12),
} as const;


/** Steps to the next notice waiting behind the lip. */
export function MoreNotices({ count, onShow }: { count: number; onShow: () => void }) {
  if (count < 1) return null;
  return (
    <Button size="xs" variant="subtle" aria-label={`Show ${count} more ${count === 1 ? 'notice' : 'notices'}`} onClick={onShow}>
      +{count}
    </Button>
  );
}


/**
 * One status line that peeks out from behind the composer. It stays within
 * two lines; technical detail opens on request instead of growing the strip.
 */
export function ComposerLip({ notice, more = 0, onShowMore = () => {}, onChooseModel, onAddCredits, onReopen, onDismiss }: {
  notice: ComposerNotice;
  more?: number;
  onShowMore?: () => void;
  onChooseModel: () => void;
  onAddCredits: (billingTrigger: string) => void;
  onReopen: () => void;
  onDismiss: (key: string) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  // A title runs into its body on one line, so it ends as a sentence.
  const title = notice.title && notice.body && !/[.!?…]$/.test(notice.title) ? `${notice.title}.` : notice.title;
  const text = [title, notice.body].filter(Boolean).join(' ');
  // Two controls at most: the step that unblocks the next send, then one
  // more as a plain button, or a menu when there are several.
  const primary = notice.addCredits ? { label: 'Add credits', onClick: () => onAddCredits(notice.billingTrigger || 'unknown') }
    : notice.reopen ? { label: notice.reopening ? 'Reopening…' : 'Reopen task', onClick: onReopen, disabled: notice.reopening }
      : notice.chooseModel ? { label: 'Choose model', onClick: onChooseModel }
        : null;
  const others = [
    ...(notice.addCredits && notice.chooseModel ? [{ label: 'Choose another model', button: 'Choose model', onClick: onChooseModel }] : []),
    ...(notice.detail ? [{ label: detailOpen ? 'Hide details' : 'Show details', button: 'Details', expanded: detailOpen, onClick: () => setDetailOpen((open) => !open) }] : []),
  ];
  const secondary = others.length === 1 ? { ...others[0], label: others[0].button } : null;
  return (
    <div className={`code-composer-lip is-${notice.tone}`} role="status">
      <div className="code-composer-lip__row">
        <span className="code-composer-lip__icon" aria-hidden="true">{ICONS[notice.icon]()}</span>
        <p className="code-composer-lip__text" title={text}>
          {title && <strong>{title} </strong>}{notice.body && <span>{notice.body}</span>}
        </p>
        <div className="code-composer-lip__actions">
          <ActionBar size="xs" primary={primary} secondary={secondary} overflow={others.length > 1 ? others : []} menuSide="top" overflowLabel="More options" />
          <MoreNotices count={more} onShow={onShowMore} />
          {notice.dismissible && (
            <Button icon size="xs" variant="subtle" aria-label="Dismiss" onClick={() => onDismiss(notice.key)}>{Ico.close(12)}</Button>
          )}
        </div>
      </div>
      {detailOpen && notice.detail && <p className="code-composer-lip__detail">{notice.detail}</p>}
    </div>
  );
}
