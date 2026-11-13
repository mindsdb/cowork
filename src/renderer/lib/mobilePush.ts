// Push notifications inside the mobile app (ENG-4023).
//
// The native shell bundles @capacitor/push-notifications; this page reaches it
// through the Capacitor bridge as `window.Capacitor.Plugins.PushNotifications`
// (the npm package is not part of the web build, the same way mobileAuth.ts
// reaches MindsHubAuth). Outside the app every export here is a no-op.
//
// What it does:
//   - After sign-in: if notifications are already allowed, register with
//     APNs/FCM and send the device token to the server
//     (POST /api/v1/push/devices). If the OS has not asked yet, it does NOT ask
//     at launch. The first time the user starts a task, a small in-app card
//     offers "Get notified when your tasks finish"; "Turn on" fires the OS
//     prompt, "Not now" snoozes the offer for 14 days.
//   - A tap on a notification opens its `path` in the app's router, or its
//     `url` (a shared artifact's page) in the system browser. A tap that
//     arrives before the router exists (cold start, or before sign-in, which
//     reloads the page) is kept in sessionStorage and applied once it does.
//   - On sign-out, before the tokens are cleared: DELETE the device token, so
//     this phone stops getting the previous user's notifications. The OS
//     registration is kept (see unregisterOnSignOut).
//
// Payload contract with the server: APNs custom keys / FCM `data` carry
// `kind` (task_finished | scheduled_run_finished | artifact_shared), optional
// `path` (an in-app route such as /c/<conversationId>) and optional `url`.

import { registerPushDevice, unregisterPushDevice } from '../cowork/api';
import { host } from '../platform/host';
import { isMobileShell, mobileShell, type MobileShellPlatform } from './mobileShell';

// ---------------------------------------------------------------------------
// The native plugin (only the parts used here)
// ---------------------------------------------------------------------------

export type PushPermission = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';

interface ListenerHandle { remove(): Promise<void> | void }

export interface PushNotificationsPlugin {
  checkPermissions(): Promise<{ receive: PushPermission }>;
  requestPermissions(): Promise<{ receive: PushPermission }>;
  register(): Promise<void>;
  addListener(event: 'registration', fn: (token: { value: string }) => void): unknown;
  addListener(event: 'registrationError', fn: (error: { error: string }) => void): unknown;
  addListener(event: 'pushNotificationActionPerformed', fn: (action: PushActionEvent) => void): unknown;
}

export interface PushActionEvent {
  actionId?: string;
  notification?: { data?: unknown };
}

/** Android only: whether the build carries a Firebase config (MindsHubPushPlugin.java). */
export interface MindsHubPushPlugin {
  isSupported(): Promise<{ supported: boolean }>;
}

type CapacitorWindow = { Capacitor?: { Plugins?: Record<string, unknown> } } | undefined;

function capacitorPlugins(win: unknown): Record<string, unknown> | undefined {
  return (win as CapacitorWindow)?.Capacitor?.Plugins;
}

/** The PushNotifications plugin, or null (a browser, or a shell built without it). */
export function getPushPlugin(win: unknown = typeof window !== 'undefined' ? window : undefined): PushNotificationsPlugin | null {
  const plugin = capacitorPlugins(win)?.PushNotifications as Partial<PushNotificationsPlugin> | undefined;
  return plugin && typeof plugin.register === 'function' && typeof plugin.addListener === 'function'
    ? plugin as PushNotificationsPlugin
    : null;
}

export function getMindsHubPushPlugin(win: unknown = typeof window !== 'undefined' ? window : undefined): MindsHubPushPlugin | null {
  const plugin = capacitorPlugins(win)?.MindsHubPush as Partial<MindsHubPushPlugin> | undefined;
  return plugin && typeof plugin.isSupported === 'function' ? plugin as MindsHubPushPlugin : null;
}

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

export type PushTapAction =
  | { type: 'navigate'; path: string }
  | { type: 'open-url'; url: string }
  | { type: 'none' };

const MAX_PATH_LENGTH = 2048;

/**
 * An in-app route the router may navigate to: absolute, same-origin (no
 * `//host`, no scheme, no backslash tricks), no control characters.
 */
export function safeInAppPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.length > MAX_PATH_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return null;
  return path;
}

/** An https URL to open in the system browser. */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * What a tap on a notification does: its `path` in the app, else its `url`
 * in the system browser, else just open the app. iOS puts the APNs custom
 * keys at the top of `data` (beside `aps`); Android puts the FCM `data` map
 * there. Anything malformed falls back to opening the app.
 */
