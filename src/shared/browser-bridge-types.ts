// Browser Control (Milestone 1, read-only) — shared type contract.
//
// This module is the single source of truth for the bridge state machine,
// the five canonical error kinds, and the typed action result shape. It is
// imported by BOTH the Electron main process (CDP bridge, command poller)
// and — via host.ts — the renderer, so it must stay electron-free and free
// of environment-specific dependencies. (tldts is allowed: pure offline
// data + TS, no Node/DOM APIs, bundles for both targets.)
//
// The bridge drives the user's own Chrome over CDP in READ-ONLY mode. It
// never types, clicks, submits, downloads, or reads cookies/storage. Auth
// stays inside Chrome; the bridge only issues whitelisted read-only CDP
// commands and serializes a chosen, content-bearing "observed" result for
// the answer path (which is NEVER persisted — see the transient-vs-persisted
// split in the plan's Shared-contracts section).

import { getDomain } from 'tldts';

// The four bridge lifecycle states (plan WS1-T2 state machine):
//   disconnected      → nothing attached
//   awaiting-approval → a tab picker / approval is pending (single in-flight)
//   connected         → one approved tab is live; commands may run
//   lost              → the approved tab closed or the socket dropped
export type BridgeState =
  | 'disconnected'
  | 'awaiting-approval'
  | 'connected'
  | 'lost';

// The FIVE canonical external error kinds (plus `ok`). This is the entire
// vocabulary the agent tool + UI ever see. Richer server-internal result
// codes (timeout/target_lost/unapproved_tab/...) MUST be mapped to one of
// these before crossing into the renderer or the agent tool.
export type BrowserErrorKind =
  | 'permission_denied'
  | 'bridge_disconnected'
  | 'tab_closed'
  | 'navigation_failed'
  | 'unsupported_action';

// `ok` plus the five error kinds. `stopped` / `taken_over` are NOT here —
// they are control terminal states carried on the control channel, surfaced
// by the UI as distinct (non-error) states, never as a BrowserErrorKind.
export type BrowserActionStatus = 'ok' | BrowserErrorKind;

// The stored action type (plan action-name mapping table). The LLM verb
// `follow_link` maps to the primitive `navigateApprovedLink()` and the stored
// type `navigate`.
export type BrowserActionType = 'inspect' | 'navigate' | 'scroll' | 'wait';

// A single link extracted from the approved page. `href` is kept ONLY on the
// transient observed result (returned to the model / rendered as a citation);
// it is never written to the DB.
export interface ObservedLink {
  text: string;
  href: string;
}

// TRANSIENT observed result — may carry the visible extraction needed to
// answer + cite. Returned to the model and rendered; NEVER persisted. Every
// field is optional so a primitive only fills what it read.
export interface ObservedResult {
  // Post-action page identity (used to verify navigation / re-validate the
  // approved domain). `url` is the full URL for the transient path only.
  url?: string;
  title?: string;
  // Truncated visible text extracted from the page (read-only).
  text?: string;
  headings?: string[];
  links?: ObservedLink[];
  // Scroll / viewport read-back so navigate/scroll can verify they took
  // effect (post-action read-back requirement).
  viewport?: {
    scrollX: number;
    scrollY: number;
    scrollHeight: number;
    innerHeight: number;
  };
}

// The typed result of every bridge primitive. On `ok`, `observed` is
// populated (an action that produced no observation is NEVER `ok`). On an
// error kind, `reason` is a short, user-safe string (no secrets, no raw page
// dumps).
export interface BrowserActionResult {
  status: BrowserActionStatus;
  action: BrowserActionType;
  observed?: ObservedResult;
  reason?: string;
}

// Payload pushed to the renderer on every state transition
// (IPC `browser:state`).
export interface BridgeStatePayload {
  state: BridgeState;
  // Registrable host of the approved tab, when connected. Host-only — never a
  // full URL.
  domain?: string;
  // Title of the approved tab, for display in the connected pane / badge.
  tabTitle?: string;
  // Short reason for a `lost` transition (e.g. "tab closed").
  reason?: string;
}

// A tab candidate returned by listTabs() for the approval picker. `domain` is
// the registrable host; `url` is shown truncated by the picker.
export interface BrowserTab {
  targetId: string;
  title: string;
  url: string;
  domain: string;
}

// Result of a status query (host.browserControlStatus()).
export interface BrowserStatusResult {
  // Whether the bridge is even usable in this build (Electron-only; web → false).
  available: boolean;
  state: BridgeState;
  domain?: string;
  tabTitle?: string;
}

// ── Internal → external mapping (plan Shared-contracts table) ──────────────
// The command poller receives richer internal result codes from cowork-server;
// they MUST be collapsed to the five canonical kinds before crossing out.
export type InternalResultCode =
  | 'ok'
  | 'timeout'
  | 'target_lost'
  | 'unapproved_tab'
  | 'permission_denied'
  | 'error';

// Map an internal result code to the canonical external status. `error` maps
// to `navigation_failed` for a navigate action, else `bridge_disconnected`.
export function toExternalStatus(
  code: InternalResultCode,
  action: BrowserActionType,
): BrowserActionStatus {
  switch (code) {
    case 'ok':
      return 'ok';
    case 'timeout':
      return 'bridge_disconnected';
    case 'target_lost':
      return 'tab_closed';
    case 'unapproved_tab':
      return 'permission_denied';
    case 'permission_denied':
      return 'permission_denied';
    case 'error':
      return action === 'navigate' ? 'navigation_failed' : 'bridge_disconnected';
    default:
      return 'bridge_disconnected';
  }
}

