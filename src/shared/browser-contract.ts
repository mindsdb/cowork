/*
 * The in-app browser's contract, in one module.
 *
 * Two halves live here. The HTTP half is what Electron main serves on
 * 127.0.0.1 for anton's browser tool (anton/core/browser/client.py reads the
 * answers into anton/core/browser/models.py). anton owns that contract and its
 * JSON fixtures; src/main/__fixtures__/browser-contract keeps copies, and
 * browser-contract.test.ts parses every one through the guards below. The
 * browser router's pod serves the same routes on the web, so a change here is
 * a change in three places. The IPC half is what main and the browser pane in
 * the renderer send each other.
 *
 * Request bodies are checked by hand-written guards because the app has no
 * schema library. Each guard returns a tagged result, so a caller always knows
 * which refusal it got.
 */

/** GET /healthz's `api`. Bumped with any shape change. */
export const BROWSER_HOST_API = 2;

/** A task's session id and a project key. anton's BrowserConfig and the renderer's
    Browser step use the same pattern. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const PROJECT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The address main registers with the local server, and the launch key's form
    (32 random bytes in base64url). cowork-server's PUT
    /api/v1/runtime-credential/browser and anton's in-app BrowserConfig accept
    exactly these. */
export const BRIDGE_URL_PATTERN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;
export const BRIDGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function bridgeUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** The oldest Electron major that may host the in-app browser. The browser
    holds the person's sign-ins, so it runs only on a Chromium that still gets
    security fixes. Raise it as Electron majors leave support; never lower it. */
export const MIN_IN_APP_BROWSER_ELECTRON_MAJOR = 44;

/** Whether a shell on this Electron (`process.versions.electron`) may host
    the in-app browser. An unknown version may not. */
export function electronHostsInAppBrowser(version: string | undefined): boolean {
  const major = /^(\d+)\./.exec(version ?? '')?.[1];
  return major !== undefined && Number(major) >= MIN_IN_APP_BROWSER_ELECTRON_MAJOR;
}

/** A project keeps at most this many saved tabs, on the desktop and in the web
    pod alike (saved_tabs.json `limits.saved_tabs_per_project`). A new name past
    it is refused with 409 too_many_saved_tabs. */
export const MAX_SAVED_TABS_PER_PROJECT = 100;

/** Screenshots are scaled down to this width; `coords: "screenshot"` points
    scale back up by the same factor. The web pod uses the same width. */
export const MAX_SCREENSHOT_WIDTH = 1024;

/** A wait step's ceiling, and the hand-over reason's length cap: a longer
    reason gets 400, as on the web pod (anton cuts it at 300 before sending). */
export const MAX_WAIT_MS = 30_000;
export const MAX_CONTROL_REASON = 300;

/** How long anton's client waits for a call's answer (REQUEST_TIMEOUT_S in
    anton/core/browser/client.py); its first call to the app's host waits the
    same. Its timer starts before the host reads the call, so the host must
    answer a step well inside it. */
export const ANTON_REQUEST_TIMEOUT_MS = 45_000;

/** How long an agent step may run, past the wait a wait step asks for, before
    the host ends it with 409 page_blocked. A step still running then has met
    something that blocks the page, most often a dialog the person must
    answer. The budget is longer than a navigation's wait (NAVIGATION_WAIT_MS
    in src/main/browser-view.ts), so a slow load still answers 200. The budget
    plus the page read an include_page step adds (PAGE_READ_TIMEOUT_MS in
    src/main/browser-page-script.ts) ends inside ANTON_REQUEST_TIMEOUT_MS, so
    page_blocked reaches anton, which tells the agent a dialog may be open,
    before anton stops waiting. A type step's keyed typing is sized to end
    inside the budget (KEYED_CHARS in src/main/browser-input.ts). */
export const STEP_TIMEOUT_MS = 33_000;

