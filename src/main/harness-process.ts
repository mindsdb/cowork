import { spawn, ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

const DEFAULT_HERMES_URL = 'http://127.0.0.1:8642';

let hermesProcess: ChildProcess | null = null;
let managedHermesUrl: string | null = null;
let managedHermesKey: string | null = null;

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
      vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return vars;
}

function envPath(): string {
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  return [localBin, cargoBin, process.env.PATH || ''].filter(Boolean).join(path.delimiter);
}

function normalizeHarness(value?: string): 'anton' | 'hermes' {
  const raw = (value || 'anton').trim().toLowerCase();
  return raw === 'hermes' || raw === 'hermes-agent' || raw === 'hermes_agent' ? 'hermes' : 'anton';
}

function boolValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function getSelectedHarness(): 'anton' | 'hermes' {
  const vars = readEnvFile();
  return normalizeHarness(process.env.COWORK_HARNESS_PROVIDER || vars.COWORK_HARNESS_PROVIDER);
}

function getHermesCommand(): string | null {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'hermes'),
    path.join(os.homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const dir of envPath().split(path.delimiter)) {
    const candidate = path.join(dir, 'hermes');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function hermesSettings() {
  const vars = readEnvFile();
  const baseUrl = (
    process.env.COWORK_HERMES_API_BASE_URL ||
    vars.COWORK_HERMES_API_BASE_URL ||
    process.env.HERMES_API_BASE_URL ||
    DEFAULT_HERMES_URL
  ).replace(/\/+$/, '');
  const apiKey =
    process.env.COWORK_HERMES_API_KEY ||
    vars.COWORK_HERMES_API_KEY ||
    process.env.API_SERVER_KEY ||
    '';
  const autoStart = boolValue(process.env.COWORK_HERMES_AUTO_START || vars.COWORK_HERMES_AUTO_START, true);
  return { baseUrl, apiKey, autoStart };
}

function httpGetOk(baseUrl: string, apiKey: string, route: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(route, baseUrl);
    } catch {
      resolve(false);
      return;
    }
    const req = http.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        timeout: timeoutMs,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      },
      (res) => {
        res.resume();
        resolve((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function probeHermes(baseUrl: string, apiKey: string): Promise<boolean> {
  const health = await httpGetOk(baseUrl, apiKey, '/health');
  if (!health) return false;
  return httpGetOk(baseUrl, apiKey, '/v1/models');
}

async function waitForHermes(baseUrl: string, apiKey: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await probeHermes(baseUrl, apiKey)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function getHostPort(baseUrl: string): { host: string; port: number } {
  const parsed = new URL(baseUrl);
  return {
    host: parsed.hostname || '127.0.0.1',
    port: Number(parsed.port || 8642),
  };
}

export async function prepareHarnessEnvironment(baseEnv: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const selected = getSelectedHarness();
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    COWORK_HARNESS_PROVIDER: selected,
  };
  if (selected !== 'hermes') {
    return env;
  }

  const settings = hermesSettings();
  let baseUrl = managedHermesUrl || settings.baseUrl;
  let apiKey = managedHermesKey || settings.apiKey;

  if (await probeHermes(baseUrl, apiKey)) {
    env.COWORK_HERMES_API_BASE_URL = baseUrl;
    if (apiKey) env.COWORK_HERMES_API_KEY = apiKey;
    return env;
  }

  if (!settings.autoStart) {
    env.COWORK_HERMES_API_BASE_URL = baseUrl;
    if (apiKey) env.COWORK_HERMES_API_KEY = apiKey;
    return env;
  }

  if (!apiKey) {
    apiKey = `cowork-${crypto.randomBytes(24).toString('hex')}`;
  }
  const command = getHermesCommand();
  if (!command) {
    env.COWORK_HERMES_API_BASE_URL = baseUrl;
    env.COWORK_HERMES_API_KEY = apiKey;
    env.COWORK_HERMES_START_ERROR = 'Hermes command not found.';
    return env;
  }

  if (!hermesProcess) {
    const { host, port } = getHostPort(baseUrl);
    const childEnv = {
      ...process.env,
      PATH: envPath(),
      API_SERVER_ENABLED: 'true',
      API_SERVER_HOST: host,
      API_SERVER_PORT: String(port),
      API_SERVER_KEY: apiKey,
    };
    const child = spawn(command, ['gateway', 'run'], {
      cwd: os.homedir(),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    hermesProcess = child;
    managedHermesUrl = baseUrl;
    managedHermesKey = apiKey;
    child.stdout.on('data', (d) => process.stdout.write(`[hermes-agent] ${d.toString()}`));
    child.stderr.on('data', (d) => process.stderr.write(`[hermes-agent] ${d.toString()}`));
    child.on('error', (err) => {
      console.error(`[hermes-agent] failed to start: ${err.message}`);
      if (hermesProcess === child) {
        hermesProcess = null;
        managedHermesUrl = null;
        managedHermesKey = null;
      }
    });
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[hermes-agent] exited with code ${code}`);
      }
      if (hermesProcess === child) {
        hermesProcess = null;
        managedHermesUrl = null;
        managedHermesKey = null;
      }
    });
  }

  const ready = await waitForHermes(baseUrl, apiKey, 45_000);
  env.COWORK_HERMES_API_BASE_URL = baseUrl;
  env.COWORK_HERMES_API_KEY = apiKey;
  if (!ready) {
    env.COWORK_HERMES_START_ERROR = 'Hermes gateway did not become ready.';
  }
  return env;
}

export async function stopManagedHermes(): Promise<void> {
  const proc = hermesProcess;
  if (!proc) return;
  hermesProcess = null;
  managedHermesUrl = null;
  managedHermesKey = null;
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
  try { proc.kill('SIGTERM'); } catch {}
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 3_000))]);
  if (proc.exitCode === null && !proc.killed) {
    try { proc.kill('SIGKILL'); } catch {}
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
  }
}
