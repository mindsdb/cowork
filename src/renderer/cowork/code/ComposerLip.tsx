import { useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import type { ComposerNotice } from './composerNotices';
import './task-control.css';


const ICONS = {
  clock: () => Ico.clock(12),
  warning: () => Ico.warning(12),
} as const;


/**
 * One status line that peeks out from behind the composer. It stays within
 * two lines; technical detail opens on request instead of growing the strip.
 */
export function ComposerLip({ notice, onChooseModel, onAddCredits, onDismiss }: {
  notice: ComposerNotice;
  onChooseModel: () => void;
  onAddCredits: () => void;
  onDismiss: (key: string) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const text = [notice.title, notice.body].filter(Boolean).join('. ');
  return (
    <div className={`code-composer-lip is-${notice.tone}`} role="status">
      <div className="code-composer-lip__row">
        <span className="code-composer-lip__icon" aria-hidden="true">{ICONS[notice.icon]()}</span>
        <p className="code-composer-lip__text" title={text}>
          {notice.title && <strong>{notice.title} </strong>}{notice.body && <span>{notice.body}</span>}
        </p>
        <div className="code-composer-lip__actions">
          {notice.detail && (
            <Button size="xs" variant="subtle" aria-expanded={detailOpen} onClick={() => setDetailOpen((open) => !open)}>Details</Button>
          )}
          {notice.chooseModel && <Button size="xs" variant="tinted" onClick={onChooseModel}>Choose model</Button>}
          {notice.addCredits && <Button size="xs" variant="subtle" onClick={onAddCredits}>Add credits</Button>}
          {notice.dismissible && (
            <Button icon size="xs" variant="subtle" aria-label="Dismiss" onClick={() => onDismiss(notice.key)}>{Ico.close(11)}</Button>
          )}
        </div>
      </div>
      {detailOpen && notice.detail && <p className="code-composer-lip__detail">{notice.detail}</p>}
    </div>
  );
}
