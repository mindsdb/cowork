import { useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import Ico from './components/Icons';
// OnboardingShell removed — antontron's renderer handles terms/install/
// provider setup. The cowork app is mounted by CoworkApp.tsx only after
// those gates pass, so AppCore renders unconditionally here.
import Sidebar from './components/Sidebar';
import { ConfirmModal } from './components/ConfirmModal';
import HomeView from './views/HomeView';
import ChatView from './views/ChatView';
import ProjectsView from './views/ProjectsView';
import ScheduledView from './views/ScheduledView';
import ArtifactsView from './views/ArtifactsView';
import DispatchView from './views/DispatchView';
import CustomizeView from './views/CustomizeView';
import SettingsView from './views/SettingsView';
import UtilitiesView from './views/UtilitiesView';
import SearchModal from './components/SearchModal';
import { fetchSessions, fetchSession, fetchProjects, fetchArtifacts, fetchSettings, fetchHealth,
         createProject, updateSettings, streamNewSession, streamMessage,
         uploadAttachments, createSnippetAttachment, createUrlAttachment, fetchProjectFiles,
         attachProjectFile, deleteAttachment, searchCowork, fetchPins, pinTask, unpinTask,
         recordTaskVisit, fetchSchedules, createSchedule, updateSchedule, deleteSchedule,
         pauseSchedule, resumeSchedule, runScheduleNow, fetchDatasources, MOCK_DATA,
         renameConversation, deleteConversation, moveConversation,
         deleteProject, cancelScratchpad } from './api';
import { initialStreamState, reduceStream } from './lib/responseStreamAdapter';

const ACCENT_VARS = {
  aqua:  {},
  ocean: { '--primary-700': '#276F86', '--primary-600': '#3796B3', '--primary-500': '#53AECA', '--primary-400': '#48BEE3', '--primary-300': '#71CDE9', '--primary-50': '#E2F5FD' },
  sage:  { '--primary-700': '#3D6159', '--primary-600': '#4D7A70', '--primary-500': '#5D9287', '--primary-400': '#78BAAC', '--primary-300': '#84CCBD', '--primary-50': '#D3F9F0' },
  stone: { '--primary-700': '#3A464B', '--primary-600': '#55666D', '--primary-500': '#64777E', '--primary-400': '#7D95A1', '--primary-300': '#A0BECA', '--primary-50': '#EBF2F5' },
};

const THINKING_PLACEHOLDER = 'Thinking...';

function stripStreaming(messages) {
  return messages.filter((m) => m.role !== '_streaming');
}

function removeThinkingPlaceholder(messages) {
  return messages.filter((m) => !(m.role === 'activity' && m.placeholder));
}

function withThinkingPlaceholder(messages) {
  return [
    ...removeThinkingPlaceholder(stripStreaming(messages)),
    {
      role: 'activity',
      content: THINKING_PLACEHOLDER,
      kind: 'placeholder',
      phase: 'reasoning',
      state: 'running',
      placeholder: true,
    },
  ];
}

function markActivityDone(messages) {
  return messages.map((m) => (
    m.role === 'activity' && m.state === 'running'
      ? { ...m, state: 'done' }
      : m
  ));
}

function humanizeToken(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeActivity(event) {
  if (event?.type === 'tool_result') {
    const action = humanizeToken(event.action || 'used');
    const name = humanizeToken(event.name || 'tool');
    return `${action.charAt(0).toUpperCase()}${action.slice(1)} ${name}`.trim();
  }

  const message = humanizeToken(event?.message);
  if (message) return message;

  const phase = humanizeToken(event?.phase);
  const normalizedPhase = phase.toLowerCase();
  if (normalizedPhase === 'reasoning') return THINKING_PLACEHOLDER;
  if (normalizedPhase === 'reasoning done') return 'Finished reasoning';
  if (normalizedPhase === 'context') return 'Updated context';

  return phase ? `Anton is ${phase}` : 'Anton is working';
}

function appendActivity(messages, event) {
  const content = describeActivity(event);
  const cleaned = removeThinkingPlaceholder(messages);
  const previous = cleaned[cleaned.length - 1];
  if (previous?.role === 'activity' && previous.content === content) {
    return [...cleaned.slice(0, -1), { ...previous, state: 'running' }];
  }
  return [
    ...cleaned,
    {
      role: 'activity',
      content,
      kind: event?.type || 'progress',
      phase: event?.phase || null,
      state: 'running',
    },
  ];
}

export default function App() {
  return <AppCore />;
}

function AppCore() {
  const [settings, setSettings] = useState({
    greeting: "Let's knock something off your list",
    tone: 'balanced',
    defaultModel: 'claude-sonnet-4-6',
    autoPin: true,
    showDots: true,
    accentVariant: 'aqua',
  });

  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [pins, setPins] = useState([]);
  const [connectors, setConnectors] = useState([]);
  const [composerAttachments, setComposerAttachments] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  // Pending delete confirm — task id whose delete is awaiting user
  // confirmation in the modal. null = no modal.
  const [pendingDeleteTaskId, setPendingDeleteTaskId] = useState(null);
  // Pending project delete — same pattern but for entire projects.
  const [pendingDeleteProject, setPendingDeleteProject] = useState(null);

  // Live stream control — refs to the active fetch's AbortController
  // and the latest scratchpad name so we can fire a Stop that aborts
  // both the SSE read and the in-flight scratchpad cell.
  const activeStreamCtrlRef = useRef(null);
  const activeScratchpadRef = useRef(null);

  const handleStopStream = useCallback(async () => {
    // 1) Cancel the running scratchpad (if any) so anton stops
    //    executing user code mid-cell.
    const padName = activeScratchpadRef.current;
    if (padName) {
      try { await cancelScratchpad(padName); } catch {}
    }
    // 2) Abort the SSE fetch so the renderer stops accumulating events.
    const ctrl = activeStreamCtrlRef.current;
    if (ctrl) {
      try { ctrl.abort(); } catch {}
      activeStreamCtrlRef.current = null;
    }
    activeScratchpadRef.current = null;

    // 3) Roll the streaming placeholder into a final assistant
    //    message. Drop the in-flight steps so the rail's Progress
    //    + ThinkingBlock collapse cleanly, and leave a friendly
    //    confirmation in place of any partial body text.
    const STOP_MESSAGES = [
      'Task stopped — let me know what to try next.',
      'Got it, I stepped back. Want to take another angle?',
      'Stopped here. What would you like me to do instead?',
      'Paused as requested. Ready when you are.',
      'All halted. Tell me how to proceed.',
      'Done — execution stopped on your call.',
      'Standing by. Send another prompt when you\'re ready.',
      'Task halted gracefully. What\'s next?',
    ];
    const stoppedMsg = STOP_MESSAGES[Math.floor(Math.random() * STOP_MESSAGES.length)];

    setTasks((prev) => prev.map((t) => {
      const streaming = (t.messages || []).find((m) => m.role === '_streaming');
      if (!streaming) return t;
      const others = t.messages
        .filter((m) => m.role !== '_streaming')
        .filter((m) => m.role !== 'activity'); // also clear stale activity rows
      return {
        ...t,
        status: 'idle',
        messages: [...others, {
          role: 'assistant',
          content: stoppedMsg,
          // Empty steps so Progress + ThinkingBlock stop rendering
          // for this turn — the rail returns to its idle state.
          steps: [],
          startedAt: streaming.startedAt,
        }],
      };
    }));
  }, []);

  // Per-task streaming state is derived inside ChatView (it has the
  // task object via props). Don't compute it here — `activeTaskId` is
  // declared further down and reading it before initialization throws
  // a TDZ ReferenceError at first render.
  const [models] = useState(MOCK_DATA.models);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Theme (light | dark) — persisted in localStorage so the choice
  // survives reloads. The animated background canvas (gravity-field)
  // and the body's bg colour both follow this value.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = window.localStorage.getItem('anton.theme');
      return saved === 'light' || saved === 'dark' ? saved : 'dark';
    } catch { return 'dark'; }
  });

  // Global keyboard shortcuts. Cmd/Ctrl+B toggles the sidebar,
  // Cmd/Ctrl+K opens search, Cmd/Ctrl+N starts a new task.
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'b') {
        e.preventDefault();
        setSidebarCollapsed((c) => !c);
      } else if (key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (key === 'n') {
        e.preventDefault();
        // Defined later in the function — access via closure (newTask).
        // Use a microtask to escape the read-before-define order issue.
        Promise.resolve().then(() => {
          if (typeof newTaskRef.current === 'function') newTaskRef.current();
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // After a *mouse* click on a button, drop its keyboard focus so a later
  // stray Space/Enter doesn't re-trigger that button (e.g. clicking
  // "Projects" in the sidebar shouldn't leave Space wired to it).
  // Pure keyboard navigation (Tab → Enter/Space) is untouched because we
  // only run on mouse events; :focus-visible still draws the ring for
  // genuine keyboard focus.
  useEffect(() => {
    const onMouseUp = (e) => {
      const btn = e.target instanceof Element
        ? e.target.closest('button, [role="button"]')
        : null;
      if (btn && !btn.matches('input, textarea, select, [contenteditable="true"]')) {
        requestAnimationFrame(() => { try { btn.blur(); } catch {} });
      }
    };
    document.addEventListener('mouseup', onMouseUp, true);
    return () => document.removeEventListener('mouseup', onMouseUp, true);
  }, []);

  // Latest newTask handler kept in a ref so the keydown listener — bound
  // once on mount — always invokes the up-to-date function.
  const newTaskRef = useRef(null);

  useEffect(() => {
    try { window.localStorage.setItem('anton.theme', theme); } catch {}
    // Swap body class so kit's gf-theme-* page background colour applies.
    document.body.classList.remove('gf-theme-dark', 'gf-theme-light');
    document.body.classList.add(theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
    document.body.dataset.theme = theme;
    // Tell the gravity field to swap palettes live.
    if (window.gravityField && typeof window.gravityField.setTheme === 'function') {
      window.gravityField.setTheme(theme);
    }
  }, [theme]);

  const [route, setRoute] = useState('home');         // home | task | projects | scheduled | artifacts | dispatch | customize | settings
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedModel, setSelectedModel] = useState(MOCK_DATA.models[0]);
  const [serverOnline, setServerOnline] = useState(false);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverBusyKind, setServerBusyKind] = useState('starting'); // 'starting' | 'stopping'
  const [health, setHealth] = useState({ status: 'offline', anton_available: false, config_ready: false });

  // Load data from server on mount
  const refreshData = useCallback(() => {
    fetchHealth().then((h) => {
      setHealth(h);
      setServerOnline(h.status === 'ok');
    });
    fetchSessions().then((data) => { if (Array.isArray(data)) setTasks(data); });
    fetchProjects().then((data) => { if (Array.isArray(data)) setProjects(data); });
    fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
    fetchPins().then((data) => setPins(data.pins || []));
    fetchSchedules().then((data) => setScheduled(data.schedules || []));
    fetchDatasources()
      .then((data) => setConnectors(Array.isArray(data?.connections) ? data.connections : []))
      .catch(() => setConnectors([]));
    fetchSettings().then((data) => {
      if (data && typeof data === 'object') {
        setSettings((prev) => ({ ...prev, ...data }));
        const modelId = data.defaultModel || data.planningModel;
        const m = MOCK_DATA.models.find((x) => x.id === modelId);
        setSelectedModel(m || {
          id: modelId,
          name: modelId || 'Anton model',
          desc: data.providerLabel ? `${data.providerLabel} planning model` : 'Configured Anton planning model',
        });
      }
    });
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Whenever serverOnline flips from false → true (boot finishing,
  // user manually starting, etc.), re-fetch everything. Without this,
  // the initial refreshData() on a slow-cold-boot returns empties and
  // the UI is stuck showing "configure anton" until the user cycles
  // the toggle by hand.
  const wasOnlineRef = useRef(false);
  useEffect(() => {
    if (serverOnline && !wasOnlineRef.current) {
      refreshData();
    }
    wasOnlineRef.current = serverOnline;
  }, [serverOnline, refreshData]);

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
  }, [projects, selectedProject, serverOnline]);

  // Seed server state from main's truth on first paint so the toggle
  // button reflects reality (running OR starting) even before /health
  // has returned. While main is mid-start, show the spinner; poll
  // every 600 ms until it resolves.
  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const tick = async () => {
      try {
        const info = await window.antontron?.serverInfo?.();
        if (cancelled || !info) return;
        if (typeof info.running === 'boolean') setServerOnline(info.running);
        if (info.starting) {
          setServerBusyKind('starting');
          setServerBusy(true);
          timer = setTimeout(tick, 600);
        } else {
          setServerBusy(false);
        }
      } catch {}
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const saveSettings = useCallback(async (patch = settings) => {
    const result = await updateSettings(patch);
    setSettings((prev) => ({
      ...prev,
      configReady: result.configReady ?? prev.configReady,
      configError: result.configError ?? prev.configError,
    }));
    const h = await fetchHealth();
    setHealth(h);
    setServerOnline(h.status === 'ok');
    const latest = await fetchSettings();
    if (latest && typeof latest === 'object') {
      setSettings((prev) => ({ ...prev, ...latest }));
      const modelId = latest.defaultModel || latest.planningModel;
      const m = MOCK_DATA.models.find((x) => x.id === modelId);
      setSelectedModel(m || { id: modelId, name: modelId || 'Anton model', desc: 'Configured Anton planning model' });
    }
    return result;
  }, [settings]);

  const activeTasks = tasks.filter((t) => t.status === 'active');
  const currentTask = tasks.find((t) => t.id === activeTaskId) || (route === 'task' ? tasks[0] : null);
  // Tasks belong to one project for life. Resolve via projectName
  // first (server's canonical id), then projectPath, then fall back
  // to the currently-selected project for orphans.
  const currentTaskProject = (() => {
    if (!currentTask) return selectedProject;
    if (currentTask.projectName) {
      const byName = projects.find((p) => p.name === currentTask.projectName);
      if (byName) return byName;
    }
    if (currentTask.projectPath) {
      const byPath = projects.find((p) => p.path === currentTask.projectPath);
      if (byPath) return byPath;
      return {
        id: currentTask.projectPath,
        name: currentTask.projectName || currentTask.projectPath.split('/').pop(),
        path: currentTask.projectPath,
      };
    }
    return selectedProject;
  })();
  const currentTaskModel = currentTask?.model
    ? (models.find((m) => m.id === currentTask.model) || { id: currentTask.model, name: currentTask.model, desc: 'Configured Anton model' })
    : selectedModel;

  const selectTask = (id) => {
    const task = tasks.find((t) => t.id === id);
    if (task) {
      // Record the visit for recents ordering, but never auto-pin.
      // Pin/unpin is now an explicit action via the task menu.
      recordTaskVisit(task, false).then(() => {
        fetchPins().then((data) => setPins(data.pins || []));
        fetchSessions().then((data) => { if (Array.isArray(data)) setTasks(data); });
      }).catch(() => {});

      // If this task didn't get its messages preloaded (we only fan
      // out to the recent N at startup), fetch them now so the chat
      // view doesn't render empty.
      if (!task.messages || task.messages.length === 0) {
        fetchSession(id).then((fresh) => {
          if (!fresh || !Array.isArray(fresh.messages) || fresh.messages.length === 0) return;
          setTasks((prev) => prev.map((t) =>
            t.id === id ? { ...t, messages: fresh.messages } : t
          ));
        }).catch(() => {});
      }
    }
    setComposerAttachments([]);
    setActiveTaskId(id);
    setRoute('task');
  };

  const newTask = () => {
    setActiveTaskId(null);
    setComposerAttachments([]);
    setRoute('home');
  };
  // Keep the ref synced so the Cmd/Ctrl+N keydown handler always calls
  // the latest newTask closure (which captures fresh setRoute/setTasks).
  useEffect(() => { newTaskRef.current = newTask; });

  const clearActive = useCallback(() => {
    setTasks((prev) => prev.map((t) => t.status === 'active' ? { ...t, status: 'idle' } : t));
  }, []);

  const navigate = (key) => {
    if (key === 'artifacts') {
      fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
    }
    if (key === 'projects') {
      fetchProjects().then((data) => { if (Array.isArray(data)) setProjects(data); });
      // Clicking "Projects" in the sidebar should always land on the
      // grid of all projects, not the previously-selected project's
      // detail. Clear the selection so ProjectsView starts in grid
      // mode. The chat-header crumb routes through onOpenProject
      // (which sets selectedProject AFTER routing) so it's unaffected.
      setSelectedProject(null);
    }
    if (key === 'scheduled') {
      fetchSchedules().then((data) => setScheduled(data.schedules || []));
    }
    setRoute(key);
  };

  const attachmentProjectPath = currentTask?.projectPath || selectedProject?.path || null;
  const attachmentSessionId = route === 'task' && currentTask && !String(currentTask.id).startsWith('tmp-') ? currentTask.id : null;

  const handleAttachFiles = async (files) => {
    const data = await uploadAttachments(files, { projectPath: attachmentProjectPath, sessionId: attachmentSessionId });
    setComposerAttachments((prev) => [...prev, ...(data.attachments || [])]);
  };

  const handleAttachUrl = async (url) => {
    const data = await createUrlAttachment({ url, project_path: attachmentProjectPath, session_id: attachmentSessionId });
    setComposerAttachments((prev) => [...prev, data.attachment]);
  };

  const handleAttachSnippet = async ({ title, content }) => {
    const data = await createSnippetAttachment({ title, content, project_path: attachmentProjectPath, session_id: attachmentSessionId });
    setComposerAttachments((prev) => [...prev, data.attachment]);
  };

  const handleBrowseProjectFiles = async (query) => {
    if (!attachmentProjectPath) return { files: [] };
    return fetchProjectFiles(attachmentProjectPath, query);
  };

  const handleAttachProjectFile = async (path) => {
    const data = await attachProjectFile({ project_path: attachmentProjectPath, path, session_id: attachmentSessionId });
    setComposerAttachments((prev) => [...prev, data.attachment]);
  };

  const handleAttachConnector = async (connector) => {
    const label = connector.displayName || connector.engine;
    const title = `Connector · ${connector.name}`;
    const content = `Use the "${connector.name}" datasource (${label}) for this task. Connection metadata is loaded from the local data vault.`;
    const data = await createSnippetAttachment({
      title,
      content,
      project_path: attachmentProjectPath,
      session_id: attachmentSessionId,
    });
    const attachment = data?.attachment ? { ...data.attachment, kind: 'connector', name: connector.name } : null;
    if (attachment) setComposerAttachments((prev) => [...prev, attachment]);
  };

  const handleRemoveAttachment = async (id) => {
    setComposerAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    try {
      await deleteAttachment(id);
    } catch {
      // The UI has already removed the pending attachment; stale server cleanup is harmless here.
    }
  };

  // Send from the home screen — creates a new session
  const handleSendFromHome = async (text) => {
    const tempId = 'tmp-' + Date.now();
    const sendingAttachments = composerAttachments;
    const attachmentIds = sendingAttachments.map((attachment) => attachment.id);
    // Orphan fallback: if the user hasn't picked a project, route the
    // task into "general" (server provisions it on startup). If for
    // any reason it isn't in the projects list yet (e.g. an upgrade
    // from a build that didn't auto-create it), bootstrap it now.
    let generalProject = projects.find((p) => p.name === 'general');
    if (!selectedProject && !generalProject) {
      try {
        await createProject('general');
        const fresh = await fetchProjects();
        if (Array.isArray(fresh)) setProjects(fresh);
        generalProject = (fresh || []).find((p) => p.name === 'general');
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[handleSendFromHome] could not bootstrap general project', e);
      }
    }
    const effectiveProjectName = selectedProject?.name || 'general';
    const effectiveProjectPath = selectedProject?.path || generalProject?.path || null;

    // Two-phase send so the new-task experience matches the in-chat
    // send. Previously we shipped the user message + placeholder in the
    // very same frame as the route change, which meant the activity
    // placeholder (filtered out of the chat scroll, only visible in the
    // rail) flashed in then vanished as soon as the first stream event
    // replaced it with a still-empty `_streaming` row. Now:
    //   1. Create an EMPTY task shell + route to it. ChatView mounts
    //      cleanly with no messages.
    //   2. On the next animation frame (after the chat view commits),
    //      add the user message + thinking placeholder, then kick the
    //      stream. From that point the flow is identical to
    //      handleSendInTask.
    const newT = {
      id: tempId,
      title: text.length > 60 ? text.slice(0, 57) + '…' : text,
      subtitle: 'just now',
      status: 'active',
      messages: [],
      projectPath: effectiveProjectPath,
      projectName: effectiveProjectName,
      model: selectedModel?.id ?? null,
      attachments: sendingAttachments,
    };
    setTasks((prev) => [newT, ...prev]);
    setActiveTaskId(tempId);
    setRoute('task');
    setComposerAttachments([]);

    let assistantContent = '';
    let resolvedId = tempId;
    // Adapter state — folded by every raw SSE event so the streaming
    // message can carry structured ThinkingStep[] for the UI.
    let streamState = initialStreamState();

    const flushStreamingMessage = () => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== resolvedId && t.id !== tempId) return t;
        const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
        return { ...t, messages: [...msgs, {
          role: '_streaming',
          content: streamState.bodyText || assistantContent,
          steps: streamState.steps,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
        }] };
      }));
    };

    // Phase 2 — runs after ChatView has mounted with the empty task.
    // Append the user message + thinking placeholder, then start the
    // stream. Two RAFs give React a guaranteed paint between phases
    // (one to commit the route+task, one to commit the empty mount).
    const startConversation = () => {
      setTasks((prev) => prev.map((t) =>
        t.id === tempId
          ? {
              ...t,
              messages: withThinkingPlaceholder([
                { role: 'user', content: text, attachments: sendingAttachments },
              ]),
            }
          : t,
      ));
      activeStreamCtrlRef.current = streamNewSessionFn();
    };
    const streamNewSessionFn = () => streamNewSession(text, {
      projectName: effectiveProjectName,
      projectPath: effectiveProjectPath,
      model: selectedModel?.id,
      attachmentIds,
      onEvent(ev) {
        streamState = reduceStream(streamState, ev);
        // Track latest in-progress scratchpad so the Stop button
        // can cancel anton's current cell, not just abort our stream.
        const open = streamState.steps.find((s) => s.status === 'in_progress' && s._isScratchpad);
        if (open?._scratchpadTabId) activeScratchpadRef.current = open._scratchpadTabId;
        flushSync(() => flushStreamingMessage());
      },
      onChunk(chunk, sid) {
        if (sid && sid !== resolvedId) {
          const previousId = resolvedId;
          resolvedId = sid;
          setTasks((prev) => prev.map((t) =>
            t.id === previousId || t.id === tempId
              ? { ...t, id: sid }
              : t,
          ));
          setActiveTaskId(sid);
        }
        assistantContent += chunk;
        // The adapter already accumulates bodyText; the chunk callback
        // remains the source of truth for resolving conversation id.
      },
      onProgress(event, sid) {
        // Track the resolved conversation id (in case onChunk hasn't
        // run yet for this stream — onChunk does the same dance).
        if (sid && sid !== resolvedId) {
          const previousId = resolvedId;
          resolvedId = sid;
          setTasks((prev) => prev.map((t) => t.id === previousId || t.id === tempId ? { ...t, id: sid } : t));
          setActiveTaskId(sid);
        }
        // Intentionally a no-op for messages: every `response.in_progress`
        // event already passed through onEvent → flushStreamingMessage,
        // which is the source of truth for the streaming row + steps.
        // The previous implementation appended an `activity` row here
        // and stripped the `_streaming` row in the process — but the
        // chat scroll filters activity rows out (they're never visible)
        // while losing the streaming row blanked the AnswerTurn until
        // the body deltas started.
      },
      onToolResult(event, sid) {
        if (sid && sid !== resolvedId) {
          const previousId = resolvedId;
          resolvedId = sid;
          setTasks((prev) => prev.map((t) => t.id === previousId || t.id === tempId ? { ...t, id: sid } : t));
          setActiveTaskId(sid);
        }
        // See onProgress comment — same reasoning. The adapter (via
        // onEvent) captures scratchpad results into the steps array.
      },
      onDone(sid) {
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        const finalId = sid || resolvedId;
        const finalContent = streamState.bodyText || assistantContent;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== finalId && t.id !== resolvedId && t.id !== tempId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          return finalContent
            ? { ...t, id: finalId, status: 'idle', messages: [...msgs, {
                role: 'assistant',
                content: finalContent,
                steps: finalSteps,
                startedAt: finalStartedAt,
              }] }
            : { ...t, id: finalId, status: 'idle', messages: msgs };
        }));
        setActiveTaskId(finalId);
        fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
      },
      onError(message, event) {
        setTasks((prev) => prev.map((t) => {
          if (t.id !== resolvedId && t.id !== tempId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          return { ...t, status: 'error', messages: [...msgs, { role: 'error', content: message || 'Anton could not complete this task.', code: event?.code }] };
        }));
        fetchHealth().then((h) => setHealth(h));
      },
    });

    // Schedule phase 2 after ChatView has had a chance to mount and
    // paint with the empty task. Two RAFs is the safest pattern: the
    // first fires after React commits the route change; the second
    // fires after the browser has painted that commit. Only then do
    // we add the user message + thinking placeholder and start the
    // SSE stream — same shape as handleSendInTask from that point on.
    requestAnimationFrame(() => requestAnimationFrame(startConversation));
  };

  // Send inside an existing task
  const handleSendInTask = (text) => {
    if (!currentTask) return;
    const id = currentTask.id;
    const sendingAttachments = composerAttachments;
    const attachmentIds = sendingAttachments.map((attachment) => attachment.id);

    setTasks((prev) => prev.map((t) =>
      t.id === id
        ? {
            ...t,
            status: 'active',
            attachments: [...(t.attachments || []), ...sendingAttachments],
            messages: withThinkingPlaceholder([...t.messages, { role: 'user', content: text, attachments: sendingAttachments }]),
          }
        : t,
    ));
    setComposerAttachments([]);

    let assistantContent = '';
    let streamState = initialStreamState();

    // The task's project is fixed at creation; never let the user's
    // current selectedProject override it on later turns. Resolve from
    // the task itself (projectName is the canonical id, projectPath is
    // the resolved filesystem path used for things like attachments).
    const taskProjectName = currentTask.projectName
      || (currentTaskProject?.name)
      || null;
    const taskProjectPath = currentTask.projectPath
      || currentTaskProject?.path
      || null;
    const taskModel = currentTask.model || selectedModel?.id || null;

    const flushStreaming = () => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t;
        const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
        return { ...t, messages: [...msgs, {
          role: '_streaming',
          content: streamState.bodyText || assistantContent,
          steps: streamState.steps,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
        }] };
      }));
    };

    activeStreamCtrlRef.current = streamMessage(id, text, {
      projectName: taskProjectName,
      projectPath: taskProjectPath,
      model: taskModel,
      attachmentIds,
      onEvent(ev) {
        streamState = reduceStream(streamState, ev);
        const open = streamState.steps.find((s) => s.status === 'in_progress' && s._isScratchpad);
        if (open?._scratchpadTabId) activeScratchpadRef.current = open._scratchpadTabId;
        flushSync(() => flushStreaming());
      },
      onChunk(chunk) {
        // The adapter accumulates bodyText already; this callback is
        // redundant for content but cheap and useful as a fallback if
        // the adapter ever fails to parse a delta.
        assistantContent += chunk;
      },
      onDone() {
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        const finalContent = streamState.bodyText || assistantContent;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          return finalContent
            ? { ...t, status: 'idle', messages: [...msgs, {
                role: 'assistant',
                content: finalContent,
                steps: finalSteps,
                startedAt: finalStartedAt,
              }] }
            : { ...t, status: 'idle', messages: msgs };
        }));
        fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
      },
      onError(message, event) {
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          return { ...t, status: 'error', messages: [...msgs, { role: 'error', content: message || 'Anton could not complete this task.', code: event?.code }] };
        }));
        fetchHealth().then((h) => setHealth(h));
      },
    });
  };

  const setSetting = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleCreateProject = async ({ name }) => {
    const project = await createProject(name);
    const latest = await fetchProjects();
    if (Array.isArray(latest)) {
      setProjects(latest);
      const selected = latest.find((p) => p.name === project.name) || project;
      setSelectedProject(selected);
    }
    setRoute('projects');
    return project;
  };

  const handlePinTask = async (task) => {
    await pinTask(task);
    setTasks((prev) => prev.map((item) => item.id === task.id ? { ...item, pinned: true } : item));
    const data = await fetchPins();
    setPins(data.pins || []);
  };

  const handleUnpinTask = async (id) => {
    await unpinTask(id);
    setTasks((prev) => prev.map((item) => item.id === id ? { ...item, pinned: false } : item));
    const data = await fetchPins();
    setPins(data.pins || []);
  };

  const handleRenameTask = async (taskId, newTitle) => {
    if (!newTitle?.trim()) return;
    const next = newTitle.trim();
    // Optimistic update — flip back if the server rejects.
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, title: next } : t));
    try {
      await renameConversation(taskId, next);
    } catch {
      // Reload from server on failure to recover the canonical title.
      const fresh = await fetchSessions();
      if (Array.isArray(fresh)) setTasks(fresh);
    }
  };

  // Two-step delete: open the confirm modal, run the actual delete
  // when the user confirms. Replaces the native window.confirm so the
  // dialog matches the rest of the UX.
  const handleDeleteTask = (taskId) => {
    // eslint-disable-next-line no-console
    console.log('[handleDeleteTask] open confirm for', taskId);
    setPendingDeleteTaskId(taskId);
  };
  const performDeleteTask = async (taskId) => {
    if (!taskId) return;
    // eslint-disable-next-line no-console
    console.log('[performDeleteTask] confirmed', taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    if (activeTaskId === taskId) {
      setActiveTaskId(null);
      setRoute('home');
    }
    // Skip the server call for tasks that never got persisted (still
    // wearing a tmp- id from before the first stream chunk arrived).
    if (typeof taskId === 'string' && taskId.startsWith('tmp-')) {
      // eslint-disable-next-line no-console
      console.log('[performDeleteTask] tempId — local-only delete');
      return;
    }
    try {
      await deleteConversation(taskId);
      // eslint-disable-next-line no-console
      console.log('[performDeleteTask] server delete ok');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[performDeleteTask] server delete failed', e);
    }
    fetchPins().then((data) => setPins(data.pins || [])).catch(() => {});
  };

  const handleDeleteProject = (project) => {
    if (!project?.name) return;
    setPendingDeleteProject(project);
  };
  const performDeleteProject = async (project) => {
    if (!project?.name) return;
    // Optimistic — drop locally before the round-trip.
    setProjects((prev) => prev.filter((p) => p.name !== project.name));
    setTasks((prev) => prev.filter((t) =>
      t.projectName !== project.name && t.projectPath !== project.path
    ));
    if (selectedProject?.name === project.name) setSelectedProject(null);
    try { await deleteProject(project.name); } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[performDeleteProject] failed', e);
    }
    // Refresh from server to recover the canonical state.
    fetchProjects().then((data) => { if (Array.isArray(data)) setProjects(data); }).catch(() => {});
    fetchSessions().then((data) => { if (Array.isArray(data)) setTasks(data); }).catch(() => {});
  };

  const handleMoveTaskToProject = async (taskId, projectName) => {
    // eslint-disable-next-line no-console
    console.log('[handleMoveTaskToProject]', taskId, '→', projectName);
    if (!projectName) return;
    setTasks((prev) => prev.map((t) =>
      t.id === taskId
        ? { ...t, projectName, projectPath: projects.find((p) => p.name === projectName)?.path || t.projectPath }
        : t
    ));
    try {
      await moveConversation(taskId, projectName);
      // eslint-disable-next-line no-console
      console.log('[handleMoveTaskToProject] server move ok');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[handleMoveTaskToProject] server move failed', e);
    }
    // Refresh sessions so the server's canonical project mapping wins
    // if our optimistic guess was wrong.
    const fresh = await fetchSessions();
    if (Array.isArray(fresh)) setTasks(fresh);
  };

  const refreshSchedules = async () => {
    const data = await fetchSchedules();
    setScheduled(data.schedules || []);
  };

  const handleCreateSchedule = async (payload) => {
    await createSchedule(payload);
    await refreshSchedules();
  };

  const handleUpdateSchedule = async (id, payload) => {
    await updateSchedule(id, payload);
    await refreshSchedules();
  };

  const handleDeleteSchedule = async (id) => {
    await deleteSchedule(id);
    await refreshSchedules();
  };

  const handlePauseSchedule = async (id) => {
    await pauseSchedule(id);
    await refreshSchedules();
  };

  const handleResumeSchedule = async (id) => {
    await resumeSchedule(id);
    await refreshSchedules();
  };

  const handleRunScheduleNow = async (id) => {
    await runScheduleNow(id);
    await refreshSchedules();
    refreshData();
  };

  const handleSearchSelect = (result) => {
    if (result.type === 'task' || (result.type === 'pin' && result.route === 'task')) {
      selectTask(result.id);
    } else if (result.type === 'project') {
      const project = projects.find((p) => p.name === result.id || p.path === result.id);
      if (project) setSelectedProject(project);
      setRoute('projects');
    } else if (result.type === 'attachment' && result.sessionId) {
      selectTask(result.sessionId);
    } else if (result.type === 'schedule') {
      setRoute('scheduled');
    } else {
      setRoute('artifacts');
    }
  };

  const { showDots, accentVariant } = settings;
  const accentCss = ACCENT_VARS[accentVariant] || {};
  // appStyle + mainBg deliberately transparent so the gravity-field
  // canvas painted behind the React root is the visible background.
  // Individual views can supply their own surface (HomeView is fully
  // transparent — the greeting + composer float over the field;
  // dense views like Settings get a subtle frosted overlay below).
  const appStyle = { width: '100vw', height: '100vh', background: 'transparent' };

  const mainBg = 'transparent';
  const modelOptions = selectedModel && !models.some((m) => m.id === selectedModel.id)
    ? [selectedModel, ...models]
    : models;

  return (
    <div style={{
      ...appStyle, ...accentCss,
      display: 'flex', gap: 9, padding: 9,
      position: 'relative',
      // Make the whole window draggable. Buttons/inputs/textareas stay
      // clickable via the global `no-drag` rule in globals.css. Scrollable
      // surfaces, <main>, the composer, etc. opt out below so they don't
      // intercept drag on their own surface.
      WebkitAppRegion: 'drag',
    }}>
      {/*
        Floating hamburger — visible when the sidebar is collapsed. Sits
        right of the macOS traffic lights (window-x=14, so left=88 clears
        them). Always mounted so it can fade in/out instead of popping —
        opacity + a small translate matched to the sidebar's spring easing
        produces a single coordinated transition across both elements.
      */}
      <button
        onClick={() => setSidebarCollapsed(false)}
        title="Open sidebar"
        className="icon-btn"
        style={{
          position: 'absolute',
          // Mirror the sidebar's collapse-icon position exactly so when
          // the sidebar slides out, this hamburger appears in the same
          // spot. Sidebar lives inside the 9px cowork shell padding,
          // and its chrome row has padding-left: 88 → button at x:97.
          top: 18, left: 97,
          zIndex: 10,
          WebkitAppRegion: 'no-drag',
          opacity: sidebarCollapsed ? 1 : 0,
          transform: sidebarCollapsed ? 'translateX(0)' : 'translateX(-8px)',
          pointerEvents: sidebarCollapsed ? 'auto' : 'none',
          transition:
            'opacity 280ms cubic-bezier(0.32, 0.72, 0, 1) ' +
              `${sidebarCollapsed ? '120ms' : '0ms'}, ` +
            'transform 360ms cubic-bezier(0.32, 0.72, 0, 1) ' +
              `${sidebarCollapsed ? '80ms' : '0ms'}`,
        }}
      >
        {Ico.sidebarExpandRight(15)}
      </button>

      <Sidebar
        tasks={tasks}
        pins={pins}
        scheduledCount={scheduled.length}
        activeRoute={route === 'task' ? null : route}
        activeTaskId={activeTaskId}
        serverOnline={serverOnline}
        onNavigate={navigate}
        onSelectTask={selectTask}
        onNewTask={newTask}
        onOpenSearch={() => setSearchOpen(true)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        onPinTask={handlePinTask}
        onUnpinTask={handleUnpinTask}
        onRenameTask={handleRenameTask}
        onDeleteTask={handleDeleteTask}
        onMoveTaskToProject={handleMoveTaskToProject}
        projects={projects}
        serverBusy={serverBusy}
        serverBusyKind={serverBusyKind}
        onToggleServer={async () => {
          if (serverBusy) return;
          // Decide intent from main's actual state, not renderer state.
          // Treat "running OR mid-start" as up so a click during boot
          // stops the in-flight start instead of double-spawning python.
          let actuallyRunning = serverOnline;
          let actuallyStarting = false;
          try {
            const info = await window.antontron?.serverInfo?.();
            if (info) {
              if (typeof info.running === 'boolean') actuallyRunning = info.running;
              if (typeof info.starting === 'boolean') actuallyStarting = info.starting;
            }
          } catch {}
          const isUp = actuallyRunning || actuallyStarting;
          const goingUp = !isUp;
          setServerBusyKind(goingUp ? 'starting' : 'stopping');
          setServerBusy(true);
          try {
            const result = goingUp
              ? await window.antontron?.serverStart?.()
              : await window.antontron?.serverStop?.();
            if (result) {
              setServerOnline(!!result.running);
              if (result.running) setTimeout(refreshData, 400);
            }
          } catch {} finally {
            setServerBusy(false);
          }
        }}
      />

      <main style={{
        flex: 1, minWidth: 0, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        background: mainBg,
      }}>
        {route === 'home' && (
          <HomeView
            greeting={settings.greeting}
            showDots={showDots}
            activeTasks={activeTasks}
            onSelectTask={selectTask}
            onClearActive={clearActive}
            onSend={handleSendFromHome}
            project={selectedProject}
            onProjectChange={setSelectedProject}
            model={selectedModel}
            onModelChange={setSelectedModel}
            projects={projects}
            models={modelOptions}
            attachments={composerAttachments}
            connectors={connectors}
            onAttachFiles={handleAttachFiles}
            onAttachConnector={handleAttachConnector}
            onRemoveAttachment={handleRemoveAttachment}
            configReady={health.config_ready ?? settings.configReady}
            configError={health.config_error ?? settings.configError}
            onOpenSettings={() => setRoute('settings')}
          />
        )}

        {route === 'task' && currentTask && (
          <ChatView
            task={currentTask}
            onSend={handleSendInTask}
            onBack={() => {
              // Returning home = "new task in this project". Pre-select
              // the task's project so the home composer is ready to go.
              if (currentTaskProject) setSelectedProject(currentTaskProject);
              setRoute('home');
            }}
            project={currentTaskProject}
            model={currentTaskModel}
            attachments={composerAttachments}
            connectors={connectors}
            onAttachFiles={handleAttachFiles}
            onAttachConnector={handleAttachConnector}
            onRemoveAttachment={handleRemoveAttachment}
            onPinTask={handlePinTask}
            onUnpinTask={handleUnpinTask}
            onRenameTask={handleRenameTask}
            onDeleteTask={handleDeleteTask}
            onMoveTaskToProject={handleMoveTaskToProject}
            onStop={handleStopStream}
            onOpenProject={(p) => {
              if (p) setSelectedProject(p);
              setRoute('projects');
            }}
            onOpenProjectsList={() => {
              // "Projects" crumb → projects grid view (no specific
              // project selected). Clearing selectedProject ensures
              // ProjectsView starts in grid mode rather than detail.
              setSelectedProject(null);
              setRoute('projects');
            }}
            projects={projects}
            sidebarCollapsed={sidebarCollapsed}
          />
        )}

        {route === 'projects' && (
          <ProjectsView
            projects={projects}
            selectedProject={selectedProject}
            tasks={tasks}
            scheduled={scheduled}
            models={modelOptions}
            onSelectProject={(p) => setSelectedProject(p)}
            onCreateProject={handleCreateProject}
            onSendInProject={(text) => {
              // Sending from project detail = same as home, but with
              // selectedProject already pinned to this project.
              handleSendFromHome(text);
            }}
            onSelectTask={selectTask}
            onDeleteTask={handleDeleteTask}
            onDeleteProject={handleDeleteProject}
          />
        )}

        {route === 'scheduled' && (
          <ScheduledView
            scheduled={scheduled}
            projects={projects}
            models={modelOptions}
            selectedProject={selectedProject}
            selectedModel={selectedModel}
            onCreate={handleCreateSchedule}
            onUpdate={handleUpdateSchedule}
            onDelete={handleDeleteSchedule}
            onPause={handlePauseSchedule}
            onResume={handleResumeSchedule}
            onRunNow={handleRunScheduleNow}
          />
        )}

        {route === 'artifacts' && (
          <ArtifactsView artifacts={artifacts} />
        )}

        {route === 'dispatch' && (
          <DispatchView onSetUpLater={() => setRoute('home')} />
        )}

        {route === 'customize' && (
          <CustomizeView onOpenSettings={() => setRoute('settings')} />
        )}

        {route === 'settings' && (
          <SettingsView settings={settings} setSetting={setSetting} onSave={saveSettings} theme={theme} onThemeChange={setTheme} />
        )}

        {['memory', 'skills', 'connect', 'publish'].includes(route) && (
          <UtilitiesView
            kind={route}
            project={selectedProject}
            onRefreshArtifacts={() => fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); })}
          />
        )}
      </main>
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={searchCowork}
        onSelect={handleSearchSelect}
      />

      <ConfirmModal
        open={pendingDeleteTaskId != null}
        title="Delete this task?"
        message="The conversation history and any per-task scratchpad cells will be removed. This can't be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onClose={() => setPendingDeleteTaskId(null)}
        onConfirm={async () => {
          const id = pendingDeleteTaskId;
          setPendingDeleteTaskId(null);
          await performDeleteTask(id);
        }}
      />

      <ConfirmModal
        open={pendingDeleteProject != null}
        title={`Delete project "${pendingDeleteProject?.name}"?`}
        message="All conversations, scratchpad output, memory, and artifacts under this project will be removed from disk. This can't be undone."
        confirmLabel="Delete project"
        cancelLabel="Keep"
        destructive
        onClose={() => setPendingDeleteProject(null)}
        onConfirm={async () => {
          const p = pendingDeleteProject;
          setPendingDeleteProject(null);
          await performDeleteProject(p);
        }}
      />

      {/* Floating theme toggle (bottom-right). Lives outside the sidebar so
          it's always reachable, including when the sidebar is collapsed. */}
      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label="Toggle colour theme"
        className="floating-theme-toggle"
        style={{ WebkitAppRegion: 'no-drag' }}
      >
        {theme === 'dark' ? Ico.sun(15) : Ico.moon(15)}
      </button>
    </div>
  );
}
