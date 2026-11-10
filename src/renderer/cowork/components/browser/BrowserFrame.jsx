import { useEffect } from 'react';
import Ico from '../Icons';
import Button from '../ui/Button';
import './browser-panel.css';

/* The browser pane's frame, shared by the web viewer and the desktop's own
   browser: the chat's right-hand column (or, below the inline width, a panel
   floating over the chat with a scrim), with a header and a stage. Escape on
   the page and the close buttons close it. */

/**
 * @param {{
 *   hint: import('react').ReactNode,
 *   actions?: import('react').ReactNode,
 *   below?: import('react').ReactNode,
 *   stageRef?: import('react').Ref<HTMLDivElement>,
 *   onClose: () => void,
 *   floating?: boolean,
 *   extraActions?: import('react').ReactNode,
 *   children?: import('react').ReactNode,
 * }} props
 */
export function BrowserFrame({ hint, actions = null, below = null, stageRef, onClose, floating = false, extraActions = null, children }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && event.target === document.body) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <>
      <button type="button" className={`browser-panel-scrim${floating ? ' is-floating' : ''}`} aria-label="Close browser" onClick={onClose} />
      <aside className={`browser-panel${floating ? ' is-floating' : ''}`} aria-label="Shared browser">
        <header className="browser-panel__header">
          <div className="browser-panel__heading">
            <span className="browser-panel__icon">{Ico.globe(14)}</span>
            <div className="browser-panel__heading-text">
              <div className="browser-panel__title">Browser</div>
              <div className="browser-panel__hint">{hint}</div>
            </div>
          </div>
          <div className="browser-panel__actions">
            {actions}
            {/* The app's own icons beside the X: the call icon (TopShortcuts). */}
            {extraActions}
            <Button icon size="sm" variant="subtle" aria-label="Close browser" onClick={onClose}>{Ico.close(14)}</Button>
          </div>
        </header>
        {below}
        <div className="browser-panel__stage" ref={stageRef}>
          {children}
        </div>
      </aside>
    </>
  );
}

export default BrowserFrame;
