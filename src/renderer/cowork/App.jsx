import { useState, useEffect, useCallback, useRef } from 'react';
import Ico from './components/Icons';
// OnboardingShell removed — antontron's renderer handles terms/install/
// provider setup. The cowork app is mounted by CoworkApp.tsx only after
// those gates pass, so AppCore renders unconditionally here.
import Sidebar from './components/Sidebar';
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
import { fetchSessions, fetchProjects, fetchArtifacts, fetchSettings, fetchHealth,
         createProject, updateSettings, streamNewSession, streamMessage,
         uploadAttachments, createSnippetAttachment, createUrlAttachment, fetchProjectFiles,
         attachProjectFile, deleteAttachment, searchCowork, fetchPins, pinTask, unpinTask,
         recordTaskVisit, fetchSchedules, createSchedule, updateSchedule, deleteSchedule,
         pauseSchedule, resumeSchedule, runScheduleNow, MOCK_DATA } from './api';

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
  const [composerAttachments, setComposerAttachments] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
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
  const currentTaskProject = currentTask?.projectPath
    ? (projects.find((p) => p.path === currentTask.projectPath) || {
        id: currentTask.projectPath,
        name: currentTask.projectName || currentTask.projectPath.split('/').pop(),
        path: currentTask.projectPath,
      })
    : selectedProject;
  const currentTaskModel = currentTask?.model
    ? (models.find((m) => m.id === currentTask.model) || { id: currentTask.model, name: currentTask.model, desc: 'Configured Anton model' })
    : selectedModel;

  const selectTask = (id) => {
    const task = tasks.find((t) => t.id === id);
    if (task) {
      recordTaskVisit(task, settings.autoPin).then(() => {
        fetchPins().then((data) => setPins(data.pins || []));
        fetchSessions().then((data) => { if (Array.isArray(data)) setTasks(data); });
      }).catch(() => {});
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

  const handleRemoveAttachment = async (id) => {
    setComposerAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    try {
      await deleteAttachment(id);
    } catch {
      // The UI has already removed the pending attachment; stale server cleanup is harmless here.
    }
  };

  // Send from the home screen — creates a new session
  const handleSendFromHome = (text) => {
    const tempId = 'tmp-' + Date.now();
    const sendingAttachments = composerAttachments;
    const attachmentIds = sendingAttachments.map((attachment) => attachment.id);
    const newT = {
      id: tempId,
      title: text.length > 60 ? text.slice(0, 57) + '…' : text,
      subtitle: 'just now',
      status: 'active',
      messages: withThinkingPlaceholder([{ role: 'user', content: text, attachments: sendingAttachments }]),
      projectPath: selectedProject?.path ?? null,
      projectName: selectedProject?.name ?? null,
      model: selectedModel?.id ?? null,
      attachments: sendingAttachments,
    };
    setTasks((prev) => [newT, ...prev]);
    setActiveTaskId(tempId);
    setRoute('task');
    setComposerAttachments([]);

    let assistantContent = '';
    let resolvedId = tempId;

    streamNewSession(text, {
      projectPath: selectedProject?.path,
      model: selectedModel?.id,
      attachmentIds,
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
        setTasks((prev) => prev.map((t) => {
          if (t.id !== resolvedId && t.id !== tempId) return t;
          const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
          return { ...t, messages: [...msgs, { role: '_streaming', content: assistantContent }] };
        }));
      },
      onProgress(event, sid) {
        if (sid && sid !== resolvedId) {
          const previousId = resolvedId;
          resolvedId = sid;
          setTasks((prev) => prev.map((t) => t.id === previousId || t.id === tempId ? { ...t, id: sid } : t));
          setActiveTaskId(sid);
        }
        setTasks((prev) => prev.map((t) => {
          if (t.id !== resolvedId && t.id !== tempId) return t;
          return { ...t, messages: appendActivity(stripStreaming(t.messages), event) };
        }));
      },
      onToolResult(event, sid) {
        if (sid && sid !== resolvedId) {
          const previousId = resolvedId;
          resolvedId = sid;
          setTasks((prev) => prev.map((t) => t.id === previousId || t.id === tempId ? { ...t, id: sid } : t));
          setActiveTaskId(sid);
        }
        setTasks((prev) => prev.map((t) => {
          if (t.id !== resolvedId && t.id !== tempId) return t;
          return { ...t, messages: appendActivity(stripStreaming(t.messages), event) };
        }));
      },
      onDone(sid) {
        const finalId = sid || resolvedId;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== finalId && t.id !== resolvedId && t.id !== tempId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          return assistantContent
            ? { ...t, id: finalId, status: 'idle', messages: [...msgs, { role: 'assistant', content: assistantContent }] }
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

    const taskProjectPath = currentTask.projectPath || selectedProject?.path || null;
    const taskModel = currentTask.model || selectedModel?.id || null;

    streamMessage(id, text, {
      projectPath: taskProjectPath,
      model: taskModel,
      attachmentIds,
      onChunk(chunk) {
        assistantContent += chunk;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
          return { ...t, messages: [...msgs, { role: '_streaming', content: assistantContent }] };
        }));
      },
      onProgress(event) {
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          return { ...t, messages: appendActivity(stripStreaming(t.messages), event) };
        }));
      },
      onToolResult(event) {
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          return { ...t, messages: appendActivity(stripStreaming(t.messages), event) };
        }));
      },
      onDone() {
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          return assistantContent
            ? { ...t, status: 'idle', messages: [...msgs, { role: 'assistant', content: assistantContent }] }
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
          top: 12, left: 88,
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
        {Ico.menu(15)}
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
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
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
            onAttachFiles={handleAttachFiles}
            onAttachUrl={handleAttachUrl}
            onAttachSnippet={handleAttachSnippet}
            onAttachProjectFile={handleAttachProjectFile}
            onBrowseProjectFiles={handleBrowseProjectFiles}
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
            onBack={() => setRoute('home')}
            project={currentTaskProject}
            model={currentTaskModel}
            attachments={composerAttachments}
            onAttachFiles={handleAttachFiles}
            onAttachUrl={handleAttachUrl}
            onAttachSnippet={handleAttachSnippet}
            onAttachProjectFile={handleAttachProjectFile}
            onBrowseProjectFiles={handleBrowseProjectFiles}
            onRemoveAttachment={handleRemoveAttachment}
            onPinTask={handlePinTask}
            onUnpinTask={handleUnpinTask}
          />
        )}

        {route === 'projects' && (
          <ProjectsView
            projects={projects}
            selectedProject={selectedProject}
            onSelectProject={(p) => { setSelectedProject(p); setRoute('home'); }}
            onCreateProject={handleCreateProject}
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
