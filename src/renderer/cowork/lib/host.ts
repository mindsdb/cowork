// Host-environment abstraction for cowork.
//
// Cowork is rendered in two shells:
//   • Electron desktop — `window.antontron` is populated by the preload
//     bridge (src/main/preload.ts). The bundled FastAPI runs as a child
//     process; the renderer issues IPC for native ops (open file in OS,
//     external URLs, server lifecycle).
//   • Web headless — no preload, no native ops. The FastAPI runs in a
//     separate process / container; cowork talks to it over the canonical
//     `/v1/*` API. Native-shell affordances either map to a sensible web
//     equivalent (openExternal → window.open) or no-op.
//
// All cowork code routes host-side concerns through this module. Direct
// `window.antontron.*` access in cowork/ is forbidden — the lint config
// (or convention) enforces it. This is what lets cowork be the *shared*
// renderer for both shells without scattering platform `if`s.

const HAS_BRIDGE: boolean =
  typeof window !== 'undefined' && !!(window as Record<string, unknown>).antontron;

export const isWeb: boolean = !HAS_BRIDGE;
export const isElectron: boolean = HAS_BRIDGE;

interface BridgeAntontron {
  serverInfo?: () => Promise<{ running: boolean; starting: boolean; port: number; origin: string }>;
  serverStart?: () => Promise<{ running: boolean; starting: boolean }>;
  serverStop?: () => Promise<{ running: boolean; starting: boolean }>;
  getPlatform?: () => string;
  openPath?: (path: string) => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
  trashItem?: (path: string) => Promise<{ ok: boolean; reason?: string }>;
}

const bridge: BridgeAntontron | undefined = HAS_BRIDGE
  ? ((window as unknown as { antontron: BridgeAntontron }).antontron)
  : undefined;

// ─── Server lifecycle ───────────────────────────────────────────────────────
// Electron: the renderer can spawn / kill the bundled FastAPI child process.
// Web: the FastAPI is container-managed (anton-local-environment / Lightsail).
//      We can only observe via /health; start/stop are not user-controllable.

export interface ServerInfo {
  running: boolean;
  starting: boolean;
  port: number;
  origin: string;
}

export async function serverInfo(): Promise<ServerInfo> {
  if (bridge?.serverInfo) {
    return await bridge.serverInfo();
  }
  // Web: probe /health on same origin (nginx fronts the API).
  try {
    const resp = await fetch('/health', {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(3000),
    });
    return {
      running: resp.ok,
      starting: false,
      port: 0,
      origin: typeof window !== 'undefined' ? window.location.origin : '',
    };
  } catch {
    return { running: false, starting: false, port: 0, origin: '' };
  }
}

export async function serverStart(): Promise<{ running: boolean; starting: boolean }> {
  if (bridge?.serverStart) return await bridge.serverStart();
  // Web: server is always-on from the renderer's POV.
  return { running: true, starting: false };
}

export async function serverStop(): Promise<{ running: boolean; starting: boolean }> {
  if (bridge?.serverStop) return await bridge.serverStop();
  // Web: we don't own the server's lifecycle; report it as still up so
  // the UI doesn't spin pretending it stopped.
  return { running: true, starting: false };
}

// ─── Platform detection ────────────────────────────────────────────────────
// Used to flip cmd/ctrl key labels and similar OS-quirky UI bits.

export function getPlatform(): string {
  if (bridge?.getPlatform) return bridge.getPlatform();
  if (typeof navigator === 'undefined') return 'web';
  // navigator.userAgentData (Chrome, Edge); fall back to navigator.platform.
  const ua = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  if (ua?.platform) {
    const p = ua.platform.toLowerCase();
    if (p.includes('mac')) return 'darwin';
    if (p.includes('win')) return 'win32';
    if (p.includes('linux')) return 'linux';
    return p;
  }
  const legacy = navigator.platform || '';
  if (/mac/i.test(legacy)) return 'darwin';
  if (/win/i.test(legacy)) return 'win32';
  if (/linux/i.test(legacy)) return 'linux';
  return 'web';
}

export function isMac(): boolean {
  return getPlatform() === 'darwin';
}

// ─── External / OS-handler navigation ───────────────────────────────────────
// Electron: native file-manager / default app.
// Web: open in a new browser tab where the URL is reachable; no-op for
// host file paths (the browser has no concept of opening "/Users/...").

export async function openExternal(url: string): Promise<void> {
  if (bridge?.openExternal) {
    await bridge.openExternal(url);
    return;
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export async function openPath(p: string): Promise<void> {
  if (bridge?.openPath) {
    await bridge.openPath(p);
    return;
  }
  // Web has no equivalent — host file paths aren't browser-addressable.
  // Log so devs notice when a UI element should be hidden in web mode.
  // eslint-disable-next-line no-console
  console.warn(`[cowork/host] openPath('${p}') is a no-op in web mode`);
}

// ─── Trash / delete on disk ─────────────────────────────────────────────────
// Electron: shell.trashItem moves the path to the OS trash.
// Web: not applicable — artifacts live server-side; deletion goes through
// the canonical API (DELETE /v1/artifacts/...). UI should call that instead.

export async function trashItem(p: string): Promise<{ ok: boolean; reason?: string }> {
  if (bridge?.trashItem) {
    return await bridge.trashItem(p);
  }
  return { ok: false, reason: 'trashItem unavailable in web mode' };
}
