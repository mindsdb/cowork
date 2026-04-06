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
  const [uiVersion, setUIVersion] = useState<string | null>(null);
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
  const [vaultConnections, setVaultConnections] = useState<{ engine: string; name: string; created_at: string }[]>([]);
  const [editingConnection, setEditingConnection] = useState<{ engine: string; name: string } | null>(null);
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

  const refreshVault = useCallback(async () => {
    const conns = await window.antontron.vaultList();
    setVaultConnections(conns);
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
    // Fit and focus the visible one
    const active = terminalsRef.current.get(projectName);
    if (active) {
      setTimeout(() => {
        active.fitAddon.fit();
        active.term.focus();
      }, 50);
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
      refreshVault();
      if (cancelled) return;
      await ensureAntonRunning(active);
      showTerminal(active);
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch vault directory for changes from CLI (/connect, /disconnect)
  useEffect(() => {
    const unsub = window.antontron.onVaultChanged(() => {
      refreshVault();
    });
    return unsub;
  }, [refreshVault]);

  // Listen for external .env changes (e.g. /connect or /disconnect from CLI)
  useEffect(() => {
    const unsub = window.antontron.onMindsStatusChanged((status) => {
      setMindsStatus(status);
    });
    return unsub;
  }, []);

  // Fetch UI version on mount
  useEffect(() => {
    window.antontron.getUIVersion().then((info) => {
      setUIVersion(info.ui);
    }).catch(() => {});
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
            {vaultConnections.length > 0 && (
              <div className="project-list">
                {vaultConnections.map((c) => (
                  <div key={`${c.engine}-${c.name}`} className="project-item">
                    <button
                      className="project-item-btn"
                      onClick={() => setEditingConnection({ engine: c.engine, name: c.name })}
                    >
                      <div className="vault-engine-dot" />
                      <span className="vault-conn-name">
                        <span className="vault-engine">{c.engine}</span>
                        <span className="vault-name">({c.name})</span>
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              className="sidebar-btn new-project-btn"
              onClick={handleDataVaultConnect}
            >
              <span className="sidebar-btn-icon">+</span>
              Add Datasource
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
          {uiVersion && uiVersion !== 'bundled' && (
            <div className="sidebar-version">UI {uiVersion}</div>
          )}
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

      {/* Vault Connection Editor */}
      {editingConnection && (
        <div className="settings-backdrop" onClick={() => setEditingConnection(null)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <VaultEditor
              engine={editingConnection.engine}
              name={editingConnection.name}
              activeProject={activeProject}
              ensureAntonRunning={ensureAntonRunning}
              onClose={() => setEditingConnection(null)}
              onDone={() => { refreshVault(); setEditingConnection(null); }}
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

type LLMProvider = 'minds' | 'anthropic' | 'openai';

const ANTHROPIC_MODELS_SETTINGS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

const OPENAI_MODELS_SETTINGS = [
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'o3', label: 'o3' },
  { id: 'o4-mini', label: 'o4 Mini' },
];

function detectProvider(vars: Record<string, string>): LLMProvider {
  if (vars.ANTON_MINDS_ENABLED === 'true') return 'minds';
  if (vars.ANTON_PLANNING_PROVIDER === 'anthropic') return 'anthropic';
  return 'openai';
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [llmProvider, setLlmProvider] = useState<LLMProvider>('minds');
  const [apiKey, setApiKey] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [mindsUrl, setMindsUrl] = useState('https://mdb.ai');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [customModel, setCustomModel] = useState('');
  const [memoryMode, setMemoryMode] = useState('autopilot');
  const [proactiveDashboards, setProactiveDashboards] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [saved, setSaved] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [openSection, setOpenSection] = useState<string>('llm');
  const [existingVars, setExistingVars] = useState<Record<string, string>>({});

  const models = llmProvider === 'anthropic' ? ANTHROPIC_MODELS_SETTINGS : OPENAI_MODELS_SETTINGS;
  const resolvedModel = model === '__custom__' ? customModel.trim() : model;

  useEffect(() => {
    (async () => {
      const vars = await window.antontron.readSettings();
      setExistingVars(vars);

      const detected = detectProvider(vars);
      setLlmProvider(detected);

      if (vars.ANTON_MINDS_URL) setMindsUrl(vars.ANTON_MINDS_URL);
      if (vars.ANTON_MEMORY_MODE) setMemoryMode(vars.ANTON_MEMORY_MODE);
      if (vars.ANTON_PROACTIVE_DASHBOARDS === 'true') setProactiveDashboards(true);
      if (vars.ANTON_ANALYTICS_ENABLED === 'false') setAnalyticsEnabled(false);

      // Detect existing key
      if (detected === 'anthropic' && vars.ANTON_ANTHROPIC_API_KEY) setHasExistingKey(true);
      if (detected === 'openai' && vars.ANTON_OPENAI_API_KEY) setHasExistingKey(true);
      if (detected === 'minds' && vars.ANTON_MINDS_API_KEY) setHasExistingKey(true);

      // Load model — skip for minds (uses _reason_/_code_)
      if (detected !== 'minds' && vars.ANTON_PLANNING_MODEL) {
        const knownModels = detected === 'anthropic' ? ANTHROPIC_MODELS_SETTINGS : OPENAI_MODELS_SETTINGS;
        if (knownModels.some(m => m.id === vars.ANTON_PLANNING_MODEL)) {
          setModel(vars.ANTON_PLANNING_MODEL);
        } else {
          setModel('__custom__');
          setCustomModel(vars.ANTON_PLANNING_MODEL);
        }
      }
    })();
  }, []);

  const handleProviderChange = (p: LLMProvider) => {
    setLlmProvider(p);
    setApiKey('');
    setHasExistingKey(false);
    if (p === 'anthropic') setModel(ANTHROPIC_MODELS_SETTINGS[0].id);
    else if (p === 'openai') setModel(OPENAI_MODELS_SETTINGS[0].id);
    setCustomModel('');
  };

  const handleSave = async () => {
    setSaveError('');
    setValidating(true);
    setSaved(false);

    // Determine validation params — same logic as onboarding
    let validationProvider: string;
    let validationKey: string;
    let validationBaseUrl: string | undefined;
    let validationModel: string | undefined;

    if (llmProvider === 'minds') {
      validationProvider = 'minds';
      validationKey = apiKey.trim() || existingVars.ANTON_MINDS_API_KEY || '';
      validationBaseUrl = mindsUrl.trim();
    } else if (llmProvider === 'anthropic') {
      validationProvider = 'anthropic';
      validationKey = apiKey.trim() || existingVars.ANTON_ANTHROPIC_API_KEY || '';
      validationModel = resolvedModel;
    } else {
      validationProvider = 'openai-compatible';
      validationKey = apiKey.trim() || existingVars.ANTON_OPENAI_API_KEY || '';
      validationBaseUrl = 'https://api.openai.com/v1';
      validationModel = resolvedModel;
    }

    // Validate connection
    const result = await window.antontron.validateProvider(
      validationProvider,
      validationKey,
      validationBaseUrl,
      validationModel
    );

    if (!result.ok) {
      setValidating(false);
      setSaveError(result.error || 'Validation failed');
      return;
    }

    // Validation passed — save settings
    const merged = { ...existingVars };

    // Clear old provider keys to avoid conflicts
    delete merged.ANTON_ANTHROPIC_API_KEY;
    delete merged.ANTON_OPENAI_API_KEY;
    delete merged.ANTON_OPENAI_BASE_URL;
    delete merged.ANTON_MINDS_ENABLED;
    delete merged.ANTON_MINDS_API_KEY;
    delete merged.ANTON_MINDS_URL;

    if (llmProvider === 'minds') {
      const mindsBase = mindsUrl.trim().replace(/\/+$/, '');
      merged.ANTON_OPENAI_API_KEY = validationKey;
      merged.ANTON_OPENAI_BASE_URL = mindsBase + '/api/v1';
      merged.ANTON_PLANNING_PROVIDER = 'openai-compatible';
      merged.ANTON_CODING_PROVIDER = 'openai-compatible';
      merged.ANTON_PLANNING_MODEL = '_reason_';
      merged.ANTON_CODING_MODEL = '_code_';
      merged.ANTON_MINDS_ENABLED = 'true';
      merged.ANTON_MINDS_API_KEY = validationKey;
      merged.ANTON_MINDS_URL = mindsBase;
    } else if (llmProvider === 'anthropic') {
      merged.ANTON_ANTHROPIC_API_KEY = validationKey;
      merged.ANTON_PLANNING_PROVIDER = 'anthropic';
      merged.ANTON_CODING_PROVIDER = 'anthropic';
      merged.ANTON_PLANNING_MODEL = resolvedModel;
      merged.ANTON_CODING_MODEL = resolvedModel;
    } else {
      merged.ANTON_OPENAI_API_KEY = validationKey;
      merged.ANTON_OPENAI_BASE_URL = 'https://api.openai.com/v1';
      merged.ANTON_PLANNING_PROVIDER = 'openai-compatible';
      merged.ANTON_CODING_PROVIDER = 'openai-compatible';
      merged.ANTON_PLANNING_MODEL = resolvedModel;
      merged.ANTON_CODING_MODEL = resolvedModel;
    }

    merged.ANTON_MEMORY_MODE = memoryMode;
    merged.ANTON_PROACTIVE_DASHBOARDS = proactiveDashboards ? 'true' : 'false';
    merged.ANTON_ANALYTICS_ENABLED = analyticsEnabled ? 'true' : 'false';

    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
    await window.antontron.saveSettings(lines.join('\n'));
    setValidating(false);
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
        {/* LLM */}
        <div className="accordion">
          <button className={`accordion-header ${openSection === 'llm' ? 'open' : ''}`} onClick={() => setOpenSection(openSection === 'llm' ? '' : 'llm')}>
            <span className="accordion-chevron">{openSection === 'llm' ? '\u25BE' : '\u25B8'}</span>
            LLM Provider
          </button>
          {openSection === 'llm' && (
            <div className="accordion-body">
              <div className="settings-group">
                <label className="settings-label">Provider</label>
                <select
                  className="settings-select"
                  value={llmProvider}
                  onChange={(e) => handleProviderChange(e.target.value as LLMProvider)}
                >
                  <option value="minds">Minds Cloud</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                </select>
              </div>

              {llmProvider === 'minds' && (
                <div className="settings-group">
                  <label className="settings-label">Minds URL</label>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="https://mdb.ai"
                    value={mindsUrl}
                    onChange={(e) => setMindsUrl(e.target.value)}
                  />
                </div>
              )}

              <div className="settings-group">
                <label className="settings-label">
                  {llmProvider === 'minds' ? 'Minds API Key' : llmProvider === 'anthropic' ? 'Anthropic API Key' : 'OpenAI API Key'}
                </label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder={hasExistingKey ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (unchanged)' : llmProvider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <div className="settings-hint">Leave blank to keep current key</div>
              </div>

              {llmProvider !== 'minds' && (
                <div className="settings-group">
                  <label className="settings-label">Model</label>
                  <select
                    className="settings-select"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                    <option value="__custom__">Custom...</option>
                  </select>
                  {model === '__custom__' && (
                    <input
                      type="text"
                      className="settings-input"
                      style={{ marginTop: 6 }}
                      placeholder="Enter model ID..."
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Memory */}
        <div className="accordion">
          <button className={`accordion-header ${openSection === 'memory' ? 'open' : ''}`} onClick={() => setOpenSection(openSection === 'memory' ? '' : 'memory')}>
            <span className="accordion-chevron">{openSection === 'memory' ? '\u25BE' : '\u25B8'}</span>
            Memory
          </button>
          {openSection === 'memory' && (
            <div className="accordion-body">
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
          )}
        </div>

        {/* Dashboards */}
        <div className="accordion">
          <button className={`accordion-header ${openSection === 'dashboards' ? 'open' : ''}`} onClick={() => setOpenSection(openSection === 'dashboards' ? '' : 'dashboards')}>
            <span className="accordion-chevron">{openSection === 'dashboards' ? '\u25BE' : '\u25B8'}</span>
            Dashboards
          </button>
          {openSection === 'dashboards' && (
            <div className="accordion-body">
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
          )}
        </div>

        {/* Telemetry */}
        <div className="accordion">
          <button className={`accordion-header ${openSection === 'telemetry' ? 'open' : ''}`} onClick={() => setOpenSection(openSection === 'telemetry' ? '' : 'telemetry')}>
            <span className="accordion-chevron">{openSection === 'telemetry' ? '\u25BE' : '\u25B8'}</span>
            Telemetry
          </button>
          {openSection === 'telemetry' && (
            <div className="accordion-body">
              <div className="settings-group">
                <label className="settings-label">Anonymous Analytics</label>
                <label className="minds-ssl-label">
                  <input
                    type="checkbox"
                    checked={analyticsEnabled}
                    onChange={(e) => setAnalyticsEnabled(e.target.checked)}
                    className="minds-ssl-checkbox"
                  />
                  Send anonymous usage events
                </label>
                <div className="settings-hint">
                  Helps improve Anton. No personal data or code is ever sent.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {saveError && (
        <div className="error-message" style={{ margin: '0 24px 12px' }}>{saveError}</div>
      )}

      <div className="settings-footer">
        <button className="btn-primary settings-save" onClick={handleSave} disabled={validating}>
          {validating ? 'VALIDATING...' : saved ? '\u2713 SAVED' : 'SAVE'}
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

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

function VaultEditor({
  engine,
  name,
  activeProject,
  ensureAntonRunning,
  onClose,
  onDone,
}: {
  engine: string;
  name: string;
  activeProject: string;
  ensureAntonRunning: (p: string) => Promise<void>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<'edit' | 'testing' | 'pass' | 'fail'>('edit');
  const [testError, setTestError] = useState('');
  const outputBuf = useRef('');

  useEffect(() => {
    (async () => {
      const data = await window.antontron.vaultLoad(engine, name);
      if (data?.fields) setFields(data.fields);
      setLoading(false);
    })();
  }, [engine, name]);

  const slug = `${engine}-${name}`;

  const handleSave = async () => {
    await window.antontron.vaultSave(engine, name, fields);
    setPhase('testing');
    setTestError('');
    outputBuf.current = '';

    // Listen for test result in terminal output
    const unsub = window.antontron.onAntonData((_proj, data) => {
      outputBuf.current += stripAnsi(data);
      const buf = outputBuf.current;
      if (buf.includes('Connection test passed')) {
        unsub();
        setPhase('pass');
      } else if (buf.includes('Connection test failed')) {
        unsub();
        // Extract error after "Error:"
        const errorMatch = buf.match(/Error:\s*([\s\S]*)/);
        setTestError(errorMatch ? errorMatch[1].trim().split('\n').slice(0, 5).join('\n') : 'Connection test failed');
        setPhase('fail');
      } else if (buf.includes('No test snippet defined') || buf.includes('Cannot test')) {
        unsub();
        // No test available — treat as save-only success
        setPhase('pass');
      }
    });

    // Timeout after 30s
    setTimeout(() => {
      if (outputBuf.current && !outputBuf.current.includes('test passed') && !outputBuf.current.includes('test failed')) {
        unsub();
        setTestError('Test timed out');
        setPhase('fail');
      }
    }, 30000);

    await ensureAntonRunning(activeProject);
    window.antontron.sendInput(activeProject, `/test ${slug}\n`);
  };

  const handleDelete = async () => {
    await window.antontron.vaultDelete(engine, name);
    onDone();
  };

  const updateField = (key: string, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <>
        <div className="settings-header">
          <div className="settings-title"><span>{engine}</span> <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({name})</span></div>
          <button className="settings-close" onClick={onClose}>&times;</button>
        </div>
        <div className="settings-body" style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <div className="spinner" />
        </div>
      </>
    );
  }

  const fieldEntries = Object.entries(fields);
  const isSecret = (key: string) => /password|secret|token|api_key|apikey|private_key|ssl_key/i.test(key);

  return (
    <>
      <div className="settings-header">
        <div className="settings-title"><span>{engine}</span> <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({name})</span></div>
        <button className="settings-close" onClick={onClose}>&times;</button>
      </div>

      <div className="settings-body">
        {fieldEntries.length === 0 && (
          <div className="settings-hint" style={{ textAlign: 'center', padding: 16 }}>
            No fields configured. Use /edit {slug} in the terminal to add fields.
          </div>
        )}

        {fieldEntries.map(([key, value]) => (
          <div className="settings-group" key={key}>
            <label className="settings-label">{key}</label>
            <input
              type={isSecret(key) ? 'password' : 'text'}
              className="settings-input"
              value={value}
              onChange={(e) => updateField(key, e.target.value)}
              placeholder={isSecret(key) ? '\u2022\u2022\u2022\u2022\u2022\u2022' : `Enter ${key}...`}
              disabled={phase === 'testing'}
            />
          </div>
        ))}

        {/* Test result feedback */}
        {phase === 'testing' && (
          <div className="vault-test-status">
            <div className="spinner" style={{ width: 16, height: 16 }} />
            <span>Testing connection...</span>
          </div>
        )}
        {phase === 'pass' && (
          <div className="vault-test-status vault-test-pass">
            <span>{'\u2713'} Connection test passed</span>
          </div>
        )}
        {phase === 'fail' && (
          <div className="vault-test-status vault-test-fail">
            <span>{'\u2717'} Connection test failed</span>
            {testError && <pre className="vault-test-error">{testError}</pre>}
          </div>
        )}
      </div>

      <div className="settings-footer" style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn-primary settings-save"
          style={{ flex: 1 }}
          onClick={phase === 'pass' ? onDone : handleSave}
          disabled={phase === 'testing'}
        >
          {phase === 'testing' ? 'TESTING...' : phase === 'pass' ? 'DONE' : phase === 'fail' ? 'RETRY' : 'SAVE'}
        </button>
        <button
          className="btn-primary settings-save"
          style={{ flex: 0, background: 'rgba(255,82,82,0.15)', color: 'var(--accent-red)', border: '1px solid rgba(255,82,82,0.3)' }}
          onClick={handleDelete}
          disabled={phase === 'testing'}
        >
          DELETE
        </button>
      </div>
    </>
  );
}