// Reverse mapping: the poller POSTs `/browse/commands/{id}/result` with the
// SERVER-INTERNAL result_code enum (cowork-server BridgeCommandResult), not
// the external status. Chosen so the server's result_code_to_error_kind maps
// each code back to the same external kind we started from:
//   ok                 → ok
//   permission_denied  → permission_denied
//   tab_closed         → target_lost   (target_lost → tab_closed)
//   bridge_disconnected→ timeout       (timeout → bridge_disconnected)
//   navigation_failed  → error         (error → navigation_failed for navigate)
//   unsupported_action → error         (no internal code exists; detail carries it)
export function toInternalResultCode(status: BrowserActionStatus): InternalResultCode {
  switch (status) {
    case 'ok':
      return 'ok';
    case 'permission_denied':
      return 'permission_denied';
    case 'tab_closed':
      return 'target_lost';
    case 'bridge_disconnected':
      return 'timeout';
    case 'navigation_failed':
    case 'unsupported_action':
      return 'error';
    default:
      return 'error';
  }
}

// The server's BridgeState enum uses underscores (`awaiting_approval`); the
// bridge's internal state machine uses hyphens (`awaiting-approval`). Map at
// the transport boundary — `/browse/bridge/state` 422s on the hyphen form.
export type ServerBridgeState = 'disconnected' | 'awaiting_approval' | 'connected' | 'lost';
export function toServerBridgeState(state: BridgeState): ServerBridgeState {
  return state === 'awaiting-approval' ? 'awaiting_approval' : state;
}

// The CDP domains the bridge's read-only methods live in. DOCUMENTATION ONLY —
// membership grants nothing: the guard below allowlists exact method names
// (see READONLY_CDP_METHODS), never whole domains, because e.g. `Runtime`
// also contains arbitrary-JS-execution methods (callFunctionOn, runScript).
export const READONLY_CDP_DOMAINS = ['Page', 'Runtime', 'DOM', 'Accessibility'] as const;
export type ReadonlyCdpDomain = (typeof READONLY_CDP_DOMAINS)[number];

// High-risk CDP methods asserted by tests to NEVER be sent (cookie/storage
// reads, input dispatch, download control). Redundant with the exact-method
// allowlist below — kept as an explicit tripwire list for test assertions.
export const FORBIDDEN_CDP_METHODS = [
  'Network.getCookies',
  'Network.getAllCookies',
  'Network.setCookie',
  'Storage.getCookies',
  'Storage.clearDataForOrigin',
  'Page.setDownloadBehavior',
  'Browser.setDownloadBehavior',
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
] as const;

// EXACT-METHOD allowlist: the only CDP methods the bridge is ever allowed to
// send. There is deliberately NO domain-level or verb-heuristic fallback — an
// allowlisted domain like `Runtime` still exposes arbitrary-code-execution
// surfaces (Runtime.callFunctionOn, Runtime.runScript, Runtime.compileScript)
// whose names pass any verb regex, so anything not enumerated here byte-for-
// byte is refused. Grow this list one concrete method at a time, never by
// domain.
//
// Runtime.evaluate NOTE: it is enumerated because the bridge's own read-only
// primitives (inspect/scroll snapshot extraction) send it with BRIDGE-OWNED
// constant expressions. The expression itself is NOT validated by this guard —
// any path that would forward an externally-supplied expression must NOT rely
// on isReadonlyCdpMethod alone and needs its own gate. The M1 bridge has no
// such path: the server only hands out high-level action types
// (inspect/navigate/scroll/wait); raw CDP methods/expressions never cross the
// wire.
export const READONLY_CDP_METHODS = [
  'Page.enable',
  'Page.navigate', // targets are governed by the same-site link gate
  'Runtime.enable',
  'Runtime.evaluate', // bridge-owned constant expressions only — see note
  'DOM.enable',
  'Accessibility.enable',
  'Accessibility.getFullAXTree',
  'Accessibility.getRootAXNode',
] as const;

const READONLY_CDP_METHOD_SET: ReadonlySet<string> = new Set(READONLY_CDP_METHODS);

// Allowlist-based read-only CDP guard: a method is allowed ONLY when it is one
// of the exact READONLY_CDP_METHODS. Everything else — including "read-y"
// methods in allowlisted domains (Runtime.callFunctionOn, Runtime.runScript,
// DOM.getDocument) — is refused. Returns true when the method is safe to send.
export function isReadonlyCdpMethod(method: string): boolean {
  if (!method || typeof method !== 'string') return false;
  return READONLY_CDP_METHOD_SET.has(method);
}

// Returns the registrable host ("example.com") of a URL, or '' when it can't
// be parsed. Host-only — strips path/query/hash. This is the SINGLE derivation
// used by the approve-time grant value, the same-site link gate, the
// domain-scope (cross-host nav → lost) check, and the poller's content-free
// digest — they must never diverge, or an approval could scope one way and
// the gates another.
//
// Uses the Public Suffix List (tldts, offline) instead of a last-two-labels
// heuristic: under a multi-label public suffix ("foo.github.io", "bank.co.uk")
// the heuristic collapsed UNRELATED sites to the shared suffix ("github.io",
// "co.uk"), so approving one site would have let the bridge read/follow links
// on any other site under that suffix. `allowPrivateDomains` counts private
// PSL entries (github.io, herokuapp.com, …) as suffixes, which is the correct
// isolation boundary here. When no registrable domain exists (IP literals,
// localhost, single-label intranet hosts) we FAIL SAFE to the exact hostname —
// the grant then matches only that host.
export function registrableHost(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host) return '';
    return getDomain(host, { allowPrivateDomains: true }) ?? host;
  } catch {
    return '';
  }
}