export function actionForNotification(data: unknown): PushTapAction {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const path = safeInAppPath(record.path);
  if (path) return { type: 'navigate', path };
  const url = safeExternalUrl(record.url);
  if (url) return { type: 'open-url', url };
  return { type: 'none' };
}

/**
 * After sign-in, what to do with the OS permission:
 *   granted -> register now;
 *   not asked yet -> wait (the soft prompt offers it later);
 *   denied / unknown -> nothing (the OS won't ask again; Settings is the way back).
 */
export function decideOnSignIn(permission: PushPermission | null): 'register' | 'wait' | 'none' {
  if (permission === 'granted') return 'register';
  if (permission === 'prompt' || permission === 'prompt-with-rationale') return 'wait';
  return 'none';
}

export const SOFT_PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
export const SOFT_PROMPT_SNOOZE_KEY = 'cowork.mobilePush.softPromptSnoozedAt';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** True while a "Not now" from the last 14 days stands. Unreadable storage: not snoozed. */
export function isSoftPromptSnoozed(storage: KeyValueStorage | null | undefined, now: number): boolean {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SOFT_PROMPT_SNOOZE_KEY) ?? null;
  } catch {
    return false;
  }
  const at = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(at)) return false;
  // A timestamp from the future (clock moved back) counts from now.
  return now - Math.min(at, now) < SOFT_PROMPT_SNOOZE_MS;
}

export function snoozeSoftPrompt(storage: KeyValueStorage | null | undefined, now: number): void {
  try {
    storage?.setItem(SOFT_PROMPT_SNOOZE_KEY, String(now));
  } catch {
    // Private mode / blocked storage: the offer may come back next session.
  }
}

/**
 * Whether to show the soft prompt now: push works on this build, the OS has
 * not asked yet, it was not shown this session, and no "Not now" stands.
 */
export function shouldOfferSoftPrompt(state: {
  supported: boolean;
  permission: PushPermission | null;
  offeredThisSession: boolean;
  snoozed: boolean;
}): boolean {
  return state.supported
    && decideOnSignIn(state.permission) === 'wait'
    && !state.offeredThisSession
    && !state.snoozed;
}

/** Server answers that mean "this deployment has no push": stop quietly. */
export function isPushUnavailableStatus(status: unknown): boolean {
  return status === 404 || status === 405 || status === 501;
}

export const PENDING_TAP_KEY = 'cowork.mobilePush.pendingTap';
/** A queued tap older than this is stale (the user moved on); drop it. */
export const PENDING_TAP_MAX_AGE_MS = 10 * 60 * 1000;

export function readPendingTap(storage: KeyValueStorage | null | undefined, now: number): string | null {
  try {
    const raw = storage?.getItem(PENDING_TAP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: unknown; at?: unknown };
    const path = safeInAppPath(parsed?.path);
    const at = typeof parsed?.at === 'number' ? parsed.at : NaN;
    if (!path || !Number.isFinite(at) || now - at > PENDING_TAP_MAX_AGE_MS || at > now) return null;
    return path;
  } catch {
    return null;
  }
}

export function writePendingTap(storage: KeyValueStorage | null | undefined, path: string | null, now: number): void {
  try {
    if (path) storage?.setItem(PENDING_TAP_KEY, JSON.stringify({ path, at: now }));
    else storage?.removeItem(PENDING_TAP_KEY);
  } catch {
    // Without storage the in-memory copy still covers a tap before the router mounts.
  }
}

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

export interface PushApi {
  register(body: { token: string; platform: MobileShellPlatform; appVersion: string | null; environment: null }): Promise<unknown>;
  unregister(token: string): Promise<unknown>;
}

export interface MobilePushDeps {
  platform: MobileShellPlatform;
  appVersion: string | null;
  getPlugin: () => PushNotificationsPlugin | null;
  getSupportPlugin?: () => MindsHubPushPlugin | null;
  api: PushApi;
  /** localStorage: the soft prompt's snooze. */
  storage?: KeyValueStorage | null;
  /** sessionStorage: a tap waiting for the router, across the sign-in reload. */
  sessionStorage?: KeyValueStorage | null;
  openExternal: (url: string) => void;
  now?: () => number;
  log?: (message: string, detail?: unknown) => void;
}

export interface SoftPromptState { visible: boolean }

export interface MobilePushController {
  /** Listen for registration and taps. Call as early as possible (cold-start taps). */
  start(): void;
  /** The user is signed in: register if allowed, or get ready to offer. */
  signedIn(userId: string | null | undefined): Promise<void>;
  /** The user started a task: the moment to offer push, once. */
  noteTaskStarted(): void;
  acceptSoftPrompt(): Promise<void>;
  dismissSoftPrompt(): void;
  getSoftPrompt(): SoftPromptState;
  subscribe(listener: () => void): () => void;
  /** The router is ready: apply a queued tap. Returns a cleanup. */
  setNavigator(navigate: ((path: string) => void) | null): () => void;
  /** Before the tokens are cleared on sign-out. Never rejects. */
  unregisterOnSignOut(): Promise<void>;
}

