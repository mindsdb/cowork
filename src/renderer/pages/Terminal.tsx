import { useEffect, useRef, useState, useCallback } from 'react';

interface Project {
  name: string;
  path: string;
}

interface TerminalInstance {
  term: any;
  fitAddon: any;
  container: HTMLDivElement;
  connected: boolean;
  streaming: boolean;
  exitCode: number | null;
}

export default function Terminal() {
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState('default');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [projectError, setProjectError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const newProjectInputRef = useRef<HTMLInputElement>(null);

  // Per-project terminal instances
  const terminalsRef = useRef<Map<string, TerminalInstance>>(new Map());
  // Force re-renders when terminal state changes
  const [, forceUpdate] = useState(0);
  const rerender = useCallback(() => forceUpdate((n) => n + 1), []);

  // Track cleanup functions for IPC listeners
  const ipcCleanupRef = useRef<(() => void) | null>(null);

  const loadProjects = useCallback(async () => {
    const [list, active] = await Promise.all([
      window.antontron.listProjects(),
      window.antontron.getActiveProject(),
    ]);
    setProjects(list);
    setActiveProject(active);
    return { list, active };
  }, []);

  // Create a terminal instance for a project
  const createTerminal = useCallback(async (projectName: string) => {
    if (terminalsRef.current.has(projectName)) return;
    if (!mainAreaRef.current) return;

    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    const { WebLinksAddon } = await import('@xterm/addon-web-links');
    await import('@xterm/xterm/css/xterm.css');

    const container = document.createElement('div');
    container.className = 'terminal-body';
    container.style.display = 'none';
    mainAreaRef.current.appendChild(container);

    const term = new Terminal({
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
      fontSize: 14,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: {
        background: '#0a0a0f',
        foreground: '#e0e0f0',
        cursor: '#00e5ff',
        cursorAccent: '#0a0a0f',
        selectionBackground: 'rgba(0, 229, 255, 0.2)',
        black: '#1a1a2e',
        red: '#ff5252',
        green: '#69f0ae',
        yellow: '#ffd740',
        blue: '#448aff',
        magenta: '#b388ff',
        cyan: '#00e5ff',
        white: '#e0e0f0',
        brightBlack: '#555577',
        brightRed: '#ff8a80',
        brightGreen: '#b9f6ca',
        brightYellow: '#ffe57f',
        brightBlue: '#82b1ff',
        brightMagenta: '#ea80fc',
        brightCyan: '#84ffff',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(container);

    const instance: TerminalInstance = {
      term,
      fitAddon,
      container,
      connected: false,
      streaming: false,
      exitCode: null,
    };

    terminalsRef.current.set(projectName, instance);

    term.onData((data: string) => {
      window.antontron.sendInput(projectName, data);
    });

    // Image paste handler
    container.addEventListener('paste', async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          e.stopPropagation();
          const blob = item.getAsFile();
          if (!blob) continue;
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = (reader.result as string).split(',')[1];
            const filePath = await window.antontron.saveClipboardImage(base64);
            window.antontron.sendInput(projectName, `/image ${filePath}\n`);
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      if (container.style.display !== 'none') {
        fitAddon.fit();
        window.antontron.resizeTerminal(projectName, term.cols, term.rows);
      }
    });
    resizeObserver.observe(container);

    return instance;
  }, []);

  // Show a specific project's terminal, hide others
  const showTerminal = useCallback((projectName: string) => {
    for (const [name, inst] of terminalsRef.current) {
      inst.container.style.display = name === projectName ? '' : 'none';
    }
    // Fit the visible one
    const active = terminalsRef.current.get(projectName);
    if (active) {
      setTimeout(() => active.fitAddon.fit(), 50);
    }
  }, []);

  // Start Anton for a project if not already running
  const ensureAntonRunning = useCallback(async (projectName: string) => {
    let instance = terminalsRef.current.get(projectName);
    if (!instance) {
      instance = await createTerminal(projectName);
    }
    if (!instance) return;

    if (!instance.connected) {
      setTimeout(() => instance!.fitAddon.fit(), 50);
      const { cols, rows } = instance.term;
      await window.antontron.startAnton(projectName, cols, rows);
      instance.connected = true;
      instance.exitCode = null;
      rerender();
    }
  }, [createTerminal, rerender]);

  // Switch to a project
  const switchProject = useCallback(async (name: string) => {
    await window.antontron.setActiveProject(name);
    setActiveProject(name);
    await ensureAntonRunning(name);
    showTerminal(name);
  }, [ensureAntonRunning, showTerminal]);

  // Restart Anton for current project
  const restartAnton = useCallback(async () => {
    const instance = terminalsRef.current.get(activeProject);
    if (!instance) return;

    // Kill if running
    window.antontron.killAnton(activeProject);
    instance.connected = false;
    instance.exitCode = null;

    // Full reset and restart
    instance.term.reset();
    setTimeout(async () => {
      instance.fitAddon.fit();
      const { cols, rows } = instance.term;
      await window.antontron.startAnton(activeProject, cols, rows);
      instance.connected = true;
      rerender();
    }, 100);
  }, [activeProject, rerender]);

  const handleCreateProject = useCallback(async () => {
    if (!newProjectName.trim()) return;
    setProjectError('');
    const result = await window.antontron.createProject(newProjectName.trim());
    if ('error' in result) {
      setProjectError(result.error);
      return;
    }
    setNewProjectName('');
    setShowNewProject(false);
    await loadProjects();
    await switchProject(result.name);
  }, [newProjectName, loadProjects, switchProject]);

  const handleDeleteProject = useCallback(async (name: string) => {
    if (name === 'default') return;
    // Kill the process for this project
    window.antontron.killAnton(name);
    // Clean up terminal instance
    const instance = terminalsRef.current.get(name);
    if (instance) {
      instance.term.dispose();
      instance.container.remove();
      terminalsRef.current.delete(name);
    }
    await window.antontron.deleteProject(name);
    await loadProjects();
    if (activeProject === name) {
      await switchProject('default');
    }
  }, [activeProject, loadProjects, switchProject]);

  useEffect(() => {
    if (showNewProject && newProjectInputRef.current) {
      newProjectInputRef.current.focus();
    }
  }, [showNewProject]);

  // Set up global IPC listeners for data/exit routed by projectName
  useEffect(() => {
    let streamTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

    const removeData = window.antontron.onAntonData((projectName, data) => {
      const instance = terminalsRef.current.get(projectName);
      if (instance) {
        instance.term.write(data);
        instance.streaming = true;
        rerender();

        const existing = streamTimeouts.get(projectName);
        if (existing) clearTimeout(existing);
        streamTimeouts.set(projectName, setTimeout(() => {
          instance.streaming = false;
          rerender();
        }, 800));
      }
    });

    const removeExit = window.antontron.onAntonExit((projectName, code) => {
      const instance = terminalsRef.current.get(projectName);
      if (instance) {
        instance.connected = false;
        instance.streaming = false;
        instance.exitCode = code;
        rerender();
      }
    });

    ipcCleanupRef.current = () => {
      removeData();
      removeExit();
      for (const t of streamTimeouts.values()) clearTimeout(t);
    };

    return () => {
      ipcCleanupRef.current?.();
    };
  }, [rerender]);

  // Initialize: load projects, create terminal for active, start Anton
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { active } = await loadProjects();
      if (cancelled) return;
      await ensureAntonRunning(active);
      showTerminal(active);
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeInstance = terminalsRef.current.get(activeProject);
  const connected = activeInstance?.connected ?? false;
  const streaming = activeInstance?.streaming ?? false;
  const exitCode = activeInstance?.exitCode ?? null;
  const showRestart = !connected && exitCode !== null;

  return (
    <div className="app-layout fade-in">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-top">
          <pre className="sidebar-logo">{`▄▀█ █▄ █ ▀█▀ █▀█ █▄ █
█▀█ █ ▀█  █  █▄█ █ ▀█`}</pre>

          <div className="sidebar-divider" />

          <div className="sidebar-section">
            <div className="sidebar-label">STATUS</div>
            <div className="sidebar-status">
              <div className={`status-dot ${connected ? '' : 'disconnected'}`} />
              <span className="sidebar-status-text">
                {connected ? (streaming ? 'Thinking...' : 'Running') : 'Stopped'}
              </span>
            </div>
            {connected && streaming && (
              <div className="thinking-bar">
                <div className="thinking-bar-fill" />
              </div>
            )}
          </div>

          <div className="sidebar-divider" />

          {/* Projects */}
          <div className="sidebar-section">
            <div className="sidebar-label">PROJECTS</div>
            <div className="project-list">
              {projects.map((p) => (
                <div
                  key={p.name}
                  className={`project-item ${p.name === activeProject ? 'active' : ''}`}
                >
                  <button
                    className="project-item-btn"
                    onClick={() => p.name !== activeProject && switchProject(p.name)}
                  >
                    <div className={`project-dot ${p.name === activeProject ? '' : 'inactive'}`} />
                    <span className="project-name">{p.name}</span>
                  </button>
                  {p.name !== 'default' && (
                    <button
                      className="project-delete"
                      onClick={(e) => { e.stopPropagation(); handleDeleteProject(p.name); }}
                      title="Delete project"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>

            {showNewProject ? (
              <div className="new-project-form">
                <input
                  ref={newProjectInputRef}
                  className="new-project-input"
                  placeholder="project name"
                  value={newProjectName}
                  onChange={(e) => { setNewProjectName(e.target.value); setProjectError(''); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateProject();
                    if (e.key === 'Escape') { setShowNewProject(false); setNewProjectName(''); setProjectError(''); }
                  }}
                />
                {projectError && <div className="new-project-error">{projectError}</div>}
              </div>
            ) : (
              <button
                className="sidebar-btn new-project-btn"
                onClick={() => setShowNewProject(true)}
              >
                <span className="sidebar-btn-icon">+</span>
                New Project
              </button>
            )}
          </div>
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-divider" />
          <button
            className="sidebar-btn"
            onClick={restartAnton}
          >
            <span className="sidebar-btn-icon">&#x21bb;</span>
            Restart
          </button>
          <button className="sidebar-btn" onClick={() => setShowSettings(true)}>
            <span className="sidebar-btn-icon">&#x2699;</span>
            Settings
          </button>
        </div>
      </div>

      {/* Main Terminal Area */}
      <div className="main-area" ref={mainAreaRef}>
        {showRestart && (
          <div className="restart-overlay">
            <div className="restart-card">
              <div className="restart-icon">&#x23fb;</div>
              <div className="restart-title">Anton has stopped</div>
              <div className="restart-subtitle">
                {exitCode === 0 ? 'Exited normally' : `Exit code ${exitCode}`}
              </div>
              <button className="btn-primary restart-btn" onClick={restartAnton}>
                RESTART
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="settings-backdrop" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <SettingsPanel onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [planningModel, setPlanningModel] = useState('claude-sonnet-4-6');
  const [codingModel, setCodingModel] = useState('claude-haiku-4-5-20251001');
  const [memoryMode, setMemoryMode] = useState('autopilot');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const lines: string[] = [];
    if (apiKey) lines.push(`ANTON_ANTHROPIC_API_KEY=${apiKey}`);
    lines.push(`ANTON_PLANNING_MODEL=${planningModel}`);
    lines.push(`ANTON_CODING_MODEL=${codingModel}`);
    lines.push(`ANTON_MEMORY_MODE=${memoryMode}`);

    window.antontron.saveSettings(lines.join('\n'));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <div className="settings-header">
        <div className="settings-title">Settings</div>
        <button className="settings-close" onClick={onClose}>&times;</button>
      </div>

      <div className="settings-body">
        <div className="settings-group">
          <label className="settings-label">Anthropic API Key</label>
          <input
            type="password"
            className="settings-input"
            placeholder="sk-ant-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div className="settings-hint">Stored in ~/.anton/.env</div>
        </div>

        <div className="settings-group">
          <label className="settings-label">Planning Model</label>
          <select
            className="settings-select"
            value={planningModel}
            onChange={(e) => setPlanningModel(e.target.value)}
          >
            <option value="claude-opus-4-6">claude-opus-4-6</option>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
            <option value="claude-haiku-4-5-20251001">claude-haiku-4-5</option>
          </select>
        </div>

        <div className="settings-group">
          <label className="settings-label">Coding Model</label>
          <select
            className="settings-select"
            value={codingModel}
            onChange={(e) => setCodingModel(e.target.value)}
          >
            <option value="claude-opus-4-6">claude-opus-4-6</option>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
            <option value="claude-haiku-4-5-20251001">claude-haiku-4-5</option>
          </select>
        </div>

        <div className="settings-group">
          <label className="settings-label">Memory Mode</label>
          <select
            className="settings-select"
            value={memoryMode}
            onChange={(e) => setMemoryMode(e.target.value)}
          >
            <option value="autopilot">Autopilot</option>
            <option value="copilot">Copilot</option>
            <option value="off">Off</option>
          </select>
        </div>
      </div>

      <div className="settings-footer">
        <button className="btn-primary settings-save" onClick={handleSave}>
          {saved ? '\u2713 SAVED' : 'SAVE'}
        </button>
      </div>
    </>
  );
}
