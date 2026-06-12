import { useState, useMemo, useEffect, useCallback } from 'react';
import Ico from './Icons';

// Mobile chrome for the cowork SPA. Active at viewport widths < 640px
// (see useBreakpoint.isMobile). Replaces the desktop sidebar + main
// layout with a top bar, slide-in accordion drawer, and a project-FAB.
// Views (HomeView, ChatView, ProjectsView, etc.) render unchanged
// inside `children` — only the chrome around them swaps.

const SECTIONS = [
  { key: 'projects',  label: 'Projects',       route: 'projects' },
  { key: 'scheduled', label: 'Scheduled Tasks', route: 'scheduled' },
  { key: 'artifacts', label: 'Live Artifacts',  route: 'artifacts' },
  { key: 'tasks',     label: 'Tasks',           route: 'tasks' },
];

function titleForRoute(route, { selectedProject, currentTask } = {}) {
  if (route === 'home') return selectedProject?.name ? `New task · ${selectedProject.name}` : 'New task';
  if (route === 'task') return currentTask?.title || 'Conversation';
  if (route === 'projects') return selectedProject?.name || 'Projects';
  if (route === 'scheduled' || route === 'schedule-detail') return 'Scheduled';
  if (route === 'artifacts') return 'Artifacts';
  if (route === 'tasks') return 'Tasks';
  if (route === 'customize') return 'Connect';
  if (route === 'settings') return 'Settings';
  if (route === 'memory') return 'Memories';
  if (route === 'skills') return 'Skills';
  return 'MindsHub Cowork';
}

function tasksForProject(tasks, project) {
  if (!project) return [];
  return tasks.filter((t) =>
    (project.name && t.projectName === project.name) ||
    (project.path && t.projectPath === project.path)
  );
}

function AccordionRow({ open, label, count, onToggle, children }) {
  return (
    <div className="mshell-accordion">
      <button
        type="button"
        className="mshell-accordion__head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="mshell-accordion__label">{label}</span>
        {typeof count === 'number' && count > 0 && (
          <span className="mshell-accordion__count">{count}</span>
        )}
        <span className={`mshell-accordion__chev ${open ? 'is-open' : ''}`}>
          {Ico.chevronRight(16)}
        </span>
      </button>
      <div className={`mshell-accordion__body ${open ? 'is-open' : ''}`}>
        <div className="mshell-accordion__inner">{children}</div>
      </div>
    </div>
  );
}

function ListRow({ primary, secondary, onClick, badge }) {
  return (
    <button type="button" className="mshell-row" onClick={onClick}>
      <span className="mshell-row__text">
        <span className="mshell-row__primary">{primary}</span>
        {secondary && <span className="mshell-row__secondary">{secondary}</span>}
      </span>
      {badge != null && badge !== '' && (
        <span className="mshell-row__badge">{badge}</span>
      )}
      <span className="mshell-row__chev">{Ico.chevronRight(14)}</span>
    </button>
  );
}

