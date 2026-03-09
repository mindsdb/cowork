import { app, BrowserWindow, ipcMain, nativeImage, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { IPC } from '../shared/ipc-channels';
import { checkAntonInstalled, runInstaller } from './installer';
import { startAnton, writeToAnton, resizeAnton, killAnton, isAntonRunning } from './anton-process';

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
  options: { method: string; headers: Record<string, string>; body?: string }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method,
        headers: options.headers,
      },
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

  ipcMain.handle(IPC.SETTINGS_SAVE, async (_event, content: string) => {
    const antonDir = path.join(os.homedir(), '.anton');
    if (!fs.existsSync(antonDir)) {
      fs.mkdirSync(antonDir, { recursive: true });
    }
    const envPath = path.join(antonDir, '.env');
    fs.writeFileSync(envPath, content + '\n', 'utf-8');
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

  // Projects
  ipcMain.handle(IPC.PROJECTS_LIST, async () => {
    return listProjects();
  });

  ipcMain.handle(IPC.PROJECTS_CREATE, async (_event, name: string) => {
    return createProject(name);
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

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(getIconPath());
    app.dock.setIcon(dockIcon);
  }
  ensureDefaultProject();
  setupIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  killAnton();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
