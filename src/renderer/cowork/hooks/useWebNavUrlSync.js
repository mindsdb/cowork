import { useState, useEffect, useRef } from 'react';
import { host } from '../../platform/host';
import { parseUrlState, buildSearch, historyWriteKind } from '../lib/urlState';
import { navPatch } from '../lib/navState';

// ENG-1233 — sync the web shell's nav state to the URL and reflect refresh /
// deep-links / Back / Forward back into it. Web only; no-ops on Electron. Pure
// state<->query mapping is in lib/urlState; the nav model in lib/navState.
export function useWebNavUrlSync(nav, dispatch, deps, primitives) {
  const { route, activeTaskId, selectedProject, selectedScheduleId, settingsOpen, settingsSection } = nav;
  const { bootNav, tasks, projects, sessionsLoaded, projectsLoaded } = deps;
  const { selectTask, navigate, openSettings, ensureConversation } = primitives;

  // Current nav, readable from async callbacks whose effect closure has gone stale.
  const navRef = useRef(nav);
  navRef.current = nav;

  const firstUrlSyncRef = useRef(true);
  const prevContentSigRef = useRef(null);
  const forceReplaceRef = useRef(false);
  // Forces the outbound effect to run so it consumes forceReplaceRef even when the
  // paired dispatch is a no-op (reconciling to a state already in place) — else the
  // flag strands and later downgrades a genuine push to a replace, losing an entry.
  const [urlSyncTick, setUrlSyncTick] = useState(0);
  const forceUrlReplace = () => { forceReplaceRef.current = true; setUrlSyncTick((n) => n + 1); };

  // Deep-linked id/name awaiting its async list; seeded from the boot URL.
  const pendingTaskIdRef = useRef(bootNav?.route === 'task' ? bootNav.taskId : null);
  const pendingProjectNameRef = useRef(bootNav?.route === 'projects' ? bootNav.projectName : null);
  const resolvingTaskRef = useRef(false);

  const navHandlerRef = useRef(() => {});

  // Outbound: nav state -> query string. First write of a page life replaces (no
  // history entry on reload/deep-link); content changes push; the settings overlay
  // only replaces. Idempotent, so a popstate-driven change won't re-push.
  useEffect(() => {
    if (!host.isWeb) return;
    const isFirst = firstUrlSyncRef.current;
    firstUrlSyncRef.current = false;
    // Read-and-clear up front so the flag can't survive the unchanged-URL return.
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

  // Resolve a deep-linked conversation once sessions load — only if the user is
  // still on the link; abandon to home (replace) if the id never shows up.
  useEffect(() => {
    if (!host.isWeb) return;
    const id = pendingTaskIdRef.current;
    if (!id) return;
    if (tasks.some((t) => t.id === id)) {
      pendingTaskIdRef.current = null;
      if (route === 'task' && activeTaskId === id) selectTask(id);
    } else if (sessionsLoaded) {
      // Not in the capped session list — it may still exist (older than the list
      // window, or a shared link). Fetch it by id: ensureConversation injects it so
      // this effect re-runs into the branch above. Only abandon to home once the
      // server confirms it's gone (and only if still on the broken link).
      if (resolvingTaskRef.current) return;
      resolvingTaskRef.current = true;
      ensureConversation(id).then((task) => {
        resolvingTaskRef.current = false;
        if (task) return;
        pendingTaskIdRef.current = null;
        if (navRef.current.route === 'task' && navRef.current.activeTaskId === id) {
          forceUrlReplace();
          dispatch(navPatch({ route: 'home', activeTaskId: null }));
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, sessionsLoaded]);

  // Resolve a deep-linked project once projects load (same still-on-the-link guard).
  // Force replace so restoring the async-resolved project edits the first
  // `?view=projects` entry in place rather than pushing a phantom bare-grid step.
  // Give up if the name never loads.
  useEffect(() => {
    if (!host.isWeb) return;
    const name = pendingProjectNameRef.current;
    if (!name) return;
    const p = projects.find((x) => x.name === name);
    if (p) {
      pendingProjectNameRef.current = null;
      if (route === 'projects' && !selectedProject) {
        forceUrlReplace();
        dispatch(navPatch({ selectedProject: p }));
      }
    } else if (projectsLoaded) {
      pendingProjectNameRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, projectsLoaded]);

  // Inbound: bind popstate once, dispatch through navHandlerRef for fresh closures.
  useEffect(() => {
    if (!host.isWeb) return;
    const onPop = () => navHandlerRef.current();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  navHandlerRef.current = () => {
    const s = parseUrlState(window.location.search);
    if (s.settingsPane != null) openSettings(s.settingsPane || null);
    else dispatch(navPatch({ settingsOpen: false }));
    if (s.route === 'task') {
      // Restore only a conversation that still exists (a missing id would fall
      // through to tasks[0]); defer if sessions haven't loaded, else go home.
      if (s.taskId && tasks.some((t) => t.id === s.taskId)) {
        selectTask(s.taskId);
      } else if (s.taskId && !sessionsLoaded) {
        pendingTaskIdRef.current = s.taskId;
        dispatch(navPatch({ route: 'task', activeTaskId: s.taskId }));
      } else {
        forceUrlReplace();
        dispatch(navPatch({ route: 'home', activeTaskId: null }));
      }
      return;
    }
    if (s.route === 'schedule-detail') {
      dispatch(navPatch({ route: 'schedule-detail', selectedScheduleId: s.scheduleId }));
      return;
    }
    if (s.route === 'projects') {
      // Set the selection directly (navigate() would clear it); defer if the list
      // hasn't loaded; the grid is the right fallback for a missing project.
      const p = s.projectName ? projects.find((x) => x.name === s.projectName) : null;
      if (p) {
        dispatch(navPatch({ route: 'projects', selectedProject: p }));
      } else if (s.projectName && !projectsLoaded) {
        pendingProjectNameRef.current = s.projectName;
        forceUrlReplace();
        dispatch(navPatch({ route: 'projects', selectedProject: null }));
      } else {
        dispatch(navPatch({ route: 'projects', selectedProject: null }));
      }
      return;
    }
    navigate(s.route);
  };
}