export function createMobilePush(deps: MobilePushDeps): MobilePushController {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((message: string, detail?: unknown) => console.info(`[push] ${message}`, detail ?? ''));

  let started = false;
  let userId: string | null = null;
  let permission: PushPermission | null = null;
  let supported = false;
  /** The server has no push endpoint; stop calling it. */
  let unavailable = false;
  let token: string | null = null;
  /** `${userId}\n${token}` already sent (or in flight) this session. */
  let sentKey: string | null = null;
  const registrations = new Set<Promise<unknown>>();
  const registeredTokens = new Set<string>();
  let signingOut: Promise<void> | null = null;
  let taskStarted = false;
  let offeredThisSession = false;
  let softPrompt: SoftPromptState = { visible: false };
  let navigator: ((path: string) => void) | null = null;
  let pendingPath: string | null = null;
  const listeners = new Set<() => void>();

  const setSoftPrompt = (visible: boolean) => {
    if (softPrompt.visible === visible) return;
    softPrompt = { visible };
    for (const listener of listeners) listener();
  };

  const sendToken = async () => {
    if (!userId || !token || unavailable) return;
    const key = `${userId}\n${token}`;
    if (sentKey === key) return;
    sentKey = key;
    const currentToken = token;
    registeredTokens.add(currentToken);
    // Track the request before yielding so logout can drain every POST,
    // including requests for a token that rotated during this session.
    const registration = Promise.resolve().then(() => deps.api.register({
      token: currentToken, platform: deps.platform, appVersion: deps.appVersion, environment: null,
    }));
    registrations.add(registration);
    try {
      await registration;
    } catch (error) {
      if (sentKey === key) sentKey = null;
      if (isPushUnavailableStatus((error as { status?: unknown })?.status)) {
        unavailable = true;
        setSoftPrompt(false);
        return;
      }
      log('could not register this device', error);
    } finally {
      registrations.delete(registration);
    }
  };

  const register = async () => {
    const plugin = deps.getPlugin();
    if (!plugin) return;
    try {
      await plugin.register();
    } catch (error) {
      log('register failed', error);
    }
  };

  const applyTap = (action: PushTapAction) => {
    if (action.type === 'open-url') {
      deps.openExternal(action.url);
      return;
    }
    if (action.type !== 'navigate') return;
    if (navigator) {
      navigator(action.path);
      return;
    }
    pendingPath = action.path;
    writePendingTap(deps.sessionStorage, action.path, now());
  };

  const checkSupport = async (): Promise<boolean> => {
    if (!deps.getPlugin()) return false;
    // Android: PushNotifications.register() crashes a build without Firebase,
    // so ask the shell first. A shell without the check can't be trusted.
    if (deps.platform !== 'android') return true;
    const support = deps.getSupportPlugin?.() ?? null;
    if (!support) return false;
    try {
      return (await support.isSupported())?.supported === true;
    } catch {
      return false;
    }
  };

  function noteTaskStarted() {
    taskStarted = true;
    if (!userId || unavailable) return;
    if (!shouldOfferSoftPrompt({
      supported,
      permission,
      offeredThisSession,
      snoozed: isSoftPromptSnoozed(deps.storage, now()),
    })) return;
    offeredThisSession = true;
    setSoftPrompt(true);
  }

  return {
    start() {
      if (started) return;
      const plugin = deps.getPlugin();
      if (!plugin) return;
      started = true;
      pendingPath = readPendingTap(deps.sessionStorage, now());
      if (!pendingPath) writePendingTap(deps.sessionStorage, null, now());
      try {
        plugin.addListener('registration', (event) => {
          const value = typeof event?.value === 'string' ? event.value.trim() : '';
          if (!value) return;
          token = value;
          void sendToken();
        });
        plugin.addListener('registrationError', (event) => {
          log('registration error', event?.error);
        });
        plugin.addListener('pushNotificationActionPerformed', (event) => {
          // Only a tap on the notification itself; a dismiss is not a request to open anything.
          if (event?.actionId && event.actionId !== 'tap') return;
          applyTap(actionForNotification(event?.notification?.data));
        });
      } catch (error) {
        log('could not listen for push events', error);
      }
    },

    async signedIn(id) {
      // A new account must not register a token that the old account's
      // cleanup is still removing. Normally sign-in follows a page reload.
      if (signingOut) await signingOut;
      const nextUser = typeof id === 'string' && id ? id : null;
      if (!nextUser || nextUser === userId) return;
      userId = nextUser;
      const plugin = deps.getPlugin();
      if (!plugin) return;
      supported = await checkSupport();
      if (!supported) return;
      try {
        permission = (await plugin.checkPermissions())?.receive ?? null;
      } catch (error) {
        log('checkPermissions failed', error);
        permission = null;
      }
      if (decideOnSignIn(permission) === 'register') {
        await register();
        return;
      }
      // Signed in after a task was already started this session.
      if (taskStarted) noteTaskStarted();
    },

    noteTaskStarted,

    async acceptSoftPrompt() {
      setSoftPrompt(false);
      const plugin = deps.getPlugin();
      if (!plugin) return;
      try {
        permission = (await plugin.requestPermissions())?.receive ?? null;
      } catch (error) {
        log('requestPermissions failed', error);
        return;
      }
      if (permission === 'granted') await register();
    },

    dismissSoftPrompt() {
      setSoftPrompt(false);
      snoozeSoftPrompt(deps.storage, now());
    },

    getSoftPrompt: () => softPrompt,

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    setNavigator(navigate) {
      navigator = navigate;
      if (navigate && pendingPath) {
        const path = pendingPath;
        pendingPath = null;
        writePendingTap(deps.sessionStorage, null, now());
        navigate(path);
      }
      return () => {
        if (navigator === navigate) navigator = null;
      };
    },

    unregisterOnSignOut() {
      if (signingOut) return signingOut;
      // Keep the OS registration (no PushNotifications.unregister()): on iOS
      // that turns remote notifications off for the app until the next
      // register, and on Android it deletes the FCM token. Removing the token
      // from this user on the server is what stops their notifications; the
      // next user to sign in on this phone registers the same token as theirs.
      const tokens = new Set(registeredTokens);
      if (token) tokens.add(token);
      registeredTokens.clear();
      sentKey = null;
      userId = null;
      setSoftPrompt(false);
      signingOut = (async () => {
        // Deleting first lets a late POST recreate the signed-out user's row.
        // Clearing userId above prevents registration events from adding work.
        // The auth adapter still bounds this entire hook to three seconds;
        // an unavailable server cannot provide a guaranteed remote revocation.
        await Promise.allSettled([...registrations]);
        if (unavailable) return;
        await Promise.all([...tokens].map(async (current) => {
          try {
            await deps.api.unregister(current);
          } catch (error) {
            if (!isPushUnavailableStatus((error as { status?: unknown })?.status)) log('could not unregister this device', error);
          }
        }));
      })().finally(() => { signingOut = null; });
      return signingOut;
    },
  };
}

