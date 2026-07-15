// Browser Control bridge (M1, read-only) — Electron main-process service.
//
// Owns the CDP connection to the user's own Chrome and the four-state
// lifecycle: disconnected → awaiting-approval → connected → lost. Follows the
// established free-functions + module-state + paired-verbs pattern (mirrors
// the OAuth/keychain/token-refresh trio):
//   - module-level state (bridgeState, approvedTarget, pendingApproval, revoked)
//   - attach / approve / cancelAttach / detach lifecycle verbs
//   - emitState() pushes BridgeStatePayload to the renderer (browser:state)
//   - read-only primitives inspect / navigateApprovedLink / scroll / wait
//   - registerBrowserBridgeHandlers(getWindow) wires ipcMain.handle(...)
//   - disposeAllBridges() for the quit-drain path
//
// SECURITY: read-only only. We speak ONLY the whitelisted CDP domains
// (Page/Runtime/DOM/Accessibility), NEVER Network.getCookies / Storage / Input
// write surfaces. Auth stays inside Chrome. Any command whose target ≠ the
// approved target is refused with `permission_denied` and NO CDP call.

import type { BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-channels';
import {
  type BridgeState,
  type BridgeStatePayload,
  type BrowserActionResult,
  type BrowserActionType,
  type BrowserTab,
  type BrowserStatusResult,
  type ObservedResult,
  type ObservedLink,
  isReadonlyCdpMethod,
  registrableHost,
} from '../shared/browser-bridge-types';
import { CdpClient, type CdpTarget, type WebSocketFactory } from './cdp-client';
import {
  devToolsHttpBase,
  debugPort,
  debugUserDataDir,
  launchArgs,
  resolveChromePath,
} from './chrome-discovery';

type GetWindow = () => BrowserWindow | null;

interface ApprovedTarget {
  targetId: string;
  webSocketDebuggerUrl: string;
  // The originally-approved registrable host. IMMUTABLE after approval — the
  // grant is for exactly this domain. It is NEVER reassigned on navigation or
  // inspect; a cross-host page is discarded and requires re-approval, so the
  // permission can never silently expand to a domain the user never approved.
  readonly domain: string;
  title: string;
  client: CdpClient;
  // The links extracted by the most recent inspect(); the navigate link-gate
  // requires an href to be present here AND to match the approved domain.
  lastLinks: ObservedLink[];
}

// ── Module state (single approved tab, single in-flight approval) ──────────
let bridgeState: BridgeState = 'disconnected';
let approvedTarget: ApprovedTarget | null = null;
let pendingApproval: { targetId: string; cancel: () => void } | null = null;
// flag-then-teardown: set before we tear a session down so an in-flight
// command bails instead of resurrecting a revoked session.
let revoked = false;
// Monotonic approval generation. Bumped on every attach/cancelAttach/detach/
// dispose so an in-flight approve() can detect that its approval was superseded
// or cancelled while it awaited target discovery / CDP connect, and bail out
// instead of resurrecting a connection the user already dismissed.
let approvalGeneration = 0;
let getWindowRef: GetWindow = () => null;
// The ACTIVE conversation the approved tab is bound to. Handed down by the
// renderer at approval time (IPC BROWSER_SET_CONVERSATION); the command poller
// sends it on `/browse/bridge/hello` so cowork-server can upsert the
// conversation-scoped BrowserSession (hello 422s without an identity).
let conversationId: string | null = null;

export function setConversationId(id: string | null | undefined): void {
  conversationId = typeof id === 'string' && id ? id : null;
}

export function getConversationId(): string | null {
  return conversationId;
}

// Local user-Stop signal. The renderer's Stop button sets the SERVER control
// gate (POST /browse/control/stop) but leaves the local bridge connected — so
// a command the server handed out just before the Stop landed would still
// pass the poller's currentState() re-check. This flag is the local half of
// that gate: set via IPC when Stop is pressed, checked by the poller before
// executing any handed-out command, and cleared when a NEW approval starts
// (attach) — the user re-approving is the "resume" gesture.
let stopRequested = false;

export function requestStop(): void {
  stopRequested = true;
}

export function isStopRequested(): boolean {
  return stopRequested;
}

// Main-side bridge-state subscribers (e.g. the command poller). Distinct from
// the renderer push (webContents.send): these are in-process listeners that
// must react to EVERY transition — lost, detach, cross-host nav, reconnect —
// so the server can flip `available` promptly instead of waiting for timeouts.
type BridgeStateListener = (payload: BridgeStatePayload) => void;
const bridgeStateListeners = new Set<BridgeStateListener>();

// Subscribe to every bridge-state transition in the main process. Returns an
// unsubscribe fn. Listener errors are swallowed so one bad subscriber can never
// wedge the state machine.
export function onBridgeStateChange(listener: BridgeStateListener): () => void {
  bridgeStateListeners.add(listener);
  return () => {
    bridgeStateListeners.delete(listener);
  };
}

function notifyStateListeners(payload: BridgeStatePayload): void {
  for (const listener of bridgeStateListeners) {
    try {
      listener(payload);
    } catch {
      /* a subscriber must never wedge the bridge */
    }
  }
}

// Dependency injection seams (tests). The HTTP probe + CDP transport +
// Chrome-spawn are swappable so unit/integration tests never touch a real
// socket or launch a real browser.
interface BridgeDeps {
  // GET <base>/json/list → CDP targets.
  listTargets: (base: string) => Promise<CdpTarget[]>;
  wsFactory?: WebSocketFactory;
  // Resolve the Chrome binary path (null when none is found).
  resolveChrome?: () => string | null;
  // Spawn Chrome with the given binary + args, detached. Returns a disposer.
  spawnChrome?: (chromePath: string, args: string[]) => { dispose: () => void };
  // Probe whether the DevTools debug port is already accepting connections.
  probeDebugPort?: (base: string) => Promise<boolean>;
}

let deps: BridgeDeps = {
  listTargets: defaultListTargets,
};

// Handle to the Chrome process WE spawned (null when Chrome was already
// running on the port, or we haven't launched it). Used to avoid double-launch
// and to tear our managed Chrome down on dispose.
let managedChrome: { dispose: () => void } | null = null;

// Test-only: override HTTP/WS transport. Returns a restore fn.
export function __setBridgeDeps(next: Partial<BridgeDeps>): () => void {
  const prev = deps;
  deps = { ...deps, ...next };
  return () => {
    deps = prev;
  };
}

// Test-only: install a window sink so emitState pushes are observable without
// the electron ipcMain wiring (require('electron') is unavailable in the node
// test env).
export function __setWindowForTest(getWindow: GetWindow): void {
  getWindowRef = getWindow;
}

// Test-only: reset all module state between cases.
export function __resetBridgeForTest(): void {
  try {
    approvedTarget?.client.close();
  } catch {
    /* ignore */
  }
  bridgeState = 'disconnected';
  approvedTarget = null;
  pendingApproval = null;
  revoked = false;
  approvalGeneration = 0;
  try {
    managedChrome?.dispose();
  } catch {
    /* ignore */
  }
  managedChrome = null;
  getWindowRef = () => null;
  bridgeStateListeners.clear();
  conversationId = null;
  stopRequested = false;
}

async function defaultListTargets(base: string): Promise<CdpTarget[]> {
  const res = await fetch(`${base}/json/list`);
  if (!res.ok) throw new Error(`Chrome debug endpoint returned HTTP ${res.status}`);
  const json = (await res.json()) as CdpTarget[];
  return Array.isArray(json) ? json : [];
}

// Default Chrome resolver: fs.existsSync-backed candidate scan.
function defaultResolveChrome(): string | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { existsSync } = require('fs') as typeof import('fs');
  return resolveChromePath((p) => existsSync(p));
}

