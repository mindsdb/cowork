import { useState, useMemo, useEffect, useCallback } from 'react';
import { projectLabel, projectLabelByName } from '../lib/projectLabel';
import Ico from './Icons';
import { Badge } from './ui';
import { brandLogoUrl, productName } from '../../lib/deploymentBrand';
import { STOCK_PRODUCT_NAME } from '../../../shared/product-name';
import { useTranslation } from '../../lib/i18n';

// Mobile chrome for the cowork SPA. Active at viewport widths < 640px
// (see useBreakpoint.isMobile). Replaces the desktop sidebar + main
// layout with a top bar, slide-in accordion drawer, and a project-FAB.
// Views (HomeView, ChatView, ProjectsView, etc.) render unchanged
// inside `children` — only the chrome around them swaps.

// `label` is a message key; translated at render.
const SECTIONS = [
  { key: 'projects',  label: 'sidebar.nav.projects',  route: 'projects' },
  { key: 'scheduled', label: 'sidebar.nav.scheduled', route: 'scheduled' },
  { key: 'artifacts', label: 'sidebar.nav.artifacts', route: 'artifacts' },
  { key: 'tasks',     label: 'mobile.tasks',          route: 'tasks' },
];

function titleForRoute(t, route, { selectedProject, currentTask } = {}) {
  if (route === 'home') return selectedProject?.name ? t('mobile.titles.newTaskIn', { project: projectLabel(selectedProject) }) : t('sidebar.newTask');
  if (route === 'task') return currentTask?.title || t('mobile.titles.conversation');
  if (route === 'projects') return projectLabel(selectedProject) || t('sidebar.nav.projects');
  if (route === 'scheduled' || route === 'schedule-detail') return t('mobile.titles.scheduled');
  if (route === 'artifacts') return t('rail.artifacts.title');
  if (route === 'tasks') return t('mobile.tasks');
  if (route === 'customize') return t('mobile.titles.connect');
  if (route === 'settings') return t('sidebar.settings');
  if (route === 'memory') return t('sidebar.nav.memories');
  if (route === 'skills') return t('sidebar.nav.skills');
  if (route === 'compare') return t('sidebar.nav.compare');
  return productName(STOCK_PRODUCT_NAME);
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
  // Navigation handlers — wire through to App.jsx state.
  onNavigate,            // (routeKey) — same shape as App's navigate()
  onSelectTask,          // (taskId)
  onSelectProject,       // (project) — show project detail (has-tasks branch)
  onNewTaskInProject,    // (project) — open composer with project preselected
  onOpenSchedule,        // (scheduleId)
  onNewTask,             // () — fresh task, no project pinned
  onNewProject,          // () — open the "New project" modal (via projects route)
  navTitle = null,       // Settings → Appearance → Sidebar title override
  navLogo = null,        // Settings → Appearance → Sidebar logo override
  navLogoWide = false,   // the org's wordmark logo, not a square icon
  navTitleHidden = false, // the org chose logo only: no title, not even the product name
  // Top-bar theme toggle, opposite the hamburger — mobile has no titlebar
  // or sidebar footer, where desktop docks display settings.
  theme = 'dark',
  showThemeToggle = true,
  onToggleTheme,
  children,
}) {
  const { t } = useTranslation('shell');
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

  const title = titleForRoute(t, route, { selectedProject, currentTask });

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
          aria-label={drawerOpen ? t('mobile.closeMenu') : t('mobile.openMenu')}
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
        {showThemeToggle ? (
          <button
            type="button"
            className="mshell__theme-toggle"
            aria-label={theme === 'dark' ? t('mobile.switchToLight') : t('mobile.switchToDark')}
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
                <span className="mshell__fab-menu-primary">{t('sidebar.newTask')}</span>
                {fabProject && (
                  <span className="mshell__fab-menu-secondary">{t('mobile.inProject', { project: fabProject.name })}</span>
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
                <span className="mshell__fab-menu-primary">{t('mobile.newProject')}</span>
              </span>
            </button>
          </div>
          <button
            type="button"
            className={`mshell__fab ${fabMenuOpen ? 'is-open' : ''}`}
            aria-label={fabMenuOpen ? t('mobile.closeCreateMenu') : t('mobile.createNew')}
            aria-expanded={fabMenuOpen}
            aria-haspopup="menu"
            onClick={() => setFabMenuOpen((v) => !v)}
          >
            {Ico.plus(20)}
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
            {(navLogo || brandLogoUrl()) && (
              <img src={navLogo || brandLogoUrl()} alt="" aria-hidden="true" className={navLogoWide ? 'mshell__drawer-logo mshell__drawer-logo--wide' : 'mshell__drawer-logo'} />
            )}
            {!navTitleHidden && <span className="mshell__drawer-title">{navTitle || productName(STOCK_PRODUCT_NAME)}</span>}
          </div>
          <button
            type="button"
            className="mshell__close"
            aria-label={t('mobile.closeMenu')}
            onClick={closeDrawer}
          >
            {Ico.close(16)}
          </button>
        </div>

        <nav className="mshell__drawer-body">
          {/* Wrapped in mshell-accordion so the row divider is a full-width,
              square border-bottom (matching the section rows) — a border on
              the rounded row button itself curved oddly at the corners. */}
          <div className="mshell-accordion">
            <button
              type="button"
              className={`mshell-row mshell-row--top ${route === 'home' || route === 'task' ? 'is-active' : ''}`}
              onClick={() => handleNavigate('home')}
            >
              <span className="mshell-row__text">
                <span className="mshell-row__primary">{t('mobile.chat')}</span>
                <span className="mshell-row__secondary">{t('mobile.chatSubtitle')}</span>
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
                <div className="mshell-empty">{t('mobile.noProjects')}</div>
              ) : projectsList.map((p) => {
                const projTasks = tasksForProject(tasksList, p);
                return (
                  <ListRow
                    key={p.name || p.path}
                    primary={projectLabel(p) || p.path}
                    secondary={projTasks.length === 0
                      ? t('mobile.tapToStart')
                      : t('mobile.taskCount', { count: projTasks.length })}
                    onClick={() => handleProjectTap(p)}
                  />
                );
              });
            } else if (section.key === 'scheduled') {
              count = schedulesList.length;
              content = schedulesList.length === 0 ? (
                <div className="mshell-empty">{t('mobile.noScheduled')}</div>
              ) : schedulesList.map((s) => (
                <ListRow
                  key={s.id}
                  primary={s.title || s.name || t('mobile.schedule')}
                  secondary={s.cron || s.schedule || ''}
                  onClick={() => handleScheduleTap(s.id)}
                />
              ));
            } else if (section.key === 'artifacts') {
              count = artifactsList.length;
              content = artifactsList.length === 0 ? (
                <div className="mshell-empty">{t('mobile.noArtifacts')}</div>
              ) : (
                <ListRow
                  primary={t('mobile.viewAllArtifacts')}
                  secondary={t('mobile.total', { count: artifactsList.length })}
                  onClick={() => handleNavigate('artifacts')}
                />
              );
            } else if (section.key === 'tasks') {
              // Show only recently-touched tasks in the drawer so the
              // accordion stays scannable; full list is one tap away.
              const recent = tasksList.slice(0, 12);
              count = tasksList.length;
              content = recent.length === 0 ? (
                <div className="mshell-empty">{t('mobile.noTasks')}</div>
              ) : (
                <>
                  {recent.map((task) => (
                    <ListRow
                      key={task.id}
                      primary={task.title || t('mobile.untitledTask')}
                      secondary={projectLabelByName(projects, task.projectName) || ''}
                      onClick={() => handleTaskTap(task.id)}
                    />
                  ))}
                  {tasksList.length > recent.length && (
                    <ListRow
                      primary={t('mobile.seeAllTasks')}
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
                label={t(section.label)}
                count={count}
                onToggle={() => handleSectionTap(section)}
              >
                {content}
              </AccordionRow>
            );
          })}

          {/* Connect + Settings are top-level nav too, so render them with
              the same accordion-row markup as the sections above — matching
              padding, label weight, chevron, and hairline divider — instead
              of the lighter mshell-row. They don't expand; the chevron is a
              navigate affordance. The old inset mshell-divider is dropped so
              the drawer reads as one consistent list (the accordion
              border-bottom + :last-of-type rule handles separators). */}
          <div className="mshell-accordion">
            <button
              type="button"
              className="mshell-accordion__head"
              onClick={() => handleNavigate('customize')}
            >
              <span className="mshell-accordion__label">{t('sidebar.nav.connectApps')}</span>
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
              <span className="mshell-accordion__label">{t('sidebar.settings')}</span>
              <span className="mshell-accordion__chev">{Ico.chevronRight(16)}</span>
            </button>
          </div>
        </nav>
      </aside>
    </div>
  );
}
