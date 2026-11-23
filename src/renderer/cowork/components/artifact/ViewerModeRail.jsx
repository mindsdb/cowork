// The viewer's panel rail (ENG-4455): a vertical strip of icon tabs on the
// right edge of the viewer, one per panel this person may open — Live edit,
// Comments, Stats. They are the viewer's layers (useViewerLayers): at most one
// is on, and it shows in the side panel beside the rail. Clicking another tab
// switches the panel; clicking the open one closes it, back to the plain
// preview. Each tab names itself, with a line on what it is for, on hover and
// focus. Up and down arrows move between the tabs.
//
// Below the tabs, apart from them, sit the rail's actions (ENG-4599: Open
// chat): plain buttons that do something once and open no panel, so they
// have no pressed state. A disabled action stays focusable and hoverable
// (`aria-disabled`, not `disabled`), so its tooltip can say why.

import { useId, useRef } from 'react';
import { Tooltip } from '../ui';

/**
 * @param {{
 *   label: string,
 *   panelId?: string,
 *   tabs: {
 *     id: string, icon: import('react').ReactNode, label: string,
 *     description: string, pressed: boolean, onSelect: () => void,
 *     badge?: number, badgeLabel?: string,
 *   }[],
 *   actions?: {
 *     id: string, icon: import('react').ReactNode, label: string,
 *     description: string, disabled?: boolean, onSelect: () => void,
 *   }[],
 * }} props
 */
export function ViewerModeRail({ label, tabs, panelId, actions = [] }) {
  const descriptionId = useId();
  const listRef = useRef(null);
  if (!tabs.length && !actions.length) return null;

  const onKeyDown = (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    const home = event.key === 'Home';
    const end = event.key === 'End';
    if (!step && !home && !end) return;
    const buttons = [...(listRef.current?.querySelectorAll('.artifact-mode-rail-tab') || [])];
    const at = buttons.indexOf(document.activeElement);
    const next = home ? 0 : end ? buttons.length - 1 : (at + step + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  };

  // One rail button, a tab or an action: its tooltip names it and says what
  // it is for (an action may have nothing to say yet).
  const renderItem = (entry, isAction) => {
    const describedBy = entry.description ? `${descriptionId}-${entry.id}` : undefined;
    return (
      <span key={entry.id} className="artifact-mode-rail-item">
        <Tooltip
          side="left"
          content={(
            <span className="artifact-mode-rail-tip">
              <span className="artifact-mode-rail-tip-title">{entry.label}</span>
              {entry.description && <span>{entry.description}</span>}
            </span>
          )}
        >
          <button
            type="button"
            className={isAction ? 'artifact-mode-rail-tab artifact-mode-rail-action' : 'artifact-mode-rail-tab'}
            data-mode={isAction ? undefined : entry.id}
            data-action={isAction ? entry.id : undefined}
            aria-pressed={isAction ? undefined : entry.pressed}
            aria-disabled={entry.disabled || undefined}
            aria-label={entry.badge > 0 && entry.badgeLabel ? entry.badgeLabel : entry.label}
            aria-describedby={describedBy}
            aria-controls={entry.pressed && panelId ? panelId : undefined}
            onClick={entry.disabled ? undefined : entry.onSelect}
          >
            {entry.icon}
          </button>
        </Tooltip>
        {describedBy && <span id={describedBy} className="sr-only">{entry.description}</span>}
        {entry.badge > 0 && (
          <span className="artifact-feedback-badge" aria-hidden="true">{Math.min(99, entry.badge)}</span>
        )}
      </span>
    );
  };

  return (
    <div
      ref={listRef}
      className="artifact-mode-rail"
      role="toolbar"
      aria-label={label}
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => renderItem(tab, false))}
      {actions.length > 0 && (
        <span className="artifact-mode-rail-actions">
          {actions.map((action) => renderItem(action, true))}
        </span>
      )}
    </div>
  );
}

export default ViewerModeRail;