// Default Chrome spawner: detached child_process.spawn so Chrome outlives a
// transient main-process hiccup. Returns a disposer that kills the child.
function defaultSpawnChrome(chromePath: string, args: string[]): { dispose: () => void } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawn } = require('child_process') as typeof import('child_process');
  const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => { /* surfaced by the port-wait failing */ });
  try { child.unref(); } catch { /* ignore */ }
  return {
    dispose: () => {
      try { child.kill(); } catch { /* ignore */ }
    },
  };
}

// Default port probe: GET /json/version succeeds only if a DevTools endpoint is
// live on the port. Short-lived — a failure just means "not up yet".
async function defaultProbeDebugPort(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

function d<K extends keyof BridgeDeps>(key: K): NonNullable<BridgeDeps[K]> {
  const fallbacks: Required<Pick<BridgeDeps,
    'resolveChrome' | 'spawnChrome' | 'probeDebugPort'>> = {
    resolveChrome: defaultResolveChrome,
    spawnChrome: defaultSpawnChrome,
    probeDebugPort: defaultProbeDebugPort,
  };
  return (deps[key] ?? (fallbacks as Record<string, unknown>)[key as string]) as NonNullable<BridgeDeps[K]>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Ensure a Chrome is running on the debug port with our dedicated debug
// profile, then confirm the DevTools endpoint is reachable. Idempotent and
// tolerant of "already running on the port":
//   1. If the port already answers, reuse it (user or a prior launch) — do NOT
//      spawn a second Chrome.
//   2. Otherwise resolve the Chrome binary and SPAWN it with launchArgs()
//      (persistent --user-data-dir debug profile), then poll the port until it
//      accepts, up to a bounded timeout.
// Returns { ok } — on failure the connect flow surfaces a graceful reason and
// stays disconnected rather than probing a port that will never answer.
export async function ensureManagedChrome(): Promise<{ ok: boolean; reason?: string }> {
  const port = debugPort();
  const base = devToolsHttpBase(port);
  const probe = d('probeDebugPort');

  // (1) Already up on the port — reuse it.
  if (await probe(base)) return { ok: true };

  // (2) Resolve + spawn our managed Chrome (once).
  if (!managedChrome) {
    const chromePath = d('resolveChrome')();
    if (!chromePath) {
      return {
        ok: false,
        reason: 'Could not find Google Chrome. Install Chrome to use Browser Control.',
      };
    }
    managedChrome = d('spawnChrome')(chromePath, launchArgs(port, debugUserDataDir()));
  }

  // Poll the port until Chrome's DevTools endpoint accepts (bounded).
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await probe(base)) return { ok: true };
    await sleep(200);
  }
  return { ok: false, reason: 'Chrome did not open a debugging session in time.' };
}

