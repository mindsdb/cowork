import { useState, useMemo, useEffect, useCallback } from 'react';
import { projectLabel, projectLabelByName } from '../lib/projectLabel';
import Ico from './Icons';
import { Badge } from './ui';


const SECTIONS = [
  { key: 'projects',  label: 'Projects',       route: 'projects' },
  { key: 'scheduled', label: 'Scheduled Tasks', route: 'scheduled' },
  { key: 'artifacts', label: 'Live Artifacts',  route: 'artifacts' },
  { key: 'tasks',     label: 'Tasks',           route: 'tasks' },
];

function titleForRoute(route, { selectedProject, currentTask } = {}) {
  if (route === 'home') return selectedProject?.name ? `New task · ${projectLabel(selectedProject)}` : 'New task';
  if (route === 'task') return currentTask?.title || 'Conversation';
  if (route === 'projects') return projectLabel(selectedProject) || 'Projects';
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
        <Badge variant="muted" className="min-w-[22px] justify-center font-semibold">{badge}</Badge>
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
  onNavigate,            // (routeKey) — same shape as App's navigate()
  onSelectTask,          // (taskId)
  onSelectProject,       // (project) — show project detail (has-tasks branch)
  onNewTaskInProject,    // (project) — open composer with project preselected
  onOpenSchedule,        // (scheduleId)
  onNewTask,             // () — fresh task, no project pinned
  onNewProject,          // () — open the "New project" modal (via projects route)
  navTitle = null,       // Settings → Appearance → Sidebar title override
  navLogo = null,        // Settings → Appearance → Sidebar logo override
// Mobile places the theme toggle in the top bar; the desktop floating controls do not fit.
  theme = 'dark',
  showThemeToggle = true,
  onToggleTheme,
  children,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openSection, setOpenSection] = useState(null);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);

  useEffect(() => { setFabMenuOpen(false); }, [route]);

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
      // Open an empty project in the composer; its first send creates the task.
      onNewTaskInProject?.(project);
    } else {
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

  // Hide creation controls on chat, settings and the read-only artifact gallery. New tasks inherit
  // the current project context.
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
        {showThemeToggle ? (
          <button
            type="button"
            className="mshell__theme-toggle"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? Ico.sun(16) : Ico.moon(16)}
          </button>
        ) : (
          <span className="mshell__top-spacer" aria-hidden="true" />
        )}
      </header>

      <div className="mshell__body">{children}</div>

      {showFab && (
        <>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {navLogo && (
              <img src={navLogo} alt="" aria-hidden="true" className="mshell__drawer-logo" />
            )}
            <span className="mshell__drawer-title">{navTitle || 'MindsHub Cowork'}</span>
          </div>
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
          {/* Put the divider on the square wrapper so it does not curve around the rounded button. */}
          <div className="mshell-accordion">
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
          </div>

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
                    primary={projectLabel(p) || p.path}
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
              // Limit the drawer to recent tasks; the destination shows the full list.
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
                      secondary={projectLabelByName(projects, t.projectName) || ''}
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

          {/* Reuse accordion-row styling for top-level navigation; these chevrons navigate rather than expand. */}
          <div className="mshell-accordion">
            <button
              type="button"
              className="mshell-accordion__head"
              onClick={() => handleNavigate('customize')}
            >
              <span className="mshell-accordion__label">Connect Apps and Data</span>
              <span className="mshell-accordion__chev">{Ico.chevronRight(16)}</span>
            </button>
          </div>
          {/* Memories and Skills library are intentionally omitted —
              those surfaces are desktop-focused (file editor, skill
              code editor) and don't read well at phone widths. */}
          <div className="mshell-accordion">
            <button
              type="button"
              className="mshell-accordion__head"
              onClick={() => handleNavigate('settings')}
            >
              <span className="mshell-accordion__label">Settings</span>
              <span className="mshell-accordion__chev">{Ico.chevronRight(16)}</span>
            </button>
          </div>
        </nav>
      </aside>
    </div>
  );
}
