import Ico from './Icons';
import WorkspaceBrand from './WorkspaceBrand';
import { Kbd, Tooltip } from './ui';
import { useAppHeaderSlots } from './appHeader';

// The desktop window's top band, split the way the window is: the sidebar
// column owns its own band (the brand lives in the sidebar's head row, so it
// grows and shrinks with the sidebar as one box), and this row heads the
// content column. Zones:
//
//   lead  while the sidebar is hidden: a new-task shortcut and the compact
//         brand, past the window controls and the sidebar toggle.
//   view  the active view's header, portalled in through <AppHeader>.
//   app   app-wide controls: search and the attention slot.
//
// The row is a drag region; its controls opt out through the global no-drag
// rule for buttons.
export default function AppTitlebar({
  lightsInset,
  docked,
  onNewTask,
  newTaskLabel,
  brand,
  onOpenSearch,
  searchShortcut,
}) {
  const { setHeader, setAttention } = useAppHeaderSlots();
  return (
    <div
      className={`app-titlebar${docked ? '' : ' is-collapsed'}`}
      data-testid="app-titlebar"
      // Hidden, the sidebar leaves the window controls and its toggle over
      // this row's start, so the row clears them.
      style={{ paddingLeft: docked ? 0 : lightsInset + SIDEBAR_TOGGLE_SLOT }}
    >
      {!docked && (
        <div className="app-titlebar__lead">
          {onNewTask && (
            <Tooltip content={newTaskLabel}>
              <button type="button" className="icon-btn" onClick={onNewTask} aria-label={newTaskLabel}>
                {Ico.newTask(14)}
              </button>
            </Tooltip>
          )}
          <WorkspaceBrand {...brand} compact />
        </div>
      )}
      <div className="app-titlebar__main">
        <div ref={setHeader} className="app-titlebar__slot" />
        <div className="app-titlebar__app">
          <button type="button" className="app-titlebar__search" onClick={onOpenSearch} aria-label="Search">
            {Ico.search(14)}
            <span>Search</span>
            <Kbd>{searchShortcut}</Kbd>
          </button>
          <div ref={setAttention} className="app-titlebar__attention" />
        </div>
      </div>
    </div>
  );
}

// The toggle's footprint, button plus gap: the sidebar's head row and the
// collapsed titlebar both leave this much room after the window controls.
export const SIDEBAR_TOGGLE_SLOT = 30;

// The sidebar toggle, pinned beside the window controls over both columns so
// it stays put while the sidebar opens and closes beneath it.
export function SidebarToggle({ lightsInset, label, shortcut, onToggle }) {
  return (
    <div className="app-sidebar-toggle" style={{ left: lightsInset }}>
      <Tooltip content={shortcut ? `${label}  (${shortcut})` : label}>
        <button type="button" className="icon-btn" onClick={onToggle} aria-label={label}>
          {Ico.sidebar(14)}
        </button>
      </Tooltip>
    </div>
  );
}