// ── State + events ─────────────────────────────────────────────────────────

function emitState(reason?: string): void {
  const payload: BridgeStatePayload = { state: bridgeState };
  if (approvedTarget) {
    payload.domain = approvedTarget.domain;
    payload.tabTitle = approvedTarget.title;
  }
  if (reason) payload.reason = reason;
  getWindowRef()?.webContents.send(IPC.BROWSER_STATE, payload);
  notifyStateListeners(payload);
}

function setState(next: BridgeState, reason?: string): void {
  bridgeState = next;
  emitState(reason);
}

export function currentState(): BridgeState {
  return bridgeState;
}

export function status(): BrowserStatusResult {
  const out: BrowserStatusResult = { available: true, state: bridgeState };
  if (approvedTarget) {
    out.domain = approvedTarget.domain;
    out.tabTitle = approvedTarget.title;
  }
  return out;
}

// ── Tab discovery (for the approval picker) ─────────────────────────────────

export async function listTabs(): Promise<{ ok: boolean; tabs: BrowserTab[]; reason?: string }> {
  try {
    // Connect flow entry point: make sure OUR managed Chrome (dedicated debug
    // profile on the loopback debug port) is running before we discover tabs,
    // so Browser Control works without the user manually launching Chrome with
    // the right flags. Reuses an already-running port gracefully.
    const launched = await ensureManagedChrome();
    if (!launched.ok) return { ok: false, tabs: [], reason: launched.reason };
    const targets = await deps.listTargets(devToolsHttpBase(debugPort()));
    const tabs: BrowserTab[] = targets
      .filter((t) => t.type === 'page' && !!t.webSocketDebuggerUrl)
      .map((t) => ({
        targetId: t.id,
        title: t.title || t.url,
        url: t.url,
        domain: registrableHost(t.url),
      }));
    return { ok: true, tabs };
  } catch (err) {
    return { ok: false, tabs: [], reason: safeReason(err) };
  }
}

