import { useEffect } from 'react';
import Ico from '../Icons';
import Button from '../ui/Button';
import './browser-panel.css';

/* The browser pane's frame, shared by the web viewer and the desktop's own
   browser: the chat's right-hand column (or, below the inline width, a panel
   floating over the chat with a scrim), with a header and a stage. Escape on
   the page and the close buttons close it.

   `dock` (phones, in a task): the pane sits at the top of the chat, no taller
   than half the screen, with no scrim. Its header button minimizes it to the
   header alone instead of closing it, and the minimized header expands it
   again: `dock` is {collapsed, onToggle}. Expanded, it covers the top of
   the screen (browser-panel.css) with no header of its own: the page's own
   address row, and a Minimize button floating at its right end. */

/**
 * @param {{
 *   hint: import('react').ReactNode,
 *   actions?: import('react').ReactNode,
 *   below?: import('react').ReactNode,
 *   stageRef?: import('react').Ref<HTMLDivElement>,
 *   onClose: () => void,
 *   floating?: boolean,
 *   extraActions?: import('react').ReactNode,
 *   dock?: { collapsed: boolean, onToggle: () => void } | null,
 *   children?: import('react').ReactNode,
 * }} props
 */
export function BrowserFrame({ hint, actions = null, below = null, stageRef, onClose, floating = false, extraActions = null, dock = null, children }) {
  const close = dock ? (dock.collapsed ? () => {} : dock.onToggle) : onClose;
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && event.target === document.body) close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  const collapsed = Boolean(dock?.collapsed);
  return (
    <>
      {!dock && <button type="button" className={`browser-panel-scrim${floating ? ' is-floating' : ''}`} aria-label="Close browser" onClick={onClose} />}
      <aside
        className={`browser-panel${floating && !dock ? ' is-floating' : ''}${dock ? ' is-docked' : ''}${collapsed ? ' is-collapsed' : ''}`}
        aria-label="Shared browser"
      >
        {dock && !collapsed && (
          <button type="button" className="browser-panel__dock-min" aria-label="Minimize browser" onClick={dock.onToggle}>
            <span className="browser-panel__minus" aria-hidden="true" />
          </button>
        )}
        {(!dock || collapsed) && (
        <header
          className="browser-panel__header"
          onClick={collapsed ? dock.onToggle : undefined}
          role={collapsed ? 'button' : undefined}
          tabIndex={collapsed ? 0 : undefined}
          aria-label={collapsed ? 'Expand browser' : undefined}
          onKeyDown={collapsed ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dock.onToggle(); } } : undefined}
        >
          <div className="browser-panel__heading">
            <span className="browser-panel__icon">{Ico.globe(14)}</span>
            <div className="browser-panel__heading-text">
              <div className="browser-panel__title">Browser</div>
              <div className="browser-panel__hint">{hint}</div>
            </div>
          </div>
          <div className="browser-panel__actions">
            {!collapsed && actions}
            {/* The app's own icons beside the X: the call icon (TopShortcuts). */}
            {!collapsed && extraActions}
            {dock ? (
              <Button
                icon
                size="sm"
                variant="subtle"
                aria-label={collapsed ? 'Expand browser' : 'Minimize browser'}
                onClick={(e) => { e.stopPropagation(); dock.onToggle(); }}
              >
                {collapsed ? Ico.chevDown(14) : <span className="browser-panel__minus" aria-hidden="true" />}
              </Button>
            ) : (
              <Button icon size="sm" variant="subtle" aria-label="Close browser" onClick={onClose}>{Ico.close(14)}</Button>
            )}
          </div>
        </header>
        )}
        {/* Kept mounted while minimized, so the page keeps running. */}
        <div className="browser-panel__body" hidden={collapsed}>
          {below}
          <div className="browser-panel__stage" ref={stageRef}>
            {children}
          </div>
        </div>
      </aside>
    </>
  );
}

export default BrowserFrame;
