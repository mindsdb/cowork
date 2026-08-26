import { useState, useRef, useCallback } from 'react';
import { createCoworkRouter, initialNavState } from '../CoworkRouter';
import { fetchArtifacts, fetchProjects } from '../api';
import { makeProjectDetailToken } from '../lib/projectDetailToken';

// The app's routing brain: the current route, the active task / selected
// project / selected schedule, the project-detail resolution token, and the
// enter*/navigate/clearActive transitions. URL <-> state sync itself lives in
// CoworkRouter (memory router on Electron, browser router on web); this hook
// owns the in-app route state those elements read and drive.
//
// Outward coupling stays injected rather than absorbed (mirrors useSchedules):
// the transitions take the app-owned setters/loaders they touch — settings
// open, the "coming soon" popup, the tasks/projects/artifacts stores, the
// schedule refresh, and the conversation-load error — as inputs. `routeRef` is
// returned so the once-bound global-shortcut listener in App can read the live
// route without re-binding, and `activeTaskId` / `route` stay available to
// their many consumer sites through this return.
export function useNavigation({
  orgMode,
  sidebarPopout,
  setNavPopoutOpen,
  setComingSoonFeature,
  openSettings,
  setTasks,
  setProjects,
  setArtifacts,
  refreshSchedules,
  setConversationError,
}) {
  // Seed nav state from the address bar so a web deep-link / refresh paints the
  // right view instead of flashing Home. Electron's memory router starts at `/`.
  const initialNav = useRef(initialNavState()).current;
  // The router is created once (memory router on Electron, browser router on
  // web). It's stateless w.r.t. AppCore — nav state flows through context.
  const routerRef = useRef(null);
  if (!routerRef.current) routerRef.current = createCoworkRouter();

  const [route, setRoute] = useState(initialNav.route); // home | task | projects | scheduled | schedule-detail | artifacts | channels | customize
  // Keep a ref of the live route so the keydown listener in App (bound once on
  // mount) can read it without a re-bind on every nav.
  const routeRef = useRef('home');
  routeRef.current = route;

  const [activeTaskId, setActiveTaskId] = useState(initialNav.activeTaskId);
  // Seed from a `/scheduled/:id` deep-link so refresh restores the detail view.
  // (selectedProject is resolved from its id by the project route, so null here.)
  const [selectedScheduleId, setSelectedScheduleId] = useState(initialNav.selectedScheduleId ?? null);
  const [selectedProject, setSelectedProject] = useState(null);
  // The project-detail id currently being resolved from the fetched list, or
  // null once settled. Distinct from `selectedProject` (which the whole app
  // reads and the URL bridge mirrors): while this differs from the selection we
  // render the grid, not a stale project, under `/projects/:id`. Seeded so a
  // refresh on a detail URL shows the loading grid, not a flash of the list.
  const [projectDetailPending, setProjectDetailPending] = useState(
    initialNav.route === 'projects' ? (initialNav.selectedProjectId ?? null) : null
  );
  // Monotonic request token so a slow `/projects/:A` response can't overwrite a
  // later `/projects/:B` resolution, nor re-select A after the user leaves detail
  // (Back to the grid / Home / any route). See makeProjectDetailToken.
  const projectDetailTokenRef = useRef(null);
  if (projectDetailTokenRef.current === null) projectDetailTokenRef.current = makeProjectDetailToken();

  const clearActive = useCallback(() => {
    setTasks((prev) => prev.map((t) => t.status === 'active' ? { ...t, status: 'idle' } : t));
  }, [setTasks]);

  const navigate = (key) => {
    if (sidebarPopout) setNavPopoutOpen(false);
    // Connectors aren't available on Cloud yet — intercept any entry point
    // (sidebar, Settings, deep link) in org mode and show the "coming soon"
    // popup instead of routing to a half-working surface.
    if (orgMode && key === 'customize') {
      setComingSoonFeature('Connect Apps and Data');
      return;
    }
    if (key === 'settings' || key.startsWith('settings:')) {
      // Targeted (settings:backend) opens that section; a bare `settings`
      // opens the mobile section list (null) / desktop's last section.
      openSettings(key.includes(':') ? key.split(':')[1] : null);
      return;
    }
    if (key === 'projects') {
      // Clicking "Projects" in the sidebar should always land on the grid of
      // all projects, not the previously-selected project's detail. Clearing
      // here (not in enterRoute) keeps the chat-header crumb path — which
      // routes through onOpenProject and sets selectedProject AFTER routing —
      // unaffected.
      setSelectedProject(null);
    }
    // Flip route state; the URL bridge mirrors it and the route element's
    // enterRoute() (re)fetches that view's data.
    setRoute(key);
  };

  // URL → state sync for the route elements. enterRoute is the single place a
  // view's entry data is (re)fetched, so in-app nav / deep link / refresh /
  // Back-Forward all run the same path.
  const enterHome = useCallback(() => {
    setRoute('home');
    setConversationError(null);
    projectDetailTokenRef.current.leave(); // supersede any in-flight detail resolve
    setProjectDetailPending(null);
  }, [setConversationError]);

  const enterRoute = useCallback((key) => {
    setRoute(key);
    setConversationError(null);
    projectDetailTokenRef.current.leave(); // supersede any in-flight detail resolve
    setProjectDetailPending(null); // leaving a detail route (or landing on the grid)
    if (key === 'artifacts') {
      fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
    } else if (key === 'projects') {
      // Bare `/projects` is the grid — clear the selection so a Back from
      // `/projects/:id` doesn't render stale detail (detail = enterProjectDetail).
      setSelectedProject(null);
      fetchProjects().then((data) => { if (Array.isArray(data)) setProjects(data); });
    } else if (key === 'scheduled') {
      refreshSchedules();
    }
  }, [refreshSchedules, setConversationError, setArtifacts, setProjects]);

  // Detail routes → state (v1). No single-resource loader: resolve the entity
  // client-side from the fetched list, so refresh / deep-link restore the
  // selection with no server change.
  // Returns a promise resolving to `false` when the id isn't in the list (the
  // route element then replaces the dead URL with `/projects`), else truthy.
  const enterProjectDetail = useCallback((projectId) => {
    setRoute('projects');
    setConversationError(null);
    // Resolving this id: render the grid (not a stale project) until it settles.
    setProjectDetailPending(projectId);
    const reqId = projectDetailTokenRef.current.begin();
    return fetchProjects().then((data) => {
      if (!projectDetailTokenRef.current.isCurrent(reqId)) return true; // superseded — a newer id owns pending, or we left detail
      if (!Array.isArray(data)) { setProjectDetailPending(null); return true; }
      setProjects(data);
      const found = data.find((p) => p.id === projectId || p.name === projectId);
      if (found) { setProjectDetailPending(null); setSelectedProject(found); return true; }
      // Confirmed missing: keep `pending` set (stays on the grid) — the route
      // element replaces the URL with `/projects`, whose enterRoute clears it.
      return false;
    }).catch(() => {
      if (projectDetailTokenRef.current.isCurrent(reqId)) setProjectDetailPending(null);
      return true; // transient failure → keep the URL, don't bounce
    });
  }, [setConversationError, setProjects]);

  const enterScheduleDetail = useCallback((scheduleId) => {
    setRoute('schedule-detail');
    setSelectedScheduleId(scheduleId);
    setConversationError(null);
    refreshSchedules().catch(() => {});
  }, [refreshSchedules, setConversationError]);

  return {
    routerRef,
    routeRef,
    route,
    setRoute,
    activeTaskId,
    setActiveTaskId,
    selectedProject,
    setSelectedProject,
    selectedScheduleId,
    setSelectedScheduleId,
    projectDetailPending,
    setProjectDetailPending,
    projectDetailTokenRef,
    navigate,
    clearActive,
    enterHome,
    enterRoute,
    enterProjectDetail,
    enterScheduleDetail,
  };
}