/** A step settles before it answers (ElectronTab.act in
    src/main/browser-view.ts). One that started a main-frame request or a
    navigation, or changed the page in place, waits until those requests are
    done, nothing shown is marked aria-busy and the page has shown no change
    for SETTLE_QUIET_MS, at most SETTLE_MAX_MS, and always inside
    STEP_TIMEOUT_MS; after an in-place change that started nothing it stops
    SETTLE_QUIET_MS past its first look, so a page that changes on its own (a
    ticker) doesn't hold every step to the cap. One that changed nothing and
    started neither answers SETTLE_QUIET_MS into its settle, unless the page
    shows something marked aria-busy, so a request it starts by then (a
    search box's suggestions) is waited for, as on the web pod. The web pod
    holds the same two numbers, and action.json's `limits` pins both. */
export const SETTLE_MAX_MS = 3_000;
export const SETTLE_QUIET_MS = 400;

/** A page read's child frames, as page.json's `limits` pins them; the web
    pod holds the same values. A read reads at most FRAMES_READ frames, each
    at least FRAME_MIN_READ_PX each way, and lists at most ELEMENTS_PER_FRAME
    of a frame's elements and TEXT_PER_FRAME characters of its text. */
export const FRAMES_READ = 5;
export const ELEMENTS_PER_FRAME = 50;
export const TEXT_PER_FRAME = 1_000;
export const FRAME_MIN_READ_PX = 32;

/** Hosts whose frames hold a payment provider's card fields. A frame on one,
    or on a name under one, is never read and is blacked out of every
    screenshot. page.json's `limits` pins the list. */
export const PAYMENT_FRAME_HOSTS: readonly string[] = [
  'stripe.com', 'braintreegateway.com', 'braintree-api.com', 'adyen.com', 'checkout.com', 'squareup.com', 'squarecdn.com',
  'recurly.com', 'chargebee.com', 'spreedly.com', 'authorize.net', 'cybersource.com', 'worldpay.com', 'paddle.com',
  'paypal.com', 'shopifycs.com', 'shopifyinc.com', 'pay.google.com', 'mollie.com', 'razorpay.com', 'nmi.com', 'klarna.com',
];

/** Identity providers' sign-in hosts: a frame on one, or on a name under
    one, is never read. page.json's `limits` pins the list. */
export const SIGN_IN_FRAME_HOSTS: readonly string[] = [
  'accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com', 'login.live.com', 'facebook.com',
];

/** anton's STEP_ACTIONS (anton/core/browser/tool.py). */
export const STEP_ACTIONS = [
  'click', 'type', 'press', 'select', 'scroll', 'hover', 'drag',
  'back', 'forward', 'reload', 'wait', 'navigate',
] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

// ---- Answers -------------------------------------------------------------

export type ControlHolder = 'agent' | 'human';
export type ControlBy = 'agent' | 'person';

/** Who holds the browser. `seq` rises by one with every change; `by` says who
    made it. Only the person hands the browser back (holder agent, by person). */
export interface Control {
  holder: ControlHolder;
  reason: string;
  /** Epoch milliseconds of the last change. */
  since: number;
  seq: number;
  by: ControlBy;
}

/** POST /sessions: 201 for a new session, 200 with `resumed` for one that
    exists. `url` is null before a page loads. anton discards the answer. */
export interface OpenSessionAnswer {
  session_id: string;
  resumed: boolean;
  url: string | null;
}

/** GET /sessions/{id}. Answers even while the person holds control. `url` is
    null and `title` empty before a page loads. */
export interface SessionInfo {
  session_id: string;
  running: boolean;
  url: string | null;
  title: string;
  viewers: number;
  control: Control;
  created_at: string;
  last_active_at: string;
}

export interface PageElement {
  id: number;
  role: string;
  name: string;
  value?: string;
  /** A secret field (password, one-time code, card): its value is never sent. */
  value_hidden?: true;
  type?: 'password';
  checked?: boolean;
  disabled?: true;
  offscreen?: true;
  options?: string[];
}

/** A child frame's element. It has no id, so a step reaches it only by
    position, and it never carries a field's value: a select keeps its value
    and options. */
export interface PageFrameElement {
  role: string;
  name: string;
  value?: string;
  checked?: boolean;
  disabled?: true;
  offscreen?: true;
  options?: string[];
}

