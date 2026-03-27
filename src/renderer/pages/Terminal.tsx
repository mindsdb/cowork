import { useEffect, useRef, useState, useCallback } from 'react';
import { marked } from 'marked';

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
  const [showMinds, setShowMinds] = useState(false);
  const [mindsStatus, setMindsStatus] = useState<{
    connected: boolean;
    mindName?: string | null;
    datasource?: string | null;
    engine?: string | null;
    url?: string;
  }>({ connected: false });
  const [confirmModal, setConfirmModal] = useState<{
    type: 'delete-project' | 'disconnect-mind';
    name: string;
  } | null>(null);
  const [renamingProject, setRenamingProject] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const newProjectInputRef = useRef<HTMLInputElement>(null);

  // Per-project terminal instances
  const terminalsRef = useRef<Map<string, TerminalInstance>>(new Map());
  // Force re-renders when terminal state changes
  const [, forceUpdate] = useState(0);
  const rerender = useCallback(() => forceUpdate((n) => n + 1), []);

  // Track cleanup functions for IPC listeners
  const ipcCleanupRef = useRef<(() => void) | null>(null);

  const refreshMindsStatus = useCallback(async () => {
    const status = await window.antontron.mindsStatus();
    setMindsStatus(status);
  }, []);

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
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: false,
      cursorStyle: 'bar',
      rightClickSelectsWord: true,
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

    // Right-click context menu
    container.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      // Remove any existing menu
      document.querySelector('.term-context-menu')?.remove();

      const menu = document.createElement('div');
      menu.className = 'term-context-menu';
      menu.style.left = `${e.clientX}px`;
      menu.style.top = `${e.clientY}px`;

      const selection = term.getSelection();

      const copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy';
      copyBtn.disabled = !selection;
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(selection);
        menu.remove();
      };

      const pasteBtn = document.createElement('button');
      pasteBtn.textContent = 'Paste';
      pasteBtn.onclick = async () => {
        const text = await navigator.clipboard.readText();
        if (text) window.antontron.sendInput(projectName, text);
        menu.remove();
      };

      const selectAllBtn = document.createElement('button');
      selectAllBtn.textContent = 'Select All';
      selectAllBtn.onclick = () => {
        term.selectAll();
        menu.remove();
      };

      menu.appendChild(copyBtn);
      menu.appendChild(pasteBtn);
      menu.appendChild(selectAllBtn);
      document.body.appendChild(menu);

      const dismiss = () => { menu.remove(); document.removeEventListener('click', dismiss); };
      setTimeout(() => document.addEventListener('click', dismiss), 0);
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

  const confirmDeleteProject = useCallback(async (name: string) => {
    if (name === 'default') return;
    window.antontron.killAnton(name);
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

  const confirmDisconnectMind = useCallback(async () => {
    await window.antontron.mindsDisconnect();
    refreshMindsStatus();
    restartAnton();
  }, [refreshMindsStatus, restartAnton]);

  const handleDataVaultConnect = useCallback(async () => {
    await ensureAntonRunning(activeProject);
    showTerminal(activeProject);
    window.antontron.sendInput(activeProject, '/connect\n');
  }, [activeProject, ensureAntonRunning, showTerminal]);

  const startRename = useCallback((name: string) => {
    setRenamingProject(name);
    setRenameValue(name);
    setRenameError('');
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingProject || !renameValue.trim()) {
      setRenamingProject(null);
      return;
    }
    if (renameValue.trim() === renamingProject) {
      setRenamingProject(null);
      return;
    }
    const result = await window.antontron.renameProject(renamingProject, renameValue.trim());
    if ('error' in result) {
      setRenameError(result.error);
      return;
    }
    // Update terminal instance key
    const instance = terminalsRef.current.get(renamingProject);
    if (instance) {
      terminalsRef.current.delete(renamingProject);
      terminalsRef.current.set(result.name, instance);
    }
    const wasActive = activeProject === renamingProject;
    setRenamingProject(null);
    await loadProjects();
    if (wasActive) {
      setActiveProject(result.name);
      showTerminal(result.name);
    }
  }, [renamingProject, renameValue, activeProject, loadProjects, showTerminal]);

  useEffect(() => {
    if (showNewProject && newProjectInputRef.current) {
      newProjectInputRef.current.focus();
    }
  }, [showNewProject]);

  useEffect(() => {
    if (renamingProject && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingProject]);

  // Set up global IPC listeners for data/exit routed by projectName
  useEffect(() => {
    let streamTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
    // Buffer PTY data and flush once per animation frame to avoid flicker
    const dataBuffers: Map<string, string[]> = new Map();
    const pendingFrames: Map<string, number> = new Map();

    const removeData = window.antontron.onAntonData((projectName, data) => {
      const instance = terminalsRef.current.get(projectName);
      if (instance) {
        let buf = dataBuffers.get(projectName);
        if (!buf) { buf = []; dataBuffers.set(projectName, buf); }
        buf.push(data);

        if (!pendingFrames.has(projectName)) {
          pendingFrames.set(projectName, requestAnimationFrame(() => {
            pendingFrames.delete(projectName);
            const chunks = dataBuffers.get(projectName);
            if (chunks && chunks.length > 0) {
              instance.term.write(chunks.join(''));
              chunks.length = 0;
            }
          }));
        }

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
      for (const f of pendingFrames.values()) cancelAnimationFrame(f);
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
      refreshMindsStatus();
      if (cancelled) return;
      await ensureAntonRunning(active);
      showTerminal(active);
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for external .env changes (e.g. /connect or /disconnect from CLI)
  useEffect(() => {
    const unsub = window.antontron.onMindsStatusChanged((status) => {
      setMindsStatus(status);
    });
    return unsub;
  }, []);

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
              <div className={`status-dot ${connected ? (streaming ? 'thinking' : '') : 'disconnected'}`} />
              <span className="sidebar-status-text">
                {connected ? 'Running' : 'Stopped'}
              </span>
            </div>
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
                  {renamingProject === p.name ? (
                    <div className="project-rename-form">
                      <input
                        ref={renameInputRef}
                        className="project-rename-input"
                        value={renameValue}
                        onChange={(e) => { setRenameValue(e.target.value); setRenameError(''); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setRenamingProject(null);
                        }}
                        onBlur={commitRename}
                      />
                      {renameError && <div className="project-rename-error">{renameError}</div>}
                    </div>
                  ) : (
                    <>
                      <button
                        className="project-item-btn"
                        onClick={() => p.name !== activeProject && switchProject(p.name)}
                        onDoubleClick={() => p.name !== 'default' && startRename(p.name)}
                      >
                        <div className={`project-dot ${p.name === activeProject ? '' : 'inactive'}`} />
                        <span className="project-name">{p.name}</span>
                      </button>
                      {p.name !== 'default' && (
                        <button
                          className="project-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmModal({ type: 'delete-project', name: p.name });
                          }}
                          title="Delete project"
                        >
                          &times;
                        </button>
                      )}
                    </>
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

          <div className="sidebar-divider" />

          {/* Data Vault */}
          <div className="sidebar-section">
            <div className="sidebar-label">DATA VAULT</div>
            <button
              className="sidebar-btn new-project-btn"
              onClick={handleDataVaultConnect}
            >
              <span className="sidebar-btn-icon">+</span>
              Connect
            </button>
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

      {/* Minds Panel */}
      {showMinds && (
        <div className="settings-backdrop" onClick={() => setShowMinds(false)}>
          <div className="settings-panel minds-panel" onClick={(e) => e.stopPropagation()}>
            <MindsPanel
              onClose={() => setShowMinds(false)}
              onStatusChange={refreshMindsStatus}
              onRestartAnton={restartAnton}
              currentStatus={mindsStatus}
            />
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="settings-backdrop" onClick={() => setConfirmModal(null)}>
          <div
            className={`confirm-modal ${confirmModal.type === 'disconnect-mind' ? 'confirm-mind' : 'confirm-project'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-accent" />
            <div className="confirm-body">
              <div className="confirm-title">
                {confirmModal.type === 'delete-project'
                  ? 'Delete Project'
                  : 'Disconnect Mind'}
              </div>
              <div className="confirm-name">{confirmModal.name}</div>
              <div className="confirm-message">
                {confirmModal.type === 'delete-project'
                  ? 'This will remove all project data and stop the running process.'
                  : 'Anton will restart without the connected mind.'}
              </div>
              <div className="confirm-actions">
                <button
                  className="confirm-cancel"
                  onClick={() => setConfirmModal(null)}
                >
                  Cancel
                </button>
                <button
                  className={`confirm-yes ${confirmModal.type === 'disconnect-mind' ? 'confirm-yes-mind' : ''}`}
                  onClick={async () => {
                    if (confirmModal.type === 'delete-project') {
                      await confirmDeleteProject(confirmModal.name);
                    } else {
                      await confirmDisconnectMind();
                    }
                    setConfirmModal(null);
                  }}
                >
                  {confirmModal.type === 'delete-project' ? 'Delete' : 'Disconnect'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [apiKeyPlaceholder, setApiKeyPlaceholder] = useState('sk-ant-...');
  const [planningModel, setPlanningModel] = useState('claude-sonnet-4-6');
  const [codingModel, setCodingModel] = useState('claude-haiku-4-5-20251001');
  const [memoryMode, setMemoryMode] = useState('autopilot');
  const [proactiveDashboards, setProactiveDashboards] = useState(false);
  const [saved, setSaved] = useState(false);
  const [existingVars, setExistingVars] = useState<Record<string, string>>({});

  // Load current settings from .env on mount
  useEffect(() => {
    (async () => {
      const vars = await window.antontron.readSettings();
      setExistingVars(vars);
      if (vars.ANTON_PLANNING_MODEL) setPlanningModel(vars.ANTON_PLANNING_MODEL);
      if (vars.ANTON_CODING_MODEL) setCodingModel(vars.ANTON_CODING_MODEL);
      if (vars.ANTON_MEMORY_MODE) setMemoryMode(vars.ANTON_MEMORY_MODE);
      if (vars.ANTON_PROACTIVE_DASHBOARDS === 'true') setProactiveDashboards(true);
      if (vars.ANTON_ANTHROPIC_API_KEY) {
        setApiKeyPlaceholder('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (unchanged)');
      }
    })();
  }, []);

  const handleSave = () => {
    // Merge: start with existing vars, override only what user changed
    const merged = { ...existingVars };
    merged.ANTON_PLANNING_MODEL = planningModel;
    merged.ANTON_CODING_MODEL = codingModel;
    merged.ANTON_MEMORY_MODE = memoryMode;
    merged.ANTON_PROACTIVE_DASHBOARDS = proactiveDashboards ? 'true' : 'false';
    // Only overwrite API key if user typed a new one
    if (apiKey) merged.ANTON_ANTHROPIC_API_KEY = apiKey;

    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
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
            placeholder={apiKeyPlaceholder}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div className="settings-hint">Leave blank to keep current key</div>
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

        <div className="settings-group">
          <label className="settings-label">Proactive Dashboards</label>
          <label className="minds-ssl-label">
            <input
              type="checkbox"
              checked={proactiveDashboards}
              onChange={(e) => setProactiveDashboards(e.target.checked)}
              className="minds-ssl-checkbox"
            />
            Build dashboards automatically
          </label>
          <div className="settings-hint">
            When enabled, Anton proactively creates charts and dashboards when data warrants it
          </div>
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

interface MindsStatus {
  connected: boolean;
  url?: string;
  apiKey?: string;
  mindName?: string | null;
  datasource?: string | null;
  engine?: string | null;
}

function MindsPanel({
  onClose,
  onStatusChange,
  onRestartAnton,
  currentStatus,
}: {
  onClose: () => void;
  onStatusChange: () => void;
  onRestartAnton: () => void;
  currentStatus: MindsStatus;
}) {
  // Steps: 'credentials' | 'select-mind' | 'select-datasource' | 'info'
  const [step, setStep] = useState<string>(currentStatus.connected ? 'info' : 'credentials');

  // Credentials
  const [url, setUrl] = useState(currentStatus.url || 'https://mdb.ai');
  const [apiKey, setApiKey] = useState(currentStatus.apiKey || '');
  const [sslVerify, setSslVerify] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Minds list
  const [minds, setMinds] = useState<any[]>([]);
  const [datasources, setDatasources] = useState<any[]>([]);

  // Selected / processing
  const [selectedMind, setSelectedMind] = useState<any>(null);
  const [connectingMind, setConnectingMind] = useState<string | null>(null);

  // Info view
  const [mindDetails, setMindDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Auto-skip to mind selection if we already have credentials (from previous connect or onboarding)
  useEffect(() => {
    if (!currentStatus.connected) {
      (async () => {
        // Check if we already have url+apiKey (e.g. after disconnect or from onboarding)
        const status = await window.antontron.mindsStatus();
        if (status.apiKey && status.url) {
          setUrl(status.url);
          setApiKey(status.apiKey);
          await fetchMinds(status.url, status.apiKey);
        }
      })();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load mind details when showing info
  useEffect(() => {
    if (step === 'info' && currentStatus.connected && currentStatus.mindName) {
      setLoadingDetails(true);
      (async () => {
        const res = await window.antontron.mindsGet(
          currentStatus.url || 'https://mdb.ai',
          currentStatus.apiKey || '',
          currentStatus.mindName!,
          sslVerify
        );
        if (res.ok) setMindDetails(res.mind);
        setLoadingDetails(false);
      })();
    }
  }, [step, currentStatus]);

  const fetchMinds = async (u: string, key: string) => {
    setLoading(true);
    setError('');
    const res = await window.antontron.mindsList(u, key, sslVerify);
    setLoading(false);
    if (!res.ok) {
      setError(res.error || 'Failed to connect');
      return false;
    }
    setMinds(res.minds || []);
    setStep('select-mind');
    return true;
  };

  const handleConnect = async () => {
    if (!url.trim() || !apiKey.trim()) return;
    await fetchMinds(url.trim(), apiKey.trim());
  };

  // Normalize datasource ref: API may return strings or {name: "..."} objects
  const dsRefName = (ref: any): string => typeof ref === 'string' ? ref : ref?.name || '';

  const finishConnect = async (mindName: string, dsName: string | null, engine: string | null) => {
    await window.antontron.mindsConnect(url, apiKey, mindName, dsName, engine, sslVerify);
    onStatusChange();
    onRestartAnton();
    onClose();
  };

  const handleSelectMind = async (mind: any) => {
    if (connectingMind) return;
    setConnectingMind(mind.name);
    setSelectedMind(mind);
    try {
      const rawDs: any[] = mind.datasources || [];
      if (rawDs.length <= 1) {
        const dsName = rawDs.length === 1 ? dsRefName(rawDs[0]) : null;
        let engine: string | null = null;
        if (dsName) {
          const dsRes = await window.antontron.mindsListDatasources(url, apiKey, sslVerify);
          if (dsRes.ok) {
            const match = (dsRes.datasources || []).find((d: any) => d.name === dsName);
            engine = match?.engine || null;
          }
        }
        await finishConnect(mind.name, dsName, engine);
      } else {
        const dsRes = await window.antontron.mindsListDatasources(url, apiKey, sslVerify);
        if (dsRes.ok) setDatasources(dsRes.datasources || []);
        setStep('select-datasource');
      }
    } finally {
      setConnectingMind(null);
    }
  };

  const handleSelectDatasource = async (dsName: string) => {
    if (connectingMind) return;
    setConnectingMind(dsName);
    try {
      const match = datasources.find((d: any) => d.name === dsName);
      const engine = match?.engine || null;
      await finishConnect(selectedMind.name, dsName, engine);
    } finally {
      setConnectingMind(null);
    }
  };

  const renderSystemPrompt = () => {
    if (!mindDetails) return null;
    const params = mindDetails.parameters || {};
    const parts: string[] = [];
    if (params.system_prompt) parts.push(params.system_prompt);
    if (params.prompt_template) parts.push(params.prompt_template);
    if (parts.length === 0) return <div className="minds-no-prompt">No system prompt configured</div>;

    const raw = parts.join('\n\n---\n\n');
    const html = marked.parse(raw, { async: false }) as string;
    return (
      <div
        className="minds-system-prompt"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  };

  return (
    <>
      <div className="settings-header">
        <div className="settings-title">
          {step === 'info' ? 'Mind Connection' : 'Connect to Mind'}
        </div>
        <button className="settings-close" onClick={onClose}>&times;</button>
      </div>

      <div className="settings-body minds-body">
        {/* Step: Credentials */}
        {step === 'credentials' && (
          <>
            <div className="settings-group">
              <label className="settings-label">Minds Server URL</label>
              <input
                className="settings-input"
                placeholder="https://mdb.ai"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="settings-group">
              <label className="settings-label">API Key</label>
              <input
                type="password"
                className="settings-input"
                placeholder="Enter your Minds API key"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
            </div>
            <div className="settings-group minds-ssl-group">
              <label className="minds-ssl-label">
                <input
                  type="checkbox"
                  checked={sslVerify}
                  onChange={(e) => setSslVerify(e.target.checked)}
                  className="minds-ssl-checkbox"
                />
                Verify SSL certificates
              </label>
              <div className="settings-hint">
                Disable if the server uses self-signed certificates
              </div>
            </div>
            {error && <div className="minds-error">{error}</div>}
          </>
        )}

        {/* Step: Select Mind */}
        {step === 'select-mind' && (
          <>
            <div className="minds-step-label">Select a Mind</div>
            <div className="minds-list">
              {minds.map((m: any) => (
                <button
                  key={m.name}
                  className={`minds-item ${connectingMind === m.name ? 'minds-item-loading' : ''}`}
                  onClick={() => handleSelectMind(m)}
                  disabled={!!connectingMind}
                >
                  <div className="minds-item-name">
                    {connectingMind === m.name ? 'Connecting...' : m.name}
                  </div>
                  <div className="minds-item-meta">
                    {connectingMind === m.name
                      ? ''
                      : `${(m.datasources || []).length} datasource${(m.datasources || []).length !== 1 ? 's' : ''}`}
                  </div>
                </button>
              ))}
              {minds.length === 0 && (
                <div className="minds-empty">No minds found on this server</div>
              )}
            </div>
          </>
        )}

        {/* Step: Select Datasource */}
        {step === 'select-datasource' && selectedMind && (
          <>
            <div className="minds-step-label">
              Select a datasource for <strong>{selectedMind.name}</strong>
            </div>
            <div className="minds-list">
              {(selectedMind.datasources || []).map((dsRef: any) => {
                const name = dsRefName(dsRef);
                const match = datasources.find((d: any) => d.name === name);
                return (
                  <button
                    key={name}
                    className={`minds-item ${connectingMind === name ? 'minds-item-loading' : ''}`}
                    onClick={() => handleSelectDatasource(name)}
                    disabled={!!connectingMind}
                  >
                    <div className="minds-item-name">
                      {connectingMind === name ? 'Connecting...' : name}
                    </div>
                    {match?.engine && !connectingMind && (
                      <div className="minds-item-meta">{match.engine}</div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Step: Info (connected) */}
        {step === 'info' && (
          <>
            <div className="minds-info-grid">
              <div className="minds-info-row">
                <span className="minds-info-label">Mind</span>
                <span className="minds-info-value">{currentStatus.mindName}</span>
              </div>
              {currentStatus.datasource && (
                <div className="minds-info-row">
                  <span className="minds-info-label">Datasource</span>
                  <span className="minds-info-value">{currentStatus.datasource}</span>
                </div>
              )}
              {currentStatus.engine && (
                <div className="minds-info-row">
                  <span className="minds-info-label">Engine</span>
                  <span className="minds-info-value">{currentStatus.engine}</span>
                </div>
              )}
              <div className="minds-info-row">
                <span className="minds-info-label">Server</span>
                <span className="minds-info-value">{currentStatus.url}</span>
              </div>
            </div>

            <div className="sidebar-divider" style={{ margin: '16px 0' }} />

            <div className="minds-step-label">System Prompt</div>
            {loadingDetails ? (
              <div className="minds-loading">Loading mind details...</div>
            ) : (
              renderSystemPrompt()
            )}
          </>
        )}
      </div>

      {(step !== 'info') && (
        <div className="settings-footer">
          {step === 'credentials' && (
            <button
              className="btn-primary settings-save"
              onClick={handleConnect}
              disabled={loading || !url.trim() || !apiKey.trim()}
            >
              {loading ? 'Connecting...' : 'CONNECT'}
            </button>
          )}
          {step === 'select-mind' && (
            <button
              className="sidebar-btn"
              onClick={() => setStep('credentials')}
            >
              Change Server
            </button>
          )}
          {step === 'select-datasource' && (
            <button
              className="sidebar-btn"
              onClick={() => setStep('select-mind')}
            >
              Back
            </button>
          )}
        </div>
      )}
    </>
  );
}
