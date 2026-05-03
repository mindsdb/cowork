import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { IPC } from '../shared/ipc-channels';
import { checkAntonInstalled, runInstaller } from './installer';
import { startServer, stopServer, isServerRunning, getServerPort } from './server-process';
import { startAnton, writeToAnton, resizeAnton, killAnton, isAntonRunning } from './anton-process';
import { sendEvent } from './analytics';
import { getRendererPath, checkForUIUpdate, getCachedVersion } from './ui-updater';

function getAntonEnvPath(): string {
  return path.join(os.homedir(), '.anton', '.env');
}

function readEnvFile(): Record<string, string> {
  const envPath = getAntonEnvPath();
  const vars: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return vars;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
  }
  return vars;
}

function checkConfigured(): { configured: boolean; provider: string } {
  const vars = readEnvFile();
  if (vars.ANTON_ANTHROPIC_API_KEY) {
    return { configured: true, provider: 'anthropic' };
  }
  if (vars.ANTON_OPENAI_API_KEY && vars.ANTON_OPENAI_BASE_URL) {
    return { configured: true, provider: 'minds' };
  }
  return { configured: false, provider: '' };
}

function httpRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string; rejectUnauthorized?: boolean }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const rejectUnauth = options.rejectUnauthorized !== false;
    const reqOptions: any = {
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: options.method,
      headers: options.headers,
    };
    if (!rejectUnauth && parsed.protocol === 'https:') {
      reqOptions.agent = new https.Agent({ rejectUnauthorized: false });
    }
    const req = mod.request(
      reqOptions,
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function validateAnthropic(apiKey: string, model: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await httpRequest('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.status === 200 || res.status === 201) {
      return { ok: true };
    }
    try {
      const parsed = JSON.parse(res.body).error?.message || `HTTP ${res.status}`;
      return { ok: false, error: parsed };
    } catch {
      return { ok: false, error: `HTTP ${res.status}` };
    }
  } catch (err: any) {
    return { ok: false, error: `Cannot connect: ${err.message}` };
  }
}