/** A frame's content box in the screenshot's pixels. */
export interface FrameBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rendered child frame. `url` is origin and path for http and https,
    about:blank or about:srcdoc, otherwise the scheme alone. `box` is null for
    a frame the host can't place. Only a read frame carries what it holds. */
export type PageFrame =
  | { url: string; read: false; box: FrameBox | null; offscreen?: true }
  | {
    url: string;
    read: true;
    box: FrameBox | null;
    offscreen?: true;
    elements: PageFrameElement[];
    text: string;
    truncated: boolean;
  };

/** A check frame the person can see. */
export interface Challenge {
  host: string;
  kind: string;
}

export interface PageScroll {
  y: number;
  height: number;
  viewport: number;
}

/** GET /sessions/{id}/page. */
export interface PageSnapshot {
  url: string;
  title: string;
  scroll: PageScroll;
  elements: PageElement[];
  text: string;
  /** More elements exist than `elements` lists. */
  truncated: boolean;
  challenges: Challenge[];
  /** The page's rendered child frames, on-screen first. */
  frames: PageFrame[];
}

/** What a step did to the page: whether it changed what the page shows,
    or null when the host can't tell (a frame, canvas or media element in
    view or under the step, a hover, a wait, or a page it couldn't watch). */
export interface StepOutcome {
  changed: boolean | null;
}

/** POST /sessions/{id}/action. */
export interface ActionAnswer extends StepOutcome {
  ok: true;
  url: string;
  page?: PageSnapshot;
}

export interface Tab {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

/** A site the person signed in to, as this browser records it. */
export interface Site {
  site: string;
  account_hint: string;
  noted_at: string;
  cookies_present: boolean;
  cookies_expire_at: string | null;
}

export interface SavedTab {
  name: string;
  url: string;
  notes: string;
  saved_at: string;
}

/** Every refusal's `error`. anton maps each code to its own reason. */
export type BridgeErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'too_large'
  | 'password_field'
  | 'person_only'
  | 'tab_not_found'
  | 'too_many_saved_tabs'
  | 'human_in_control'
  | 'not_a_text_field'
  | 'focus_unreadable'
  | 'stale_element'
  | 'page_blocked'
  | 'page_busy'
  | 'browser_unavailable'
  | 'at_capacity'
  | 'internal';

export const BRIDGE_ERROR_STATUS: Record<BridgeErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  password_field: 403,
  person_only: 403,
  not_found: 404,
  tab_not_found: 404,
  too_large: 413,
  too_many_saved_tabs: 409,
  human_in_control: 409,
  not_a_text_field: 409,
  focus_unreadable: 409,
  stale_element: 409,
  page_blocked: 409,
  page_busy: 409,
  internal: 500,
  browser_unavailable: 503,
  at_capacity: 503,
};

export interface BridgeErrorBody {
  error: BridgeErrorCode;
  message: string;
}

/** A refusal any layer of the host can raise; the bridge turns it into
    `{error, message}` with the code's status. */
export class BridgeError extends Error {
  readonly code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'BridgeError';
  }

  get status(): number {
    return BRIDGE_ERROR_STATUS[this.code];
  }

  body(): BridgeErrorBody {
    return { error: this.code, message: this.message };
  }
}

// ---- Requests ------------------------------------------------------------

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const refuse = <T>(message: string): Parsed<T> => ({ ok: false, message });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface PointTarget { x: number; y: number }
export interface ElementTarget { element: number }
export type StepTarget = PointTarget | ElementTarget;
export type MouseButton = 'left' | 'right' | 'middle';
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

/** A checked step. A type step names its field by number, or, with
    `focused`, types into whatever has the focus: a frame's field has no
    number, so the model clicks it by position first. A focused type types at
    the caret and clears nothing, and the host types it only into a text entry
    that isn't secret (typeIntoFocus in src/main/browser-input.ts). */
