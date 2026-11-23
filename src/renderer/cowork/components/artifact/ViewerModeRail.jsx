// The viewer's panel rail (ENG-4455): a vertical strip of icon tabs on the
// right edge of the viewer, one per panel this person may open — Live edit,
// Comments, Stats. They are the viewer's layers (useViewerLayers): at most one
// is on, and it shows in the side panel beside the rail. Clicking another tab
// switches the panel; clicking the open one closes it, back to the plain
// preview. Each tab names itself, with a line on what it is for, on hover and
// focus. Up and down arrows move between the tabs.

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
 * }} props
 */
export function ViewerModeRail({ label, tabs, panelId }) {
  const descriptionId = useId();
  const listRef = useRef(null);
  if (!tabs.length) return null;

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

  return (
    <div
      ref={listRef}
      className="artifact-mode-rail"
      role="toolbar"
      aria-label={label}
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => (
        <span key={tab.id} className="artifact-mode-rail-item">
          <Tooltip
            side="left"
            content={(
              <span className="artifact-mode-rail-tip">
                <span className="artifact-mode-rail-tip-title">{tab.label}</span>
                <span>{tab.description}</span>
              </span>
            )}
          >
            <button
              type="button"
              className="artifact-mode-rail-tab"
              data-mode={tab.id}
              aria-pressed={tab.pressed}
              aria-label={tab.badge > 0 && tab.badgeLabel ? tab.badgeLabel : tab.label}
              aria-describedby={`${descriptionId}-${tab.id}`}
              aria-controls={tab.pressed && panelId ? panelId : undefined}
              onClick={tab.onSelect}
            >
              {tab.icon}
            </button>
          </Tooltip>
          <span id={`${descriptionId}-${tab.id}`} className="sr-only">{tab.description}</span>
          {tab.badge > 0 && (
            <span className="artifact-feedback-badge" aria-hidden="true">{Math.min(99, tab.badge)}</span>
          )}
        </span>
      ))}
    </div>
  );
}

export default ViewerModeRail;