// ── Lifecycle: attach → approve → connected ─────────────────────────────────

// Begin an approval for `targetId`. Moves to awaiting-approval and records a
// single in-flight pending approval (mirrors oauth _activeAttempt). The
// renderer confirms the pick by calling approve(); cancelAttach() aborts.
export async function attach(
  targetId: string,
): Promise<{ ok: boolean; state: BridgeState; reason?: string }> {
  if (pendingApproval) {
    // Single in-flight approval — cancel the prior one first.
    pendingApproval.cancel();
    pendingApproval = null;
  }
  revoked = false;
  // A fresh approval is the user's "resume" gesture — clear any local Stop.
  stopRequested = false;
  // New approval supersedes any in-flight approve() awaiting connect.
  approvalGeneration += 1;
  pendingApproval = { targetId, cancel: () => {} };
  setState('awaiting-approval');
  return { ok: true, state: bridgeState };
}

// Confirm the pending approval: connect the CDP socket to the chosen target,
// enable the read-only domains, wire lost-detection, pin the approved target,
// and move to connected.
export async function approve(): Promise<{ ok: boolean; state: BridgeState; reason?: string }> {
  if (!pendingApproval) {
    return { ok: false, state: bridgeState, reason: 'No pending tab approval.' };
  }
  const targetId = pendingApproval.targetId;
  // Snapshot the generation this approval belongs to. A cancel/detach/dispose
  // or a superseding attach that lands while we await below bumps the
  // generation (or sets `revoked`); we re-check after every await and abort
  // rather than committing a connection the user already dismissed.
  const generation = approvalGeneration;
  const superseded = (): boolean =>
    revoked || approvalGeneration !== generation || pendingApproval === null;
  try {
    const targets = await deps.listTargets(devToolsHttpBase(debugPort()));
    if (superseded()) return abortStaleApproval();
    const target = targets.find((t) => t.id === targetId);
    if (!target || !target.webSocketDebuggerUrl) {
      pendingApproval = null;
      setState('disconnected', 'The chosen tab is no longer available.');
      return { ok: false, state: bridgeState, reason: 'The chosen tab is no longer available.' };
    }

    const client = new CdpClient({ wsFactory: deps.wsFactory });
    await client.connect(target.webSocketDebuggerUrl);
    if (superseded()) {
      try { client.close(); } catch { /* ignore */ }
      return abortStaleApproval();
    }
    // Enable only the read-only domains we consume.
    await client.send('Page.enable', {});
    await client.send('Runtime.enable', {});
    await client.send('DOM.enable', {});
    if (superseded()) {
      try { client.close(); } catch { /* ignore */ }
      return abortStaleApproval();
    }

    approvedTarget = {
      targetId,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
      domain: registrableHost(target.url),
      title: target.title || target.url,
      client,
      lastLinks: [],
    };
    pendingApproval = null;

    // Lost-detection: the approved tab closing OR the socket dropping → lost.
    client.on('Target.targetDestroyed', (params: unknown) => {
      const p = params as { targetId?: string };
      if (p?.targetId && p.targetId === approvedTarget?.targetId) {
        handleLost('The approved Chrome tab was closed.');
      }
    });
    client.on('close', () => {
      if (approvedTarget && bridgeState === 'connected') {
        handleLost('The browser bridge disconnected.');
      }
    });
    // Same-tab navigation on the MAIN frame. A same-host path/redirect change
    // stays connected (the grant is unchanged). A navigation to a DIFFERENT
    // registrable host must NOT silently re-grant: we drop the connection to
    // `lost` so the user must re-approve for the new domain. The approved
    // `domain` field is immutable and is never updated here.
    client.on('Page.frameNavigated', (params: unknown) => {
      const p = params as { frame?: { parentId?: string; url?: string } };
      const frame = p?.frame;
      if (!frame || frame.parentId || !approvedTarget) return; // main frame only
      if (!frame.url) return;
      const host = registrableHost(frame.url);
      // Empty host (about:blank etc.) — ignore, no cross-host expansion.
      if (host && host !== approvedTarget.domain) {
        handleLost('The tab navigated to a different site, so the approval no longer applies.');
      }
    });

    setState('connected');
    return { ok: true, state: bridgeState };
  } catch (err) {
    // Don't clobber a terminal state a concurrent cancel/detach already set.
    if (approvalGeneration === generation && !revoked) {
      pendingApproval = null;
      setState('disconnected', safeReason(err));
    }
    return { ok: false, state: bridgeState, reason: safeReason(err) };
  }
}