async function validateMinds(
  apiKey: string,
  baseUrl: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    // First check the minds API is reachable
    const base = baseUrl.replace(/\/+$/, '');
    const mindsUrl = base + '/api/v1/minds/';
    const res = await httpRequest(mindsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    if (res.status >= 200 && res.status < 300) {
      return { ok: true };
    }
    return { ok: false, error: `Server returned HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: `Cannot connect: ${err.message}` };
  }
}

async function validateOpenAICompatible(
  apiKey: string,
  baseUrl: string,
  model?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    // Support endpoints that already include a versioned path (e.g. Gemini's /v1beta/openai)
    const chatUrl = /\/v\d/.test(normalizedBase)
      ? `${normalizedBase}/chat/completions`
      : `${normalizedBase}/v1/chat/completions`;
    const res = await httpRequest(chatUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.status === 200 || res.status === 201) {
      return { ok: true };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    try {
      const parsed = JSON.parse(res.body).error?.message || `HTTP ${res.status}`;
      return { ok: false, error: parsed };
    } catch {
      return { ok: false, error: `HTTP ${res.status}` };
    }
  } catch (err: any) {
    return { ok: false, error: `Cannot connect: ${err.message}` };
  }
}

// ─── Projects ────────────────────────────────────────────────
interface Project {
  name: string;
  path: string;
}

function getProjectsDir(): string {
  const userData = app.getPath('userData');
  return path.join(userData, 'projects');
}

function getStateFile(): string {
  return path.join(app.getPath('userData'), 'state.json');
}

function readState(): { activeProject: string } {
  const stateFile = getStateFile();
  try {
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    }
  } catch {}
  return { activeProject: 'default' };
}

function writeState(state: { activeProject: string }) {
  const stateFile = getStateFile();
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

function ensureProjectsDir() {
  const dir = getProjectsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureDefaultProject() {
  ensureProjectsDir();
  const defaultDir = path.join(getProjectsDir(), 'default');
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  const antonDir = path.join(defaultDir, '.anton');
  if (!fs.existsSync(antonDir)) {
    fs.mkdirSync(antonDir, { recursive: true });
  }
}

function listProjects(): Project[] {
  ensureProjectsDir();
  const dir = getProjectsDir();
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => {
        if (a.name === 'default') return -1;
        if (b.name === 'default') return 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}

function createProject(name: string): Project | { error: string } {
  const sanitized = name.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim();
  if (!sanitized) return { error: 'Invalid project name' };

  const projectDir = path.join(getProjectsDir(), sanitized);
  if (fs.existsSync(projectDir)) return { error: 'Project already exists' };

  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, '.anton'), { recursive: true });
  return { name: sanitized, path: projectDir };
}

function deleteProject(name: string): boolean {
  if (name === 'default') return false;
  const projectDir = path.join(getProjectsDir(), name);
  if (!fs.existsSync(projectDir)) return false;
  fs.rmSync(projectDir, { recursive: true });
  // If we deleted the active project, switch to default
  const state = readState();
  if (state.activeProject === name) {
    state.activeProject = 'default';
    writeState(state);
  }
  return true;
}

function getActiveProjectPath(): string {
  const state = readState();
  const projectDir = path.join(getProjectsDir(), state.activeProject);
  if (!fs.existsSync(projectDir)) {
    ensureDefaultProject();
    return path.join(getProjectsDir(), 'default');
  }
  return projectDir;
}

function getProjectPath(projectName: string): string {
  return path.join(getProjectsDir(), projectName);
}

type ExplainabilityRecord = {
  turn: number;
  created_at: string;
  user_message: string;
  answer_text: string;
  summary: string;
  data_sources: { name: string; engine?: string | null }[];
  sql_queries: {
    datasource: string;
    sql: string;
    engine?: string | null;
    status: string;
    error_message?: string | null;
  }[];
  scratchpad_steps: string[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null | undefined {
  return typeof value === 'string' ? value : value == null ? null : undefined;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeExplainabilityRecord(value: unknown): ExplainabilityRecord | null {
  if (!isObject(value)) {
    return null;
  }

  const dataSources = Array.isArray(value.data_sources)
    ? value.data_sources
        .filter(isObject)
        .map((source) => ({
          name: asString(source.name),
          engine: asNullableString(source.engine) ?? null,
        }))
        .filter((source) => source.name.length > 0)
    : [];

  const sqlQueries = Array.isArray(value.sql_queries)
    ? value.sql_queries
        .filter(isObject)
        .map((query) => ({
          datasource: asString(query.datasource),
          sql: asString(query.sql),
          engine: asNullableString(query.engine) ?? null,
          status: asString(query.status),
          error_message: asNullableString(query.error_message) ?? null,
        }))
        .filter((query) => query.datasource.length > 0 || query.sql.length > 0)
    : [];

  const scratchpadSteps = Array.isArray(value.scratchpad_steps)
    ? value.scratchpad_steps.filter((step): step is string => typeof step === 'string')
    : [];

  return {
    turn: asNumber(value.turn),
    created_at: asString(value.created_at),
    user_message: asString(value.user_message),
    answer_text: asString(value.answer_text),
    summary: asString(value.summary),
    data_sources: dataSources,
    sql_queries: sqlQueries,
    scratchpad_steps: scratchpadSteps,
  };
}

function clearLatestExplainability(projectName: string) {
  const explainabilityPath = path.join(
    getProjectPath(projectName),
    '.anton',
    'explainability',
    'latest.json'
  );
  try {
    if (fs.existsSync(explainabilityPath)) {
      fs.unlinkSync(explainabilityPath);
    }
  } catch {
    // ignore – file may already be gone
  }
}

function readLatestExplainability(projectName: string) {
  const explainabilityPath = path.join(
    getProjectPath(projectName),
    '.anton',
    'explainability',
    'latest.json'
  );
  if (!fs.existsSync(explainabilityPath)) {
    return null;
  }
  try {
    return normalizeExplainabilityRecord(JSON.parse(fs.readFileSync(explainabilityPath, 'utf-8')));
  } catch {
    return null;
  }
}

// ─── Icons ───────────────────────────────────────────────────
function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'icon.png');
  }
  return path.join(__dirname, '..', '..', '..', 'assets', 'icon.png');
}

let mainWindow: BrowserWindow | null = null;
let activeInstall: { cancelled: boolean } | null = null;

function createWindow() {
  const icon = nativeImage.createFromPath(getIconPath());
  const isDev = !app.isPackaged && process.env.VITE_DEV === '1';
  const shouldOpenDevTools = process.env.ANTON_OPEN_DEVTOOLS === '1';

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    icon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Embed the macOS traffic lights inside the sidebar header. Coordinates
    // are window-relative; the sidebar floats with ~9px outer padding so
    // x:18 / y:22 places the lights inside the chrome row with a small gap
    // from the sidebar's top-left.
    trafficLightPosition: process.platform === 'darwin' ? { x: 20, y: 24 } : undefined,
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // needed for node-pty
      // Disable Chromium's same-origin/mixed-content checks so the renderer
      // (loaded from file://) can fetch http://127.0.0.1:<antonPort>/v1/*.
      // Safe in this context: app is local, network calls only target the
      // loopback python server we spawn ourselves. CSP in index.html still
      // allowlists the exact origins for defense in depth.
      webSecurity: false,
    },
  });

  // In dev with Vite running, load from dev server; otherwise load built/cached files
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(getRendererPath());
  }

  if (isDev && shouldOpenDevTools) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    });
  }

  // Open external links in the OS default browser instead of navigating Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow dev server reloads
    if (!app.isPackaged && url.startsWith('http://localhost')) return;
    // Block navigation and open in OS browser
    event.preventDefault();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    killAnton();
    mainWindow = null;
  });
}

// IPC handlers
function setupIPC() {
  ipcMain.handle(IPC.INSTALL_CHECK, async () => {
    return checkAntonInstalled();
  });

  ipcMain.handle(IPC.INSTALL_START, async () => {
    if (!mainWindow) return false;
    if (activeInstall) return false;
    const state = { cancelled: false };
    activeInstall = state;
    try {
      // runInstaller now also spins up the python server as its final
      // visible step (so the install screen shows "Start Anton server").
      return await runInstaller(mainWindow, { shouldAbort: () => state.cancelled });
    } finally {
      if (activeInstall === state) {
        activeInstall = null;
      }
    }
  });

  // Renderer can ask main where the server lives.
  ipcMain.handle('server:get-info', () => ({
    running: isServerRunning(),
    port: getServerPort(),
    origin: `http://127.0.0.1:${getServerPort()}`,
  }));

  ipcMain.handle(IPC.INSTALL_CANCEL, async () => {
    if (!activeInstall) return false;
    activeInstall.cancelled = true;
    return true;
  });

  ipcMain.handle(IPC.ANTON_START, async (_event, projectName: string, cols: number, rows: number) => {
    if (!mainWindow) return;
    const projectDir = path.join(getProjectsDir(), projectName);
    if (!fs.existsSync(projectDir)) {
      ensureDefaultProject();
    }
    clearLatestExplainability(projectName);
    startAnton(mainWindow, cols, rows, projectName, projectDir);
  });

  ipcMain.handle(IPC.ANTON_IS_RUNNING, async (_event, projectName: string) => {
    return isAntonRunning(projectName);
  });

  ipcMain.handle(IPC.EXPLAINABILITY_LATEST, async (_event, projectName: string) => {
    return readLatestExplainability(projectName);
  });

  ipcMain.on(IPC.ANTON_INPUT, (_event, projectName: string, data: string) => {
    writeToAnton(projectName, data);
  });

  ipcMain.on(IPC.ANTON_RESIZE, (_event, projectName: string, cols: number, rows: number) => {
    resizeAnton(projectName, cols, rows);
  });

  ipcMain.on(IPC.ANTON_KILL, (_event, projectName: string) => {
    killAnton(projectName);
  });

  ipcMain.handle(IPC.SETTINGS_READ, async () => {
    return readEnvFile();
  });

  ipcMain.handle(IPC.SETTINGS_SAVE, async (_event, content: string) => {
    const antonDir = path.join(os.homedir(), '.anton');
    if (!fs.existsSync(antonDir)) {
      fs.mkdirSync(antonDir, { recursive: true });
    }
    const envPath = path.join(antonDir, '.env');
    fs.writeFileSync(envPath, content + '\n', 'utf-8');

    // Analytics — fire-and-forget, never blocks
    if (content.includes('ANTON_TERMS_CONSENT=true')) {
      sendEvent('ANTONAPP_TERMS_ACCEPTED');
    }
    if (content.includes('ANTON_MINDS_ENABLED=true')) {
      sendEvent('ANTONAPP_MINDSLLM');
    } else if (content.includes('ANTON_ANTHROPIC_API_KEY') || content.includes('ANTON_OPENAI_API_KEY')) {
      sendEvent('ANTONAPP_BYOK');
    }

    return true;
  });

  ipcMain.handle(IPC.SETTINGS_CHECK_CONFIGURED, async () => {
    return checkConfigured();
  });

  ipcMain.handle(
    IPC.SETTINGS_VALIDATE,
    async (_event, provider: string, apiKey: string, baseUrl?: string, model?: string) => {
      if (provider === 'anthropic') {
        return validateAnthropic(apiKey, model || 'claude-sonnet-4-6');
      } else if (provider === 'minds') {
        return validateMinds(apiKey, baseUrl || 'https://mdb.ai');
      } else if (provider === 'openai-compatible') {
        return validateOpenAICompatible(apiKey, baseUrl || 'https://api.openai.com/v1', model);
      }
      return { ok: false, error: 'Unknown provider' };
    }
  );

  // Data Vault
  const vaultDir = path.join(os.homedir(), '.anton', 'data_vault');

  ipcMain.handle(IPC.VAULT_LIST, async () => {
    if (!fs.existsSync(vaultDir)) return [];
    const results: { engine: string; name: string; created_at: string }[] = [];
    for (const fname of fs.readdirSync(vaultDir).sort()) {
      const fpath = path.join(vaultDir, fname);
      if (!fs.statSync(fpath).isFile() || fname.endsWith('.tmp')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(fpath, 'utf-8'));
        results.push({
          engine: data.engine || '',
          name: data.name || '',
          created_at: data.created_at || '',
        });
      } catch { /* skip corrupt files */ }
    }
    return results;
  });

  ipcMain.handle(IPC.VAULT_LOAD, async (_event, engine: string, name: string) => {
    const safeName = `${engine.replace(/[^\w-]/g, '_')}-${name.replace(/[^\w-]/g, '_')}`;
    const fpath = path.join(vaultDir, safeName);
    if (!fs.existsSync(fpath)) return null;
    try {
      return JSON.parse(fs.readFileSync(fpath, 'utf-8'));
    } catch { return null; }
  });

  ipcMain.handle(IPC.VAULT_SAVE, async (_event, engine: string, name: string, fields: Record<string, string>) => {
    if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true, mode: 0o700 });
    const safeName = `${engine.replace(/[^\w-]/g, '_')}-${name.replace(/[^\w-]/g, '_')}`;
    const fpath = path.join(vaultDir, safeName);
    const data = { engine, name, created_at: new Date().toISOString(), fields };
    const tmp = fpath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, fpath);
    return true;
  });

  ipcMain.handle(IPC.VAULT_DELETE, async (_event, engine: string, name: string) => {
    const safeName = `${engine.replace(/[^\w-]/g, '_')}-${name.replace(/[^\w-]/g, '_')}`;
    const fpath = path.join(vaultDir, safeName);
    if (fs.existsSync(fpath)) { fs.unlinkSync(fpath); return true; }
    return false;
  });

  // Watch vault directory for external changes (e.g. /connect from CLI)
  let vaultWatcher: fs.FSWatcher | null = null;
  let vaultDebounce: ReturnType<typeof setTimeout> | null = null;
  const startVaultWatcher = () => {
    try {
      if (!fs.existsSync(vaultDir)) {
        fs.mkdirSync(vaultDir, { recursive: true, mode: 0o700 });
      }
      vaultWatcher = fs.watch(vaultDir, () => {
        if (vaultDebounce) clearTimeout(vaultDebounce);
        vaultDebounce = setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC.VAULT_CHANGED);
          }
        }, 300);
      });
    } catch { /* ignore watch errors */ }
  };
  startVaultWatcher();

  // Clipboard image
  ipcMain.handle(IPC.CLIPBOARD_SAVE_IMAGE, async (_event, base64Data: string) => {
    const tmpDir = path.join(os.tmpdir(), 'anton-clipboard');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const filename = `paste-${Date.now()}.png`;
    const filePath = path.join(tmpDir, filename);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return filePath;
  });

  // Minds
  ipcMain.handle(IPC.MINDS_STATUS, async () => {
    const vars = readEnvFile();
    return {
      connected: !!(vars.ANTON_MINDS_API_KEY && vars.ANTON_MINDS_MIND_NAME),
      url: vars.ANTON_MINDS_URL || undefined,
      apiKey: vars.ANTON_MINDS_API_KEY || undefined,
      mindName: vars.ANTON_MINDS_MIND_NAME || null,
      datasource: vars.ANTON_MINDS_DATASOURCE || null,
      engine: vars.ANTON_MINDS_DATASOURCE_ENGINE || null,
    };
  });

  ipcMain.handle(IPC.MINDS_LIST, async (_event, url: string, apiKey: string, sslVerify: boolean) => {
    console.log('[MINDS_LIST] sslVerify:', sslVerify, 'type:', typeof sslVerify);
    try {
      const baseUrl = url.replace(/\/+$/, '');
      const res = await httpRequest(`${baseUrl}/api/v1/minds/`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        rejectUnauthorized: sslVerify,
      });
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, minds: JSON.parse(res.body) };
      }
      return { ok: false, error: `HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.MINDS_GET, async (_event, url: string, apiKey: string, mindName: string, sslVerify: boolean) => {
    try {
      const baseUrl = url.replace(/\/+$/, '');
      const res = await httpRequest(`${baseUrl}/api/v1/minds/${encodeURIComponent(mindName)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        rejectUnauthorized: sslVerify,
      });
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, mind: JSON.parse(res.body) };
      }
      return { ok: false, error: `HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.MINDS_LIST_DATASOURCES, async (_event, url: string, apiKey: string, sslVerify: boolean) => {
    try {
      const baseUrl = url.replace(/\/+$/, '');
      const res = await httpRequest(`${baseUrl}/api/v1/datasources`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        rejectUnauthorized: sslVerify,
      });
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, datasources: JSON.parse(res.body) };
      }
      return { ok: false, error: `HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.MINDS_CONNECT, async (
    _event,
    url: string,
    apiKey: string,
    mindName: string,
    datasource: string | null,
    engine: string | null,
    sslVerify: boolean
  ) => {
    // Read existing env, update minds vars, write back
    const vars = readEnvFile();
    vars.ANTON_MINDS_API_KEY = apiKey;
    vars.ANTON_MINDS_URL = url;
    vars.ANTON_MINDS_MIND_NAME = mindName;
    vars.ANTON_MINDS_SSL_VERIFY = sslVerify ? 'true' : 'false';
    if (datasource) vars.ANTON_MINDS_DATASOURCE = datasource;
    else delete vars.ANTON_MINDS_DATASOURCE;
    if (engine) vars.ANTON_MINDS_DATASOURCE_ENGINE = engine;
    else delete vars.ANTON_MINDS_DATASOURCE_ENGINE;

    const antonDir = path.join(os.homedir(), '.anton');
    if (!fs.existsSync(antonDir)) fs.mkdirSync(antonDir, { recursive: true });
    const envPath = path.join(antonDir, '.env');
    const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');

    // Write knowledge file for the mind's system prompt
    try {
      const baseUrl = url.replace(/\/+$/, '');
      const res = await httpRequest(`${baseUrl}/api/v1/minds/${encodeURIComponent(mindName)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        rejectUnauthorized: sslVerify,
      });
      if (res.status >= 200 && res.status < 300) {
        const mind = JSON.parse(res.body);
        const params = mind.parameters || {};
        const parts: string[] = [];
        if (params.system_prompt) parts.push(params.system_prompt);
        if (params.prompt_template) parts.push(params.prompt_template);
        if (parts.length > 0) {
          // Write to active project's cortex
          const state = readState();
          const projectDir = path.join(getProjectsDir(), state.activeProject);
          const topicDir = path.join(projectDir, '.anton', 'memory', 'cortex', 'hippocampus', 'project', 'topics');
          fs.mkdirSync(topicDir, { recursive: true });
          const content = `# Minds — ${mindName}\n\n${parts.join('\n\n')}\n`;
          fs.writeFileSync(path.join(topicDir, 'minds-datasource.md'), content, 'utf-8');
        }
      }
    } catch {}

    return true;
  });

  ipcMain.handle(IPC.MINDS_DISCONNECT, async () => {
    const vars = readEnvFile();
    // Keep URL and API key so user can reconnect to the same server easily
    delete vars.ANTON_MINDS_MIND_NAME;
    delete vars.ANTON_MINDS_DATASOURCE;
    delete vars.ANTON_MINDS_DATASOURCE_ENGINE;
    delete vars.ANTON_MINDS_SSL_VERIFY;

    const envPath = getAntonEnvPath();
    const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');
    return true;
  });

  // Projects
  ipcMain.handle(IPC.PROJECTS_LIST, async () => {
    return listProjects();
  });

  ipcMain.handle(IPC.PROJECTS_CREATE, async (_event, name: string) => {
    return createProject(name);
  });

  ipcMain.handle(IPC.PROJECTS_RENAME, async (_event, oldName: string, newName: string) => {
    if (oldName === 'default') return { error: 'Cannot rename default project' };
    const sanitized = newName.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim();
    if (!sanitized) return { error: 'Invalid project name' };
    if (sanitized === oldName) return { error: 'Same name' };

    const oldDir = path.join(getProjectsDir(), oldName);
    const newDir = path.join(getProjectsDir(), sanitized);
    if (!fs.existsSync(oldDir)) return { error: 'Project not found' };
    if (fs.existsSync(newDir)) return { error: 'Name already taken' };

    fs.renameSync(oldDir, newDir);

    // Update active project if it was the renamed one
    const state = readState();
    if (state.activeProject === oldName) {
      state.activeProject = sanitized;
      writeState(state);
    }
    return { name: sanitized, path: newDir };
  });

  ipcMain.handle(IPC.PROJECTS_DELETE, async (_event, name: string) => {
    return deleteProject(name);
  });

  ipcMain.handle(IPC.PROJECTS_GET_ACTIVE, async () => {
    return readState().activeProject;
  });

  ipcMain.handle(IPC.PROJECTS_SET_ACTIVE, async (_event, name: string) => {
    writeState({ activeProject: name });
    return true;
  });

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle(IPC.APP_UI_VERSION, async () => {
    const uiVersion = getCachedVersion();
    return {
      app: app.getVersion(),
      ui: uiVersion || 'bundled',
    };
  });
}

