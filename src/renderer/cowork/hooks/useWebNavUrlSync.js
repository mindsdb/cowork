import { useState, useEffect, useRef } from 'react';
import { host } from '../../platform/host';
import { parseUrlState, buildSearch, historyWriteKind } from '../lib/urlState';

// ENG-1233 — keep the web shell's URL query string in step with the app's nav
// state, and reflect refresh / deep-links / Back / Forward back into it. Web only:
// every effect here no-ops under Electron (there's no address bar). The pure
// state<->query mapping lives in lib/urlState.js; this hook is the React glue.
//
// It owns three things: an OUTBOUND effect (nav state -> URL), an INBOUND popstate
// handler (URL -> nav state), and two DEEP-LINK resolvers that apply an id/name
// from the boot URL once its async list (sessions / projects) has loaded.
//
// Called late in AppCore so it can close over the navigation primitives
// (selectTask / navigate / openSettings) it dispatches through — restoring a URL
// runs the exact same primitives a click would, so restored state == clicked state.
export function useWebNavUrlSync({
  bootNav,
  route, activeTaskId, selectedProject, selectedScheduleId, settingsOpen, settingsSection,
  tasks, projects, sessionsLoaded, projectsLoaded,
  setRoute, setActiveTaskId, setSelectedProject, setSelectedScheduleId, setSettingsOpen,
  selectTask, navigate, openSettings,
  fetchArtifacts, setArtifacts, fetchProjects, setProjects, fetchSchedules, setScheduled, setScheduleRunsIndex,
}) {
  const firstUrlSyncRef = useRef(true);
  const prevContentSigRef = useRef(null);
  const forceReplaceRef = useRef(false);
  // Bumping this makes the outbound effect run even when the nav-state setters
  // paired with a forced replace are no-ops (e.g. reconciling to home when already
  // home). Otherwise the flag would strand as true and later downgrade a genuine
  // push into a replace, silently dropping a Back/Forward entry.
  const [urlSyncTick, setUrlSyncTick] = useState(0);
  const forceUrlReplace = () => { forceReplaceRef.current = true; setUrlSyncTick((n) => n + 1); };

  // A deep-linked id/name that can't be applied until its list loads — seeded from
  // the boot URL, cleared once resolved or abandoned.
  const pendingTaskIdRef = useRef(bootNav?.route === 'task' ? bootNav.taskId : null);
  const pendingProjectNameRef = useRef(bootNav?.route === 'projects' ? bootNav.projectName : null);

  const navHandlerRef = useRef(() => {});

  // Outbound: mirror nav state into the query string. The first write of a page
  // life replaces (so a reload/deep-link adds no history entry); a content change
  // pushes (Back/Forward walk real destinations); the settings overlay only ever
  // replaces (browsing settings shouldn't bury the page under Back-eating entries).
  // Idempotent by construction, so a popstate-driven state change won't re-push.
  useEffect(() => {
    if (!host.isWeb) return;
    const isFirst = firstUrlSyncRef.current;
    firstUrlSyncRef.current = false;
    // Read-and-clear up front so the flag can't survive the unchanged-URL early
    // return and taint a later genuine navigation.
    const forceReplace = forceReplaceRef.current;
    forceReplaceRef.current = false;
    const prevSig = prevContentSigRef.current;
    const contentSig = `${route}|${activeTaskId || ''}|${selectedProject?.name || ''}|${selectedScheduleId || ''}`;
    const contentChanged = prevSig !== null && prevSig !== contentSig;
    const prevTaskId = prevSig ? prevSig.split('|')[1] : '';
    prevContentSigRef.current = contentSig;
    const desired = buildSearch({
      route,
      taskId: activeTaskId,
      projectName: selectedProject?.name || null,
      scheduleId: selectedScheduleId,
      settingsPane: settingsOpen ? (settingsSection || '') : null,
    }, window.location.search);
    if (desired === window.location.search) return;
    const url = `${window.location.pathname}${desired}${window.location.hash}`;
    let kind = historyWriteKind({ contentChanged, isFirst, route, prevTaskId, taskId: activeTaskId });
    if (forceReplace) kind = 'replace';
    if (kind === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, [route, activeTaskId, selectedProject, selectedScheduleId, settingsOpen, settingsSection, urlSyncTick]);

  // Cold deep-link: seeding `route` skips the fetch normal navigation would do, so
  // kick the destination's fetch once on mount. Harmless if boot also fetches it.
  useEffect(() => {
    if (!host.isWeb || !bootNav) return;
    if (bootNav.route === 'artifacts') {
      fetchArtifacts().then((d) => { if (Array.isArray(d)) setArtifacts(d); });
    } else if (bootNav.route === 'projects') {
      fetchProjects().then((d) => { if (Array.isArray(d)) setProjects(d); });
    } else if (bootNav.route === 'scheduled' || bootNav.route === 'schedule-detail') {
      fetchSchedules().then((d) => { setScheduled(d.schedules || []); setScheduleRunsIndex(d.runs_index || {}); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve a deep-linked conversation once sessions load. Only hydrate if the user
  // is STILL on the link (a late fetch mustn't yank them back); if the id never
  // appears (deleted / stale / wrong workspace), abandon it to home via a replace.
  useEffect(() => {
    if (!host.isWeb) return;
    const id = pendingTaskIdRef.current;
    if (!id) return;
    if (tasks.some((t) => t.id === id)) {
      pendingTaskIdRef.current = null;
      if (route === 'task' && activeTaskId === id) selectTask(id);
    } else if (sessionsLoaded) {
      pendingTaskIdRef.current = null;
      if (route === 'task' && activeTaskId === id) {
        forceUrlReplace();
        setActiveTaskId(null);
        setRoute('home');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, sessionsLoaded]);

  // Resolve a deep-linked project once projects load (same still-on-the-link guard).
  // selectedProject is the async-loaded object, so the first URL sync already ran
  // with it null and wrote `?view=projects`; force this restore to replace so it
  // edits that entry in place instead of pushing a phantom bare-grid step. Give up
  // if the name never loads, so a later refetch can't fire a surprise selection.
  useEffect(() => {
    if (!host.isWeb) return;
    const name = pendingProjectNameRef.current;
    if (!name) return;
    const p = projects.find((x) => x.name === name);
    if (p) {
      pendingProjectNameRef.current = null;
      if (route === 'projects' && !selectedProject) {
        forceUrlReplace();
        setSelectedProject(p);
      }
    } else if (projectsLoaded) {
      pendingProjectNameRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, projectsLoaded]);

  // Inbound: bind popstate once and dispatch through navHandlerRef so it always
  // runs the latest closure.
  useEffect(() => {
    if (!host.isWeb) return;
    const onPop = () => navHandlerRef.current();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Reassigned every render for fresh closures.
  navHandlerRef.current = () => {
    const s = parseUrlState(window.location.search);
    // Settings is an overlay orthogonal to the content route.
    if (s.settingsPane != null) openSettings(s.settingsPane || null);
    else setSettingsOpen(false);
    if (s.route === 'task') {
      // Only restore a conversation that still exists; a missing id would otherwise
      // fall through to tasks[0]. Defer if sessions haven't loaded; else go home.
      if (s.taskId && tasks.some((t) => t.id === s.taskId)) {
        selectTask(s.taskId);
      } else if (s.taskId && !sessionsLoaded) {
        pendingTaskIdRef.current = s.taskId;
        setActiveTaskId(s.taskId);
        setRoute('task');
      } else {
        forceUrlReplace();
        setActiveTaskId(null);
        setRoute('home');
      }
      return;
    }
    if (s.route === 'schedule-detail') {
      setSelectedScheduleId(s.scheduleId);
      setRoute('schedule-detail');
      return;
    }
    if (s.route === 'projects') {
      // Set the selection directly (navigate() would clear it). Defer if the list
      // hasn't loaded; the grid is the right fallback for a missing project.
      const p = s.projectName ? projects.find((x) => x.name === s.projectName) : null;
      if (p) {
        setSelectedProject(p);
      } else if (s.projectName && !projectsLoaded) {
        pendingProjectNameRef.current = s.projectName;
        forceUrlReplace();
        setSelectedProject(null);
      } else {
        setSelectedProject(null);
      }
      setRoute('projects');
      return;
    }
    navigate(s.route);
  };
}
