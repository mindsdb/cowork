import Ico from './Icons';
import BrandMenu from './BrandMenu';
import { Kbd, Tooltip } from './ui';
import { useAppHeaderSlots } from './appHeader';

// The one fixed-height row across the top of the desktop window. Three zones:
//
//   sidebar  window controls inset, the sidebar toggle (it never moves between
//            open and collapsed), a new-task shortcut while the sidebar is
//            hidden, and the brand / workspace menu. Docked, it sits over the
//            sidebar at --sidebar-w on the sidebar's surface.
//   view     the active view's header, portalled in through <AppHeader>.
//   app      app-wide controls: search and the attention slot.
//
// This row is the window's only drag region; its controls opt out through the
// global no-drag rule for buttons.
export default function AppTitlebar({
  lightsInset,
  docked,
  onToggleSidebar,
  toggleLabel,
  onNewTask,
  newTaskLabel,
  brand,
  onOpenSearch,
  searchShortcut,
}) {
  const { setHeader, setAttention } = useAppHeaderSlots();
  return (
    <div className="app-titlebar" data-testid="app-titlebar">
      <div
        className={`app-titlebar__zone${docked ? ' is-docked' : ''}`}
        style={{ paddingLeft: lightsInset }}
      >
        <Tooltip content={toggleLabel}>
          <button type="button" className="icon-btn" onClick={onToggleSidebar} aria-label={toggleLabel}>
            {docked ? Ico.sidebarCollapseLeft(15) : Ico.sidebarExpandRight(15)}
          </button>
        </Tooltip>
        {!docked && onNewTask && (
          <Tooltip content={newTaskLabel}>
            <button type="button" className="icon-btn" onClick={onNewTask} aria-label={newTaskLabel}>
              {Ico.newTask(15)}
            </button>
          </Tooltip>
        )}
        <BrandMenu {...brand} compact={!docked} />
      </div>
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