export type Step =
  | { action: 'click'; target: StepTarget; button: MouseButton; clicks: 1 | 2 | 3 }
  | { action: 'type'; focused?: false; element: number; text: string; clear: boolean; submit: boolean }
  | { action: 'type'; focused: true; text: string; submit: boolean }
  | { action: 'press'; key: string; element?: number }
  | { action: 'select'; element: number; values: string[] }
  | { action: 'scroll'; direction: ScrollDirection; amount: number; element?: number }
  | { action: 'hover'; target: StepTarget }
  | { action: 'drag'; from: StepTarget; to: StepTarget }
  | { action: 'back' }
  | { action: 'forward' }
  | { action: 'reload' }
  | { action: 'wait'; ms: number }
  | { action: 'navigate'; url: string };

/** POST /sessions/{id}/action, checked. Points are in page CSS pixels, or in
    the latest screenshot's pixels when `coords` is "screenshot".
    `intoFrame` is the body's into_frame. anton sends true after the person
    approves a one-step card for a step whose point may land in a frame,
    whatever held the step: a click by position anton raised for the frame,
    a click on a consent page, or a drag from a commit control. It sends
    false on every other body, a click after the person's approval of
    clicks by position on the page included. With true, a press or a drag's
    release is bound to the frame under its point when the step starts: it
    goes only into that frame, at the address it had then, and is refused
    once that frame moved away, another lies there, it navigated, or the
    debugger can't say which frame lies there, and so is one where a frame
    arrived under a point that had none (frameGuard in
    src/main/browser-input.ts). Anything else, a missing field included, is
    false, and a press or a drag's release whose point lands in a frame,
    when the step starts or just before it, is refused. A type with focused
    true presses at no point, so into_frame never stops it. */
export interface StepRequest {
  step: Step;
  coords: 'page' | 'screenshot';
  includePage: boolean;
  intoFrame: boolean;
}

const BUTTONS: readonly MouseButton[] = ['left', 'right', 'middle'];
const SCROLL_DIRECTIONS: readonly ScrollDirection[] = ['up', 'down', 'left', 'right'];
const DEFAULT_SCROLL_PX = 600;
const MAX_TEXT_CHARS = 10_000;
const MAX_KEY_CHARS = 64;

/* Element ids are JSON integers. A string such as "7" is refused rather than
   read as 7, so an id the agent's gate never classified can't slip through. */
function elementId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function point(end: Record<string, unknown>): Parsed<PointTarget> | null {
  if (end.x === undefined && end.y === undefined) return null;
  const { x, y } = end;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return refuse('x and y must both be numbers');
  }
  if (x < 0 || y < 0) return refuse('x and y must not be negative');
  return ok({ x, y });
}

/* A point wins over an element when a step names both, as on the web. */
function target(end: Record<string, unknown>, what: string): Parsed<StepTarget> {
  const at = point(end);
  if (at) return at;
  const element = elementId(end.element);
  if (element === null) return refuse(`${what} needs a positive integer "element" or "x" and "y"`);
  return ok({ element });
}

/** An http or https address, or null. The LAN is allowed: reaching it is a
    main reason to browse from the person's own machine. */
export function navigableUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.href;
}

