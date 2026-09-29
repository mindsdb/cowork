import { useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Menu from '../components/ui/Menu';
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
  // A title runs into its body on one line, so it ends as a sentence.
  const title = notice.title && notice.body && !/[.!?…]$/.test(notice.title) ? `${notice.title}.` : notice.title;
  const text = [title, notice.body].filter(Boolean).join(' ');
  // One visible action at most, the step that unblocks the next send; the rest wait behind a menu.
  const primary = notice.addCredits ? { label: 'Add credits', onClick: onAddCredits }
    : notice.chooseModel ? { label: 'Choose model', onClick: onChooseModel }
      : null;
  const secondary = [
    ...(notice.addCredits && notice.chooseModel ? [{ label: 'Choose another model', onClick: onChooseModel }] : []),
    ...(notice.detail ? [{ label: detailOpen ? 'Hide details' : 'Show details', onClick: () => setDetailOpen((open) => !open) }] : []),
  ];
  return (
    <div className={`code-composer-lip is-${notice.tone}`} role="status">
      <div className="code-composer-lip__row">
        <span className="code-composer-lip__icon" aria-hidden="true">{ICONS[notice.icon]()}</span>
        <p className="code-composer-lip__text" title={text}>
          {title && <strong>{title} </strong>}{notice.body && <span>{notice.body}</span>}
        </p>
        <div className="code-composer-lip__actions">
          {primary && <Button size="xs" variant="default" onClick={primary.onClick}>{primary.label}</Button>}
          {!primary && secondary.length === 1 ? (
            <Button size="xs" variant="subtle" aria-expanded={detailOpen} onClick={secondary[0].onClick}>Details</Button>
          ) : secondary.length > 0 && (
            <Menu
              trigger={<Button icon size="xs" variant="subtle" aria-label="More options">{Ico.moreVert(12)}</Button>}
              items={secondary}
              side="top"
              align="end"
              ariaLabel="More options"
            />
          )}
          {notice.dismissible && (
            <Button icon size="xs" variant="subtle" aria-label="Dismiss" onClick={() => onDismiss(notice.key)}>{Ico.close(11)}</Button>
          )}
        </div>
      </div>
      {detailOpen && notice.detail && <p className="code-composer-lip__detail">{notice.detail}</p>}
    </div>
  );
}