// An in-flight approve() discovered mid-connect that its approval was cancelled
// / superseded / revoked. The lifecycle verb that superseded it (cancelAttach /
// detach / a new attach) already owns the current state, so we just report the
// current (non-connected) state without transitioning again.
function abortStaleApproval(): { ok: boolean; state: BridgeState; reason?: string } {
  return {
    ok: false,
    state: bridgeState,
    reason: 'The tab approval was cancelled before it completed.',
  };
}

export function cancelAttach(): void {
  // Supersede any in-flight approve() awaiting connect.
  approvalGeneration += 1;
  if (pendingApproval) {
    pendingApproval.cancel();
    pendingApproval = null;
  }
  if (bridgeState === 'awaiting-approval') {
    setState('disconnected');
  }
}

// Revoke/detach — collapse to the same teardown. flag-then-teardown ordering.
export async function detach(): Promise<{ ok: boolean }> {
  revoked = true;
  // Supersede any in-flight approve() awaiting connect so it can't resurrect
  // the connection after this teardown.
  approvalGeneration += 1;
  pendingApproval = null;
  // The conversation binding dies with the approval: a revoke/take-over ends
  // the tab↔conversation pairing, and the NEXT approval must re-bind to the
  // conversation active at that time — never inherit this one.
  conversationId = null;
  const target = approvedTarget;
  approvedTarget = null;
  try {
    target?.client.close();
  } catch {
    /* ignore */
  }
  setState('disconnected');
  return { ok: true };
}

function handleLost(reason: string): void {
  if (!approvedTarget) return;
  try {
    approvedTarget.client.close();
  } catch {
    /* ignore */
  }
  // Keep the approved target's domain/title for the lost pane? The plan's
  // "lost" pane shows a warning + Reconnect; drop the live client but keep
  // state=lost. We clear the client but retain domain via reason only.
  const domain = approvedTarget.domain;
  approvedTarget = null;
  bridgeState = 'lost';
  const payload: BridgeStatePayload = { state: 'lost', reason, domain };
  getWindowRef()?.webContents.send(IPC.BROWSER_STATE, payload);
  notifyStateListeners(payload);
}

// ── Read-only primitives ─────────────────────────────────────────────────

// Guard: allowlist-based — reject any CDP method whose domain is not one of the
// read-only domains {Page, Runtime, DOM, Accessibility}, and within those still
// reject any explicit forbidden method or write/input/cookie/storage verb.
function assertReadonly(method: string): void {
  if (!isReadonlyCdpMethod(method)) {
    throw new UnsupportedActionError(method);
  }
}

class UnsupportedActionError extends Error {
  constructor(method: string) {
    super(`Refused a non-read-only CDP method: ${method}`);
    this.name = 'UnsupportedActionError';
  }
}

// Common pre-flight for every primitive: not revoked, connected, target set.
function ensureConnected(action: BrowserActionType): BrowserActionResult | null {
  if (revoked) {
    return { status: 'permission_denied', action, reason: 'The browser bridge was revoked.' };
  }
  if (bridgeState !== 'connected' || !approvedTarget) {
    return {
      status: 'bridge_disconnected',
      action,
      reason: 'No approved Chrome tab is connected.',
    };
  }
  return null;
}