function parseStep(body: Record<string, unknown>): Parsed<Step> {
  const action = body.action;
  if (typeof action !== 'string' || !(STEP_ACTIONS as readonly string[]).includes(action)) {
    return refuse(`unknown action ${typeof action === 'string' ? JSON.stringify(action) : `of type ${typeof action}`}; expected one of ${STEP_ACTIONS.join(', ')}`);
  }
  if (body.focused !== undefined && action !== 'type') return refuse('focused goes only on a type step');
  switch (action as StepAction) {
    case 'click': {
      const at = target(body, 'click');
      if (!at.ok) return at;
      const button = body.button ?? 'left';
      if (!BUTTONS.includes(button as MouseButton)) return refuse(`button must be one of ${BUTTONS.join(', ')}`);
      const clicks = body.clicks ?? 1;
      if (clicks !== 1 && clicks !== 2 && clicks !== 3) return refuse('clicks must be 1, 2 or 3');
      return ok({ action: 'click', target: at.value, button: button as MouseButton, clicks });
    }
    case 'type': {
      if (typeof body.text !== 'string') return refuse('type needs a string "text"');
      if (body.text.length > MAX_TEXT_CHARS) return refuse(`type text is longer than ${MAX_TEXT_CHARS} characters`);
      const submit = body.submit === true;
      if (body.focused === undefined) {
        const element = elementId(body.element);
        if (element === null) return refuse('type needs a positive integer "element", or "focused": true to type where the focus is');
        return ok({ action: 'type', element, text: body.text, clear: body.clear !== false, submit });
      }
      if (body.focused !== true) return refuse('focused, when a type step sends it, is true');
      if (body.element !== undefined || body.x !== undefined || body.y !== undefined) {
        return refuse('a type with focused true types where the focus is, so it names no element or point');
      }
      if (body.clear !== undefined && body.clear !== false) return refuse('a type with focused true types at the caret and clears nothing');
      return ok({ action: 'type', focused: true, text: body.text, submit });
    }
    case 'press': {
      if (typeof body.key !== 'string' || !body.key || body.key.length > MAX_KEY_CHARS) {
        return refuse('press needs a non-empty "key"');
      }
      if (body.element === undefined) return ok({ action: 'press', key: body.key });
      const element = elementId(body.element);
      if (element === null) return refuse('press needs a positive integer "element" when it names one');
      return ok({ action: 'press', key: body.key, element });
    }
    case 'select': {
      const element = elementId(body.element);
      if (element === null) return refuse('select needs a positive integer "element"');
      const values = Array.isArray(body.value) ? body.value : [body.value];
      if (!values.length || values.some((v) => typeof v !== 'string')) {
        return refuse('select needs "value" as a string or an array of strings');
      }
      return ok({ action: 'select', element, values: values as string[] });
    }
    case 'scroll': {
      const direction = body.direction ?? 'down';
      if (!SCROLL_DIRECTIONS.includes(direction as ScrollDirection)) {
        return refuse(`scroll direction must be one of ${SCROLL_DIRECTIONS.join(', ')}`);
      }
      const amount = body.amount ?? DEFAULT_SCROLL_PX;
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        return refuse('scroll amount must be a positive number of pixels');
      }
      const step = { action: 'scroll' as const, direction: direction as ScrollDirection, amount: Math.min(amount, 20_000) };
      if (body.element === undefined) return ok(step);
      const element = elementId(body.element);
      if (element === null) return refuse('scroll needs a positive integer "element" when it names one');
      return ok({ ...step, element });
    }
    case 'hover': {
      const at = target(body, 'hover');
      return at.ok ? ok({ action: 'hover', target: at.value }) : at;
    }
    case 'drag': {
      if (!isRecord(body.from) || !isRecord(body.to)) {
        return refuse('drag needs "from" and "to" as {"element": n} or {"x": …, "y": …}');
      }
      const from = target(body.from, 'drag from');
      if (!from.ok) return from;
      const to = target(body.to, 'drag to');
      if (!to.ok) return to;
      return ok({ action: 'drag', from: from.value, to: to.value });
    }
    case 'wait': {
      const ms = body.ms ?? 1000;
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return refuse('wait needs a non-negative "ms"');
      return ok({ action: 'wait', ms: Math.min(ms, MAX_WAIT_MS) });
    }
    case 'navigate': {
      const url = navigableUrl(body.url);
      if (!url) return refuse('navigate needs an http or https "url"');
      return ok({ action: 'navigate', url });
    }
    case 'back':
    case 'forward':
    case 'reload':
      return ok({ action } as Step);
  }
}

export function parseStepRequest(body: unknown): Parsed<StepRequest> {
  if (!isRecord(body)) return refuse('body must be a JSON object');
  const coords = body.coords ?? 'page';
  if (coords !== 'page' && coords !== 'screenshot') return refuse('coords must be "page" or "screenshot"');
  const step = parseStep(body);
  if (!step.ok) return step;
  return ok({ step: step.value, coords, includePage: body.include_page === true, intoFrame: body.into_frame === true });
}

