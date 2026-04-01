import { app, BrowserWindow, ipcMain, Menu, nativeImage, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { IPC } from '../shared/ipc-channels';
import { checkAntonInstalled, runInstaller } from './installer';
import { startAnton, writeToAnton, resizeAnton, killAnton, isAntonRunning } from './anton-process';
import { sendEvent } from './analytics';

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

async function validateAnthropic(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await httpRequest('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (res.status === 200 || res.status === 201) {
      return { ok: true };
    }
    // 401 = bad key, 403 = no access, anything else parse error
    const parsed = JSON.parse(res.body).error?.message || `HTTP ${res.status}`;
    return { ok: false, error: parsed };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

async function validateMinds(
  apiKey: string,
  baseUrl: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = baseUrl.replace(/\/+$/, '') + '/api/v1/minds/';
    const res = await httpRequest(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.status >= 200 && res.status < 300) {
      return { ok: true };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    return { ok: false, error: `Server returned HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: `Cannot connect: ${err.message}` };
  }
}

async function validateOpenAICompatible(
  apiKey: string,
  baseUrl: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const modelsUrl = normalizedBase.endsWith('/v1')
      ? `${normalizedBase}/models`
      : `${normalizedBase}/v1/models`;
    const res = await httpRequest(modelsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.status >= 200 && res.status < 300) {
      return { ok: true };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    return { ok: false, error: `Server returned HTTP ${res.status}` };
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

// ─── Icons ───────────────────────────────────────────────────
function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'icon.png');
  }
  return path.join(__dirname, '..', '..', '..', 'assets', 'icon.png');
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const icon = nativeImage.createFromPath(getIconPath());

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    icon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // needed for node-pty
    },
  });

  // In dev with Vite running, load from dev server; otherwise load built files
  const isDev = !app.isPackaged && process.env.VITE_DEV === '1';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }

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
    return runInstaller(mainWindow);
  });

  ipcMain.handle(IPC.ANTON_START, async (_event, projectName: string, cols: number, rows: number) => {
    if (!mainWindow) return;
    const projectDir = path.join(getProjectsDir(), projectName);
    if (!fs.existsSync(projectDir)) {
      ensureDefaultProject();
    }
    startAnton(mainWindow, cols, rows, projectName, projectDir);
  });

  ipcMain.handle(IPC.ANTON_IS_RUNNING, async (_event, projectName: string) => {
    return isAntonRunning(projectName);
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
    async (_event, provider: string, apiKey: string, baseUrl?: string) => {
      if (provider === 'anthropic') {
        return validateAnthropic(apiKey);
      } else if (provider === 'minds') {
        return validateMinds(apiKey, baseUrl || 'https://mdb.ai');
      } else if (provider === 'openai-compatible') {
        return validateOpenAICompatible(apiKey, baseUrl || 'https://api.openai.com/v1');
      }
      return { ok: false, error: 'Unknown provider' };
    }
  );

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
              app.setAboutPanelOptions({
                applicationName: 'Anton',
                applicationVersion: app.getVersion(),
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
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  ensureDefaultProject();
  setupIPC();
  startEnvWatcher();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  fs.unwatchFile(getAntonEnvPath());
  killAnton();
  app.quit();
});