// A guarded CDP send: refuses forbidden methods, funnels client rejections
// into a typed error at the call site.
async function cdp(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  assertReadonly(method);
  if (!approvedTarget) throw new Error('No approved target');
  return approvedTarget.client.send(method, params);
}

// The read-only page-extraction expression run via Runtime.evaluate. Returns a
// content-bearing snapshot for the transient observed result. Never reads
// cookies, storage, or form field values.
const EXTRACT_EXPRESSION = `(() => {
  const trunc = (s, n) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, n);
  const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
    .map((h) => trunc(h.textContent, 160)).filter(Boolean).slice(0, 40);
  const links = Array.from(document.querySelectorAll('a[href]'))
    .map((a) => ({ text: trunc(a.textContent, 120), href: a.href }))
    .filter((l) => l.href && l.href.startsWith('http')).slice(0, 200);
  return {
    url: location.href,
    title: document.title,
    text: trunc(document.body ? document.body.innerText : '', 8000),
    headings,
    links,
    viewport: {
      scrollX: window.scrollX, scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    },
  };
})()`;

async function extractObserved(): Promise<ObservedResult> {
  const result = await cdp('Runtime.evaluate', {
    expression: EXTRACT_EXPRESSION,
    returnByValue: true,
  });
  const value = (result as { result?: { value?: ObservedResult } }).result?.value;
  return value ?? {};
}

// inspect() — read the visible page (text, headings, links, viewport).
export async function inspect(): Promise<BrowserActionResult> {
  const pre = ensureConnected('inspect');
  if (pre) return pre;
  try {
    const observed = await extractObserved();
    // The page may have drifted to a different host (e.g. a client-side
    // redirect) since approval. The grant is for the approved domain ONLY:
    // discard the observation for a different host and require re-approval
    // instead of silently reading (and citing) an unapproved site.
    const target = approvedTarget;
    if (target && observed.url) {
      const host = registrableHost(observed.url);
      if (host && host !== target.domain) {
        handleLost('The tab is on a different site than the one you approved.');
        return {
          status: 'permission_denied',
          action: 'inspect',
          reason: 'The tab is on a different site than the one you approved.',
        };
      }
    }
    if (target) target.lastLinks = observed.links ?? [];
    return { status: 'ok', action: 'inspect', observed };
  } catch (err) {
    return classifyError('inspect', err);
  }
}

// navigateApprovedLink() — follow a link that is present in the last inspect's
// extracted links AND whose registrable host matches the approved grant. A
// link (or redirect) landing on a different host is `navigation_failed`.
export async function navigateApprovedLink(href: string): Promise<BrowserActionResult> {
  const pre = ensureConnected('navigate');
  if (pre) return pre;
  const target = approvedTarget!;
  const known = target.lastLinks.some((l) => l.href === href);
  if (!known) {
    return {
      status: 'navigation_failed',
      action: 'navigate',
      reason: 'That link is not one of the links found on the approved page.',
    };
  }
  if (registrableHost(href) !== target.domain) {
    return {
      status: 'navigation_failed',
      action: 'navigate',
      reason: 'That link leaves the approved site.',
    };
  }
  try {
    await cdp('Page.navigate', { url: href });
    // Give the page a beat to settle, then read back to verify the domain.
    await sleep(400);
    const observed = await extractObserved();
    const landedHost = registrableHost(observed.url || '');
    if (landedHost && landedHost !== target.domain) {
      return {
        status: 'navigation_failed',
        action: 'navigate',
        reason: 'That link leaves the approved site.',
      };
    }
    target.lastLinks = observed.links ?? target.lastLinks;
    return { status: 'ok', action: 'navigate', observed };
  } catch (err) {
    return classifyError('navigate', err);
  }
}