/** POST /sessions. */
export interface OpenSessionRequest {
  sessionId: string;
  url: string | null;
}

export function parseOpenSession(body: unknown): Parsed<OpenSessionRequest> {
  if (!isRecord(body)) return refuse('body must be a JSON object');
  if (typeof body.session_id !== 'string' || !SESSION_ID_PATTERN.test(body.session_id)) {
    return refuse('session_id must match [A-Za-z0-9_-]{1,64}');
  }
  if (body.url === undefined || body.url === null || body.url === '') return ok({ sessionId: body.session_id, url: null });
  const url = navigableUrl(body.url);
  if (!url) return refuse('url must be an http or https address');
  return ok({ sessionId: body.session_id, url });
}

/** POST /sessions/{id}/control. The API only hands the browser to the person;
    `person_only` marks the take-back the API refuses. */
export type ControlRequest = { holder: 'human'; reason: string };

export function parseControlRequest(body: unknown): Parsed<ControlRequest> & { personOnly?: true } {
  if (!isRecord(body)) return refuse('body must be a JSON object');
  if (body.holder === 'agent') return { ok: false, message: 'only the person hands the browser back', personOnly: true };
  if (body.holder !== 'human') return refuse('holder must be "human"');
  const reason = body.reason ?? '';
  if (typeof reason !== 'string' || reason.length > MAX_CONTROL_REASON) {
    return refuse(`reason must be a string of at most ${MAX_CONTROL_REASON} characters`);
  }
  return ok({ holder: 'human', reason });
}

/** POST /sessions/{id}/tabs. */
export function parseNewTab(body: unknown): Parsed<{ url: string | null }> {
  if (body === undefined || body === null) return ok({ url: null });
  if (!isRecord(body)) return refuse('body must be a JSON object');
  if (body.url === undefined || body.url === null || body.url === '') return ok({ url: null });
  const url = navigableUrl(body.url);
  return url ? ok({ url }) : refuse('url must be an http or https address');
}

const SITE_PATTERN = /^[a-z0-9.-]{1,253}$/;

/** POST /sessions/{id}/sites. */
export function parseNoteSite(body: unknown): Parsed<{ site: string; accountHint: string }> {
  if (!isRecord(body)) return refuse('body must be a JSON object');
  const site = typeof body.site === 'string' ? body.site.trim().toLowerCase() : '';
  if (!SITE_PATTERN.test(site) || !site.includes('.')) return refuse('site must be a host name such as example.com');
  const hint = body.account_hint ?? '';
  if (typeof hint !== 'string' || hint.length > 200) return refuse('account_hint must be a string of at most 200 characters');
  return ok({ site, accountHint: hint.trim() });
}

/** POST /saved-tabs. */
export interface SaveTabRequest {
  project: string;
  name: string;
  url: string;
  notes: string;
}

export function parseSaveTab(body: unknown): Parsed<SaveTabRequest> {
  if (!isRecord(body)) return refuse('body must be a JSON object');
  if (typeof body.project !== 'string' || !PROJECT_PATTERN.test(body.project)) {
    return refuse('project must match [A-Za-z0-9_-]{1,64}');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 200) return refuse('name must be 1 to 200 characters');
  const url = navigableUrl(body.url);
  if (!url) return refuse('url must be an http or https address');
  const notes = body.notes ?? '';
  if (typeof notes !== 'string' || notes.length > 2000) return refuse('notes must be a string of at most 2000 characters');
  return ok({ project: body.project, name, url, notes });
}

// ---- IPC between main and the pane ----------------------------------------

/** The pane's stage, in the renderer's CSS pixels. */
export interface StageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_STAGE_PX = 16_384;

export function parseStageBounds(value: unknown): StageBounds | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  const numbers = [x, y, width, height];
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= MAX_STAGE_PX)) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

/** `waiting`: a download that started while the agent held the browser, paused
    until the person saves it or not in the pane. */
export type BrowserDownloadState = 'waiting' | 'progressing' | 'completed' | 'cancelled' | 'interrupted';