// Watch ~/.anton/.env for external changes (e.g. /connect from CLI)
let lastMindsSnapshot = '';
function startEnvWatcher() {
  const envPath = getAntonEnvPath();
  // Ensure the directory exists so watchFile doesn't error
  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const getMindsStatus = () => {
    const vars = readEnvFile();
    return {
      connected: !!(vars.ANTON_MINDS_API_KEY && vars.ANTON_MINDS_MIND_NAME),
      url: vars.ANTON_MINDS_URL || undefined,
      apiKey: vars.ANTON_MINDS_API_KEY || undefined,
      mindName: vars.ANTON_MINDS_MIND_NAME || null,
      datasource: vars.ANTON_MINDS_DATASOURCE || null,
      engine: vars.ANTON_MINDS_DATASOURCE_ENGINE || null,
    };
  };

  lastMindsSnapshot = JSON.stringify(getMindsStatus());

  fs.watchFile(envPath, { interval: 2000 }, () => {
    const status = getMindsStatus();
    const snapshot = JSON.stringify(status);
    if (snapshot !== lastMindsSnapshot) {
      lastMindsSnapshot = snapshot;
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send(IPC.MINDS_STATUS_CHANGED, status);
      });
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(getIconPath());
    app.dock.setIcon(dockIcon);

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          {
            label: 'About Anton',
            role: 'about',
            click: () => {
              const uiVersion = getCachedVersion();
              const versionStr = uiVersion
                ? `${app.getVersion()} (UI: ${uiVersion})`
                : app.getVersion();
              app.setAboutPanelOptions({
                applicationName: 'Anton',
                applicationVersion: versionStr,
                copyright: 'By MindsDB',
                credits: 'Autonomous AI Coworker\nhttps://mindsdb.com',
              });
              app.showAboutPanel();
            },
          },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { role: 'togglefullscreen' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'resetZoom' },
        ],
      },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  ensureDefaultProject();
  setupIPC();
  startEnvWatcher();
  createWindow();

  // If anton is already installed (returning user), start the bundled
  // python server in the background. Skips silently if anton isn't
  // installed yet — the installer will start it after install completes.
  checkAntonInstalled().then(async (installed) => {
    if (!installed) return;
    const result = await startServer();
    if (!result.ok) {
      console.error(`[server] start failed: ${result.reason}`);
    } else {
      console.log(`[server] running on http://127.0.0.1:${result.port}`);
    }
  }).catch((err) => {
    console.error('[server] check-and-start failed:', err);
  });

  // Check for UI updates in the background — only in packaged builds
  if (app.isPackaged) {
    checkForUIUpdate().then((updated) => {
      if (updated) console.log('[main] UI update downloaded — will apply on next launch');
    }).catch(() => {});
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  fs.unwatchFile(getAntonEnvPath());
  killAnton();
  stopServer();
  app.quit();
});

app.on('before-quit', () => {
  stopServer();
});