// scroll() — move the viewport by one page in the given direction and read the
// new viewport back so the caller can verify it took effect.
export async function scroll(direction: 'down' | 'up' = 'down'): Promise<BrowserActionResult> {
  const pre = ensureConnected('scroll');
  if (pre) return pre;
  try {
    const sign = direction === 'up' ? -1 : 1;
    await cdp('Runtime.evaluate', {
      expression: `window.scrollBy(0, ${sign} * Math.round(window.innerHeight * 0.9))`,
    });
    await sleep(150);
    const observed = await extractObserved();
    if (approvedTarget) approvedTarget.lastLinks = observed.links ?? approvedTarget.lastLinks;
    return { status: 'ok', action: 'scroll', observed };
  } catch (err) {
    return classifyError('scroll', err);
  }
}

// wait() — pause for the page to settle, then re-read. Bounded.
export async function wait(ms = 1000): Promise<BrowserActionResult> {
  const pre = ensureConnected('wait');
  if (pre) return pre;
  try {
    await sleep(Math.min(Math.max(ms, 0), 10000));
    const observed = await extractObserved();
    return { status: 'ok', action: 'wait', observed };
  } catch (err) {
    return classifyError('wait', err);
  }
}

function classifyError(action: BrowserActionType, err: unknown): BrowserActionResult {
  if (err instanceof UnsupportedActionError) {
    return { status: 'unsupported_action', action, reason: 'That action is not read-only.' };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/closed/i.test(msg)) {
    return { status: 'tab_closed', action, reason: 'The approved Chrome tab was closed.' };
  }
  if (action === 'navigate') {
    return { status: 'navigation_failed', action, reason: safeReason(err) };
  }
  return { status: 'bridge_disconnected', action, reason: safeReason(err) };
}

// ── Teardown ───────────────────────────────────────────────────────────────

export function disposeAllBridges(): void {
  try {
    approvedTarget?.client.close();
  } catch {
    /* ignore */
  }
  approvedTarget = null;
  pendingApproval = null;
  revoked = true;
  approvalGeneration += 1;
  bridgeState = 'disconnected';
  conversationId = null;
  stopRequested = false;
  // Tear down the Chrome WE launched (app quit / full drain). If Chrome was
  // already running on the port when we attached, managedChrome is null and we
  // leave the user's own Chrome alone.
  try {
    managedChrome?.dispose();
  } catch {
    /* ignore */
  }
  managedChrome = null;
}

// ── IPC wiring ───────────────────────────────────────────────────────────

export function registerBrowserBridgeHandlers(getWindow: GetWindow): void {
  getWindowRef = getWindow;
  const { ipcMain } = require('electron');
  ipcMain.handle(IPC.BROWSER_STATUS, () => status());
  ipcMain.handle(IPC.BROWSER_LIST_TABS, () => listTabs());
  ipcMain.handle(IPC.BROWSER_ATTACH, (_e: unknown, targetId: string) => attach(targetId));
  ipcMain.handle(IPC.BROWSER_APPROVE, () => approve());
  ipcMain.handle(IPC.BROWSER_CANCEL_ATTACH, () => {
    cancelAttach();
    return { ok: true };
  });
  ipcMain.handle(IPC.BROWSER_DETACH, () => detach());
  ipcMain.handle(IPC.BROWSER_REVOKE, () => detach());
  ipcMain.handle(IPC.BROWSER_TAKE_OVER, () => detach());
  ipcMain.handle(IPC.BROWSER_SET_CONVERSATION, (_e: unknown, id: string | null) => {
    setConversationId(id);
    return { ok: true };
  });
  ipcMain.handle(IPC.BROWSER_STOP, () => {
    requestStop();
    return { ok: true };
  });
  ipcMain.handle(IPC.BROWSER_INSPECT, () => inspect());
  ipcMain.handle(IPC.BROWSER_NAVIGATE, (_e: unknown, href: string) => navigateApprovedLink(href));
  ipcMain.handle(IPC.BROWSER_SCROLL, (_e: unknown, direction: 'down' | 'up') => scroll(direction));
  ipcMain.handle(IPC.BROWSER_WAIT, (_e: unknown, ms: number) => wait(ms));
}

// ── helpers ────────────────────────────────────────────────────────────────

// A short, user-safe reason with no secrets / raw page content.
function safeReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 200);
}
