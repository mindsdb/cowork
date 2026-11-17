import { useEffect } from 'react';
import Ico from '../Icons';
import Button from '../ui/Button';
import './browser-panel.css';
import { useTranslation } from '../../../lib/i18n';
import { isEditable } from '../../lib/editable';

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
 * Whether the pane may move the keyboard into `element`: only when the
 * person's focus is on the page body, on nothing, or already inside the
 * pane's aside. A field or button elsewhere keeps its focus, and so does a
 * field in the pane they can type in, such as the start page's (isEditable);
 * once it turns off, as the start page's does when it sends, it doesn't.
 *
 * @param {Element | null} element
 * @returns {boolean}
 */
export function paneMayTakeFocus(element) {
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  if (!element?.closest('.browser-panel')?.contains(active)) return false;
  return !isEditable(active) || Boolean(/** @type {HTMLInputElement} */ (active).disabled);
}

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
  const { t } = useTranslation('chat');
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
      {!dock && <button type="button" className={`browser-panel-scrim${floating ? ' is-floating' : ''}`} aria-label={t('browser.close')} onClick={onClose} />}
      <aside
        className={`browser-panel${floating && !dock ? ' is-floating' : ''}${dock ? ' is-docked' : ''}${collapsed ? ' is-collapsed' : ''}`}
        aria-label={t('browser.shared')}
      >
        {dock && !collapsed && (
          <button type="button" className="browser-panel__dock-min" aria-label={t('browser.minimize')} onClick={dock.onToggle}>
            <span className="browser-panel__minus" aria-hidden="true" />
          </button>
        )}
        {(!dock || collapsed) && (
        <header
          className="browser-panel__header"
          onClick={collapsed ? dock.onToggle : undefined}
          role={collapsed ? 'button' : undefined}
          tabIndex={collapsed ? 0 : undefined}
          aria-label={collapsed ? t('browser.expand') : undefined}
          onKeyDown={collapsed ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dock.onToggle(); } } : undefined}
        >
          <div className="browser-panel__heading">
            <span className="browser-panel__icon">{Ico.globe(14)}</span>
            <div className="browser-panel__heading-text">
              <div className="browser-panel__title">{t('browser.title')}</div>
              <div className="browser-panel__hint">{hint}</div>
            </div>
          </div>
          <div className="browser-panel__actions">
            {!collapsed && actions}
            {/* The app's own controls beside the X: the project's browsers. */}
            {!collapsed && extraActions}
            {dock ? (
              <Button
                icon
                size="sm"
                variant="subtle"
                aria-label={collapsed ? t('browser.expand') : t('browser.minimize')}
                onClick={(e) => { e.stopPropagation(); dock.onToggle(); }}
              >
                {collapsed ? Ico.chevDown(14) : <span className="browser-panel__minus" aria-hidden="true" />}
              </Button>
            ) : (
              <Button icon size="sm" variant="subtle" aria-label={t('browser.close')} onClick={onClose}>{Ico.close(14)}</Button>
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