// ---------------------------------------------------------------------------
// The app's instance (only inside the shell)
// ---------------------------------------------------------------------------

function safeStorage(kind: 'localStorage' | 'sessionStorage'): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window[kind] : null;
  } catch {
    return null;
  }
}

let instance: MobilePushController | null | undefined;

/** The app's push controller; null outside the mobile app. */
export function mobilePush(): MobilePushController | null {
  if (instance !== undefined) return instance;
  instance = isMobileShell && mobileShell
    ? createMobilePush({
      platform: mobileShell.platform,
      appVersion: mobileShell.version,
      getPlugin: () => getPushPlugin(),
      getSupportPlugin: () => getMindsHubPushPlugin(),
      api: {
        register: (body) => registerPushDevice(body),
        unregister: (token) => unregisterPushDevice(token),
      },
      storage: safeStorage('localStorage'),
      sessionStorage: safeStorage('sessionStorage'),
      // host.openExternal is window.open(url, '_blank') on the web. Inside the
      // shell a host outside server.allowNavigation opens in the system
      // browser (Capacitor: iOS createWebViewWith -> UIApplication.open,
      // Android launchIntent -> ACTION_VIEW).
      openExternal: (url) => { void host.openExternal(url); },
    })
    : null;
  return instance;
}

export function startMobilePush(): void {
  mobilePush()?.start();
}

export function mobilePushSignedIn(userId: string | null | undefined): void {
  void mobilePush()?.signedIn(userId);
}

export function noteMobilePushTaskStarted(): void {
  mobilePush()?.noteTaskStarted();
}

export function setMobilePushNavigator(navigate: ((path: string) => void) | null): () => void {
  return mobilePush()?.setNavigator(navigate) ?? (() => {});
}

export async function unregisterMobilePushOnSignOut(): Promise<void> {
  await mobilePush()?.unregisterOnSignOut();
}
