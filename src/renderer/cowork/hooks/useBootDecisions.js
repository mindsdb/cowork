import { useState, useEffect, useRef } from 'react';
import { host } from '../../platform/host';
import { createProject, fetchProjects } from '../api';

// One-shot, session-scoped boot decisions, keyed off the server coming
// online. These used to live inside HomeView, but the user can navigate
// (settings → home → settings) which would re-mount HomeView and re-fire
// each — App-level refs keep them app-session-level.
//
// Returns `bootIntroDone`: once the backend has been online at least once,
// the home view skips the boot choreography (orb → caret → typewriter) so a
// later "new task" click doesn't replay the "app is starting" cue.
export function useBootDecisions({
  serverOnline,
  health,
  projects,
  selectedProject,
  setServerHelpOpen,
  setSettingsSection,
  setSettingsOpen,
  setSelectedProject,
  setProjects,
}) {
  const [bootIntroDone, setBootIntroDone] = useState(false);
  useEffect(() => {
    if (serverOnline && !bootIntroDone) setBootIntroDone(true);
  }, [serverOnline, bootIntroDone]);

  // Watchdog — if the local backend never comes online, pop the help
  // modal so the user has logs / restart available. Once.
  const bootWatchdogFiredRef = useRef(false);
  useEffect(() => {
    if (serverOnline) return undefined;
    if (bootWatchdogFiredRef.current) return undefined;
    const t = setTimeout(() => {
      bootWatchdogFiredRef.current = true;
      setServerHelpOpen(true);
    }, 12_000);
    return () => clearTimeout(t);
  }, [serverOnline, setServerHelpOpen]);

  // Config redirect — server is up but config_ready is explicitly
  // false → take the user to Settings so they can finish setup.
  // Tested as `=== false` (not falsy) on purpose: we don't want to
  // route on initial undefined / pending values, only on a confirmed
  // negative from the server. Once per session.
  const bootConfigRedirectFiredRef = useRef(false);
  useEffect(() => {
    if (bootConfigRedirectFiredRef.current) return;
    if (!serverOnline) return;
    // Web sessions (mobile or desktop browser) always land on the
    // new-task composer regardless of config state. The auto-redirect
    // to Settings is Electron-only — there a missing provider means
    // the install can't reach any LLM at all. In the hosted web
    // shell, config is centralized server-side, so first-paint
    // shouldn't shove the user into a configuration screen.
    if (host.isWeb) return;
    if (health.config_ready === false) {
      bootConfigRedirectFiredRef.current = true;
      // Missing provider → land straight on the Agent (provider) section, on
      // desktop and in the mobile master-detail alike.
      setSettingsSection('agent');
      setSettingsOpen(true);
    }
  }, [serverOnline, health.config_ready, setSettingsSection, setSettingsOpen]);

  // Default the new-task project to "general". If the projects list
  // is loaded and it doesn't include "general", create it first. The
  // server provisions general on startup, so this only fires on
  // upgrades from an older build that didn't have that.
  const generalDefaultRef = useRef(false);
  useEffect(() => {
    if (selectedProject) return;        // user has picked something — don't override
    if (!serverOnline) return;          // wait for server
    if (generalDefaultRef.current) return; // only run once per session
    if (projects.length === 0) return;  // wait for projects to load
    const general = projects.find((p) => p.name === 'general');
    if (general) {
      generalDefaultRef.current = true;
      setSelectedProject(general);
      return;
    }
    // No general project — bootstrap it then re-fetch + select.
    generalDefaultRef.current = true;
    (async () => {
      try {
        await createProject('general');
        const fresh = await fetchProjects();
        if (Array.isArray(fresh)) setProjects(fresh);
        const created = (fresh || []).find((p) => p.name === 'general');
        if (created) setSelectedProject(created);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[default-project] could not bootstrap general', e);
        generalDefaultRef.current = false; // allow retry on next render
      }
    })();
  }, [projects, selectedProject, serverOnline, setSelectedProject, setProjects]);

  return bootIntroDone;
}