export interface BrowserDownload {
  id: string;
  name: string;
  /** The account's folder inside the OS Downloads folder, where it lands. */
  folder: string;
  state: BrowserDownloadState;
}

/** What the pane shows for one task's browser. Main sends it on every change,
    and once with `open` false when the task's browser closes. */
export interface BrowserViewState {
  sessionId: string;
  open: boolean;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  tabs: Tab[];
  control: Control;
  /** A site asked for a username and password (HTTP authentication). */
  login: { host: string } | null;
  downloads: BrowserDownload[];
}

export interface BrowserLoginAnswer {
  username: string;
  password: string;
}

export function parseLoginAnswer(value: unknown): BrowserLoginAnswer | null {
  if (!isRecord(value)) return null;
  const { username, password } = value;
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  if (username.length > 1024 || password.length > 1024) return null;
  return { username, password };
}

/** Main's answer to bounds the pane sends. */
export interface PaneDrawAnswer {
  /** Whether main draws the shown task's view at those bounds. False for the
      empty rectangle, for bounds under the floor (MIN_VIEW_PX in
      src/main/browser-sessions.ts, after the UI zoom), and when no task is
      shown. */
  drawn: boolean;
}

/** Main's answer to the pane's show. */
export interface PaneShowAnswer extends PaneDrawAnswer {
  /** Whether the task's browser is open. A task with none is not shown, so
      `drawn` is false too. */
  exists: boolean;
}

/** The in-app browser's preload surface (antontron.browser). */
export interface InAppBrowserBridge {
  /** This UI shows the in-app browser; main registers it with the local server only after this. */
  ready(): Promise<void>;
  /** The pane shows a task's browser on its stage. A pane that opens while an
      overlay is open or the sign-in form shows sends the empty rectangle
      {x: 0, y: 0, width: 0, height: 0}; any other stage goes as measured.
      Main keeps the task shown but draws nothing for the empty rectangle, and
      it does the same for any bounds under its floor (MIN_VIEW_PX in
      src/main/browser-sessions.ts, 200 DIP in either direction), so a stage
      with no area, measured, parks the view too. Main answers whether it
      draws, since only main knows the UI zoom the floor applies after. A
      shown task, covered or not, is never closed for being idle or to make
      room under the live-task cap. */
  show(sessionId: string, bounds: StageBounds): Promise<PaneShowAnswer>;
  /** The pane stops showing the task: the pane closed, the task changed, or
      the task closed. Covering the pane is not a hide; it is an empty
      rectangle through setBounds. */
  hide(): Promise<void>;
  /** The stage's new bounds. While an overlay is open or the sign-in form
      shows, the pane sends the empty rectangle; otherwise it sends the stage
      as measured. For the empty rectangle, or any bounds under the floor,
      main parks the view at the last bounds big enough to draw in, with the
      task still shown. Bounds big enough show it there again. Main answers
      whether it draws. */
  setBounds(bounds: StageBounds): Promise<PaneDrawAnswer>;
  /** The person opens an address in a task's browser, typed in the pane: a
      new session at it, or the session's active tab goes there. No agent is
      involved. A null address opens the task's browser on a blank tab, and
      leaves one already open as it is. */
  open(sessionId: string, url: string | null): Promise<void>;
  back(sessionId: string): Promise<void>;
  forward(sessionId: string): Promise<void>;
  reload(sessionId: string): Promise<void>;
  activateTab(sessionId: string, tabId: string): Promise<void>;
  takeOver(sessionId: string): Promise<void>;
  handBack(sessionId: string): Promise<void>;
  /** null cancels the sign-in prompt. */
  answerLogin(sessionId: string, answer: BrowserLoginAnswer | null): Promise<void>;
  /** The person's answer to a download that waits for it: save it, or not. */
  answerDownload(sessionId: string, downloadId: string, save: boolean): Promise<void>;
  /** Sign out of all sites: clears the browser's cookies, storage and cache, and closes every task's tabs. */
  clearData(): Promise<{ ok: boolean }>;
  onState(cb: (state: BrowserViewState) => void): () => void;
}