export default function MobileShell({
  route,
  currentTask,
  selectedProject,
  tasks,
  projects,
  scheduled,
  artifacts,
  // Navigation handlers — wire through to App.jsx state.
  onNavigate,            // (routeKey) — same shape as App's navigate()
  onSelectTask,          // (taskId)
  onSelectProject,       // (project) — show project detail (has-tasks branch)
  onNewTaskInProject,    // (project) — open composer with project preselected
  onOpenSchedule,        // (scheduleId)
  onNewTask,             // () — fresh task, no project pinned
  onNewProject,          // () — open the "New project" modal (via projects route)
  children,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openSection, setOpenSection] = useState(null);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);

  // Close the FAB menu whenever the route changes — landing in a new
  // view should never leave the popover floating from the prior one.
  useEffect(() => { setFabMenuOpen(false); }, [route]);

  // Close FAB menu on Escape (keyboard users + iPad with kb).
  useEffect(() => {
    if (!fabMenuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFabMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fabMenuOpen]);

  const projectsList = useMemo(() => projects || [], [projects]);
  const tasksList = useMemo(() => tasks || [], [tasks]);
  const schedulesList = useMemo(() => scheduled || [], [scheduled]);
  const artifactsList = useMemo(() => artifacts || [], [artifacts]);

  // Lock body scroll while the drawer is open so swipe-to-scroll
  // doesn't bleed through to the content underneath.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [drawerOpen]);

  // Close drawer on Escape — keyboard users + iPad with kb attached.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setOpenSection(null);
  }, []);

  const handleSectionTap = useCallback((section) => {
    setOpenSection((cur) => (cur === section.key ? null : section.key));
  }, []);

  const handleProjectTap = useCallback((project) => {
    closeDrawer();
    if (!project) return;
    const projTasks = tasksForProject(tasksList, project);
    if (projTasks.length === 0) {
      // No tasks yet — drop the user straight into a new chat for
      // this project. Composer (route=home) has the project
      // preselected; first send creates the task on the server.
      onNewTaskInProject?.(project);
    } else {
      // Has tasks — show the project detail (ProjectsView in detail
      // mode renders the task list, with the rail's cards stacked
      // below on mobile via the .mshell project-detail overrides).
      onSelectProject?.(project);
    }
  }, [closeDrawer, tasksList, onNewTaskInProject, onSelectProject]);

  const handleTaskTap = useCallback((taskId) => {
    closeDrawer();
    onSelectTask?.(taskId);
  }, [closeDrawer, onSelectTask]);

  const handleScheduleTap = useCallback((scheduleId) => {
    closeDrawer();
    onOpenSchedule?.(scheduleId);
  }, [closeDrawer, onOpenSchedule]);

  const handleNavigate = useCallback((key) => {
    closeDrawer();
    onNavigate?.(key);
  }, [closeDrawer, onNavigate]);

  const handleNewChat = useCallback(() => {
    closeDrawer();
    onNewTask?.();
  }, [closeDrawer, onNewTask]);

  const title = titleForRoute(route, { selectedProject, currentTask });

  // FAB is the universal "create" affordance on mobile. Hidden on:
  //   • 'task'      — the chat composer already covers "new message".
  //   • 'settings'  — configuration surface; "create new" not relevant.
  //   • 'artifacts' — a read-only gallery; artifacts are produced by
  //                   tasks, not by an explicit "+ artifact" action.
  // Tap opens a 2-row menu: New task / New project. "New task" honors
  // the current project context if any.
  const showFab = !['task', 'settings', 'artifacts'].includes(route);
  const fabProject = route === 'projects' && selectedProject ? selectedProject : null;

  return (
    <div className="mshell">
      <header className="mshell__top">
        <button
          type="button"
          className={`mshell__hamburger ${drawerOpen ? 'is-open' : ''}`}
          aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="mshell__title" title={title}>{title}</div>
        {/* Top-bar "+" removed — the FAB is now the universal create
            entry, so two affordances would just duplicate each other. */}
        <span className="mshell__top-spacer" aria-hidden="true" />
      </header>

      <div className="mshell__body">{children}</div>

      {showFab && (
        <>
          {/* Tap-outside scrim. Sits below the menu, above page content. */}
          <div
            className={`mshell__fab-scrim ${fabMenuOpen ? 'is-open' : ''}`}
            onClick={() => setFabMenuOpen(false)}
            aria-hidden="true"
          />
          <div className={`mshell__fab-menu ${fabMenuOpen ? 'is-open' : ''}`} role="menu">
            <button
              type="button"
              role="menuitem"
              className="mshell__fab-menu-item"
              onClick={() => {
                setFabMenuOpen(false);
                if (fabProject) onNewTaskInProject?.(fabProject);
                else onNewTask?.();
              }}
            >
              <span className="mshell__fab-menu-icon">{Ico.plus(16)}</span>
              <span className="mshell__fab-menu-text">
                <span className="mshell__fab-menu-primary">New task</span>
                {fabProject && (
                  <span className="mshell__fab-menu-secondary">in {fabProject.name}</span>
                )}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="mshell__fab-menu-item"
              onClick={() => {
                setFabMenuOpen(false);
                onNewProject?.();
              }}
            >
              <span className="mshell__fab-menu-icon">{Ico.folder(16)}</span>
              <span className="mshell__fab-menu-text">
                <span className="mshell__fab-menu-primary">New project</span>
              </span>
            </button>
          </div>
          <button
            type="button"
            className={`mshell__fab ${fabMenuOpen ? 'is-open' : ''}`}
            aria-label={fabMenuOpen ? 'Close create menu' : 'Create new'}
            aria-expanded={fabMenuOpen}
            aria-haspopup="menu"
            onClick={() => setFabMenuOpen((v) => !v)}
          >
            {Ico.plus(22)}
          </button>
        </>
      )}

      <div
        className={`mshell__scrim ${drawerOpen ? 'is-open' : ''}`}
        onClick={closeDrawer}
        aria-hidden="true"
      />

      <aside
        className={`mshell__drawer ${drawerOpen ? 'is-open' : ''}`}
        aria-hidden={!drawerOpen}
      >
        <div className="mshell__drawer-head">
          <span className="mshell__drawer-title">MindsHub Cowork</span>
          <button
            type="button"
            className="mshell__close"
            aria-label="Close menu"
            onClick={closeDrawer}
          >
            {Ico.close(16)}
          </button>
        </div>

        <nav className="mshell__drawer-body">
          <button
            type="button"
            className={`mshell-row mshell-row--top ${route === 'home' || route === 'task' ? 'is-active' : ''}`}
            onClick={() => handleNavigate('home')}
          >
            <span className="mshell-row__text">
              <span className="mshell-row__primary">Chat</span>
              <span className="mshell-row__secondary">Start or continue a conversation</span>
            </span>
            <span className="mshell-row__chev">{Ico.chevronRight(14)}</span>
          </button>

          {SECTIONS.map((section) => {
            const isOpen = openSection === section.key;
            let count = 0;
            let content = null;
            if (section.key === 'projects') {
              count = projectsList.length;
              content = projectsList.length === 0 ? (
                <div className="mshell-empty">No projects yet.</div>
              ) : projectsList.map((p) => {
                const projTasks = tasksForProject(tasksList, p);
                return (
                  <ListRow
                    key={p.name || p.path}
                    primary={p.name || p.path}
                    secondary={projTasks.length === 0
                      ? 'Tap to start chatting'
                      : `${projTasks.length} ${projTasks.length === 1 ? 'task' : 'tasks'}`}
                    onClick={() => handleProjectTap(p)}
                  />
                );
              });
            } else if (section.key === 'scheduled') {
              count = schedulesList.length;
              content = schedulesList.length === 0 ? (
                <div className="mshell-empty">No scheduled tasks.</div>
              ) : schedulesList.map((s) => (
                <ListRow
                  key={s.id}
                  primary={s.title || s.name || 'Schedule'}
                  secondary={s.cron || s.schedule || ''}
                  onClick={() => handleScheduleTap(s.id)}
                />
              ));
            } else if (section.key === 'artifacts') {
              count = artifactsList.length;
              content = artifactsList.length === 0 ? (
                <div className="mshell-empty">No live artifacts.</div>
              ) : (
                <ListRow
                  primary="View all artifacts"
                  secondary={`${artifactsList.length} total`}
                  onClick={() => handleNavigate('artifacts')}
                />
              );
            } else if (section.key === 'tasks') {
              // Show only recently-touched tasks in the drawer so the
              // accordion stays scannable; full list is one tap away.
              const recent = tasksList.slice(0, 12);
              count = tasksList.length;
              content = recent.length === 0 ? (
                <div className="mshell-empty">No tasks yet.</div>
              ) : (
                <>
                  {recent.map((t) => (
                    <ListRow
                      key={t.id}
                      primary={t.title || 'Untitled task'}
                      secondary={t.projectName || ''}
                      onClick={() => handleTaskTap(t.id)}
                    />
                  ))}
                  {tasksList.length > recent.length && (
                    <ListRow
                      primary="See all tasks"
                      onClick={() => handleNavigate('tasks')}
                    />
                  )}
                </>
              );
            }
            return (
              <AccordionRow
                key={section.key}
                open={isOpen}
                label={section.label}
                count={count}
                onToggle={() => handleSectionTap(section)}
              >
                {content}
              </AccordionRow>
            );
          })}

          <div className="mshell-divider" role="separator" />

          <button
            type="button"
            className="mshell-row"
            onClick={() => handleNavigate('customize')}
          >
            <span className="mshell-row__text">
              <span className="mshell-row__primary">Connect Apps and Data</span>
            </span>
            <span className="mshell-row__chev">{Ico.chevronRight(14)}</span>
          </button>
          {/* Memories and Skills library are intentionally omitted —
              those surfaces are desktop-focused (file editor, skill
              code editor) and don't read well at phone widths. */}
          <button
            type="button"
            className="mshell-row"
            onClick={() => handleNavigate('settings')}
          >
            <span className="mshell-row__text">
              <span className="mshell-row__primary">Settings</span>
            </span>
            <span className="mshell-row__chev">{Ico.chevronRight(14)}</span>
          </button>
        </nav>
      </aside>
    </div>
  );
}
