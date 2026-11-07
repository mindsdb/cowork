import { describe, expect, it, vi } from 'vitest';
import {
  PENDING_TAP_KEY,
  PENDING_TAP_MAX_AGE_MS,
  SOFT_PROMPT_SNOOZE_KEY,
  SOFT_PROMPT_SNOOZE_MS,
  actionForNotification,
  createMobilePush,
  decideOnSignIn,
  getMindsHubPushPlugin,
  getPushPlugin,
  isPushUnavailableStatus,
  isSoftPromptSnoozed,
  mobilePush,
  readPendingTap,
  safeExternalUrl,
  safeInAppPath,
  setMobilePushNavigator,
  shouldOfferSoftPrompt,
  snoozeSoftPrompt,
  unregisterMobilePushOnSignOut,
  writePendingTap,
  type MobilePushDeps,
  type PushActionEvent,
  type PushPermission,
} from './mobilePush';

const NOW = 1_800_000_000_000;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: vi.fn((key: string) => { data.delete(key); }),
  };
}

const throwingStorage = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
};

/** A stand-in for window.Capacitor.Plugins.PushNotifications. */
function fakePlugin(permission: PushPermission = 'granted') {
  const handlers: Record<string, (event: unknown) => void> = {};
  const plugin = {
    permission,
    checkPermissions: vi.fn(async () => ({ receive: plugin.permission })),
    requestPermissions: vi.fn(async () => ({ receive: plugin.permission })),
    register: vi.fn(async () => {}),
    addListener: vi.fn((event: string, fn: (e: unknown) => void) => {
      handlers[event] = fn;
      return { remove: vi.fn() };
    }),
    emit(event: string, payload: unknown) {
      handlers[event]?.(payload);
    },
  };
  return plugin;
}

function setup(overrides: Partial<MobilePushDeps> & { permission?: PushPermission } = {}) {
  const plugin = fakePlugin(overrides.permission);
  const api = {
    register: vi.fn(async () => ({ ok: true })),
    unregister: vi.fn(async () => ({ ok: true })),
  };
  const storage = memoryStorage();
  const session = memoryStorage();
  const openExternal = vi.fn();
  const log = vi.fn();
  const controller = createMobilePush({
    platform: 'ios',
    appVersion: '1.0.0',
    getPlugin: () => plugin as never,
    api,
    storage,
    sessionStorage: session,
    openExternal,
    now: () => NOW,
    log,
    ...overrides,
  });
  return { controller, plugin, api, storage, session, openExternal, log };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('plugin lookup', () => {
  it('finds the plugins on window.Capacitor.Plugins', () => {
    const push = { register() {}, addListener() {} };
    const support = { isSupported() {} };
    const win = { Capacitor: { Plugins: { PushNotifications: push, MindsHubPush: support } } };
    expect(getPushPlugin(win)).toBe(push);
    expect(getMindsHubPushPlugin(win)).toBe(support);
  });

  it('is null in a browser or in a shell built without push', () => {
    expect(getPushPlugin(undefined)).toBeNull();
    expect(getPushPlugin({})).toBeNull();
    expect(getPushPlugin({ Capacitor: { Plugins: { MindsHubAuth: {} } } })).toBeNull();
    expect(getMindsHubPushPlugin({ Capacitor: { Plugins: {} } })).toBeNull();
  });
});

describe('actionForNotification (tap routing)', () => {
  it('opens an in-app path', () => {
    expect(actionForNotification({ kind: 'task_finished', path: '/c/abc-123' }))
      .toEqual({ type: 'navigate', path: '/c/abc-123' });
    expect(actionForNotification({ kind: 'scheduled_run_finished', path: '/scheduled/s1' }))
      .toEqual({ type: 'navigate', path: '/scheduled/s1' });
  });

  it('reads iOS userInfo, where the custom keys sit beside aps', () => {
    expect(actionForNotification({ aps: { alert: { title: 'Done' } }, kind: 'task_finished', path: '/c/1' }))
      .toEqual({ type: 'navigate', path: '/c/1' });
  });

  it('prefers the path over the url', () => {
    expect(actionForNotification({ path: '/c/1', url: 'https://view.mindshub.ai/a/1' }))
      .toEqual({ type: 'navigate', path: '/c/1' });
  });

  it('opens a shared artifact url in the system browser', () => {
    expect(actionForNotification({ kind: 'artifact_shared', url: 'https://view.mindshub.ai/a/xyz' }))
      .toEqual({ type: 'open-url', url: 'https://view.mindshub.ai/a/xyz' });
  });

  it('falls back to just opening the app for anything unsafe or missing', () => {
    for (const data of [
      undefined,
      null,
      'nope',
      {},
      { kind: 'task_finished' },
      { path: 'c/1' },
      { path: '//evil.example/c/1' },
      { path: '/\\evil.example' },
      { path: '/c/1\nx' },
      { path: 42 },
      { url: 'http://view.mindshub.ai/a/1' },
      { url: 'javascript:alert(1)' },
      { url: 'not a url' },
    ]) {
      expect(actionForNotification(data)).toEqual({ type: 'none' });
    }
  });

  it('validates paths and urls on their own', () => {
    expect(safeInAppPath(' /c/1 ')).toBe('/c/1');
    expect(safeInAppPath(`/${'a'.repeat(5000)}`)).toBeNull();
    expect(safeExternalUrl('https://view.mindshub.ai/a/1')).toBe('https://view.mindshub.ai/a/1');
    expect(safeExternalUrl(null)).toBeNull();
  });
});

describe('permission state machine', () => {
  it('registers when granted, waits when not asked yet, does nothing when denied', () => {
    expect(decideOnSignIn('granted')).toBe('register');
    expect(decideOnSignIn('prompt')).toBe('wait');
    expect(decideOnSignIn('prompt-with-rationale')).toBe('wait');
    expect(decideOnSignIn('denied')).toBe('none');
    expect(decideOnSignIn(null)).toBe('none');
  });

  it('offers the soft prompt only when supported, not yet asked, not offered and not snoozed', () => {
    const base = { supported: true, permission: 'prompt' as PushPermission, offeredThisSession: false, snoozed: false };
    expect(shouldOfferSoftPrompt(base)).toBe(true);
    expect(shouldOfferSoftPrompt({ ...base, supported: false })).toBe(false);
    expect(shouldOfferSoftPrompt({ ...base, permission: 'granted' })).toBe(false);
    expect(shouldOfferSoftPrompt({ ...base, permission: 'denied' })).toBe(false);
    expect(shouldOfferSoftPrompt({ ...base, offeredThisSession: true })).toBe(false);
    expect(shouldOfferSoftPrompt({ ...base, snoozed: true })).toBe(false);
  });

  it('treats 404, 405 and 501 as a server without push', () => {
    expect([404, 405, 501].every(isPushUnavailableStatus)).toBe(true);
    expect([400, 401, 500, 503, undefined].some(isPushUnavailableStatus)).toBe(false);
  });
});

describe('soft prompt snooze', () => {
  it('snoozes for 14 days after "Not now"', () => {
    const storage = memoryStorage();
    snoozeSoftPrompt(storage, NOW);
    expect(storage.data.get(SOFT_PROMPT_SNOOZE_KEY)).toBe(String(NOW));
    expect(isSoftPromptSnoozed(storage, NOW + SOFT_PROMPT_SNOOZE_MS - 1)).toBe(true);
    expect(isSoftPromptSnoozed(storage, NOW + SOFT_PROMPT_SNOOZE_MS)).toBe(false);
  });

  it('is not snoozed with nothing stored, junk stored, or storage blocked', () => {
    expect(isSoftPromptSnoozed(memoryStorage(), NOW)).toBe(false);
    expect(isSoftPromptSnoozed(memoryStorage({ [SOFT_PROMPT_SNOOZE_KEY]: 'junk' }), NOW)).toBe(false);
    expect(isSoftPromptSnoozed(throwingStorage, NOW)).toBe(false);
    expect(isSoftPromptSnoozed(null, NOW)).toBe(false);
    expect(() => snoozeSoftPrompt(throwingStorage, NOW)).not.toThrow();
  });

  it('counts a snooze stamped in the future (clock moved back) from now', () => {
    expect(isSoftPromptSnoozed(memoryStorage({ [SOFT_PROMPT_SNOOZE_KEY]: String(NOW + 1e9) }), NOW)).toBe(true);
  });
});

describe('pending tap storage', () => {
  it('round-trips a path and clears it', () => {
    const session = memoryStorage();
    writePendingTap(session, '/c/1', NOW);
    expect(readPendingTap(session, NOW + 1000)).toBe('/c/1');
    writePendingTap(session, null, NOW);
    expect(session.data.has(PENDING_TAP_KEY)).toBe(false);
  });

  it('drops a stale, future-dated, unsafe or malformed entry', () => {
    const session = memoryStorage();
    writePendingTap(session, '/c/1', NOW);
    expect(readPendingTap(session, NOW + PENDING_TAP_MAX_AGE_MS + 1)).toBeNull();
    expect(readPendingTap(session, NOW - 1)).toBeNull();
    expect(readPendingTap(memoryStorage({ [PENDING_TAP_KEY]: JSON.stringify({ path: '//x', at: NOW }) }), NOW)).toBeNull();
    expect(readPendingTap(memoryStorage({ [PENDING_TAP_KEY]: '{' }), NOW)).toBeNull();
    expect(readPendingTap(throwingStorage, NOW)).toBeNull();
    expect(() => writePendingTap(throwingStorage, '/c/1', NOW)).not.toThrow();
  });
});

describe('createMobilePush', () => {
  it('registers at sign-in when notifications are already allowed, and sends the token once', async () => {
    const { controller, plugin, api } = setup({ permission: 'granted' });
    controller.start();
    await controller.signedIn('user-1');
    expect(plugin.register).toHaveBeenCalledTimes(1);

    plugin.emit('registration', { value: 'apns-token' });
    plugin.emit('registration', { value: 'apns-token' });
    await flush();

    expect(api.register).toHaveBeenCalledTimes(1);
    expect(api.register).toHaveBeenCalledWith({ token: 'apns-token', platform: 'ios', appVersion: '1.0.0', environment: null });
  });

  it('sends again for a new token (FCM rotation) but not for a repeat', async () => {
    const { controller, plugin, api } = setup();
    controller.start();
    await controller.signedIn('user-1');
    plugin.emit('registration', { value: 't1' });
    await flush();
    plugin.emit('registration', { value: 't2' });
    await flush();
    plugin.emit('registration', { value: 't2' });
    await flush();
    expect(api.register.mock.calls.map((call) => (call as unknown as [{ token: string }])[0].token)).toEqual(['t1', 't2']);
  });

  it('retries a token whose send failed, on the next registration event', async () => {
    const { controller, plugin, api, log } = setup();
    api.register.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    controller.start();
    await controller.signedIn('user-1');
    plugin.emit('registration', { value: 't1' });
    await flush();
    expect(log).toHaveBeenCalled();
    plugin.emit('registration', { value: 't1' });
    await flush();
    expect(api.register).toHaveBeenCalledTimes(2);
  });

  it('stops quietly on a server without push (404/501)', async () => {
    const { controller, plugin, api, log } = setup();
    api.register.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }));
    controller.start();
    await controller.signedIn('user-1');
    plugin.emit('registration', { value: 't1' });
    await flush();
    plugin.emit('registration', { value: 't2' });
    await flush();
    expect(api.register).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();

    await controller.unregisterOnSignOut();
    expect(api.unregister).not.toHaveBeenCalled();
  });

  it('logs a registration error quietly', () => {
    const { controller, plugin, log } = setup();
    controller.start();
    plugin.emit('registrationError', { error: 'no aps-environment' });
    expect(log).toHaveBeenCalledWith('registration error', 'no aps-environment');
  });

  it('never fires the OS prompt at sign-in; offers the soft prompt once the first task starts', async () => {
    const { controller, plugin } = setup({ permission: 'prompt' });
    controller.start();
    await controller.signedIn('user-1');
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(plugin.register).not.toHaveBeenCalled();
    expect(controller.getSoftPrompt().visible).toBe(false);

    const listener = vi.fn();
    controller.subscribe(listener);
    controller.noteTaskStarted();
    expect(controller.getSoftPrompt().visible).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('offers once per session', async () => {
    const { controller } = setup({ permission: 'prompt' });
    await controller.signedIn('user-1');
    controller.noteTaskStarted();
    controller.dismissSoftPrompt();
    controller.noteTaskStarted();
    expect(controller.getSoftPrompt().visible).toBe(false);
  });

  it('offers after sign-in when the task started first', async () => {
    const { controller } = setup({ permission: 'prompt' });
    controller.noteTaskStarted();
    expect(controller.getSoftPrompt().visible).toBe(false);
    await controller.signedIn('user-1');
    expect(controller.getSoftPrompt().visible).toBe(true);
  });

  it('"Turn on" asks the OS and registers when allowed', async () => {
    const { controller, plugin } = setup({ permission: 'prompt' });
    await controller.signedIn('user-1');
    controller.noteTaskStarted();
    plugin.permission = 'granted';
    await controller.acceptSoftPrompt();
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(plugin.register).toHaveBeenCalledTimes(1);
    expect(controller.getSoftPrompt().visible).toBe(false);
  });

  it('"Turn on" then an OS "Don\'t Allow" registers nothing', async () => {
    const { controller, plugin } = setup({ permission: 'prompt' });
    await controller.signedIn('user-1');
    controller.noteTaskStarted();
    plugin.permission = 'denied';
    await controller.acceptSoftPrompt();
    expect(plugin.register).not.toHaveBeenCalled();
  });

  it('"Not now" snoozes, and a snoozed offer stays hidden next session', async () => {
    const first = setup({ permission: 'prompt' });
    await first.controller.signedIn('user-1');
    first.controller.noteTaskStarted();
    first.controller.dismissSoftPrompt();
    expect(first.storage.data.get(SOFT_PROMPT_SNOOZE_KEY)).toBe(String(NOW));

    const next = setup({ permission: 'prompt', storage: first.storage });
    await next.controller.signedIn('user-1');
    next.controller.noteTaskStarted();
    expect(next.controller.getSoftPrompt().visible).toBe(false);
  });

  it('never offers when the OS already said no', async () => {
    const { controller, plugin } = setup({ permission: 'denied' });
    await controller.signedIn('user-1');
    controller.noteTaskStarted();
    expect(controller.getSoftPrompt().visible).toBe(false);
    expect(plugin.register).not.toHaveBeenCalled();
  });

  it('on Android, does nothing unless the shell reports Firebase is configured', async () => {
    const unsupported = setup({
      platform: 'android',
      permission: 'granted',
      getSupportPlugin: () => ({ isSupported: async () => ({ supported: false }) }),
    });
    await unsupported.controller.signedIn('user-1');
    expect(unsupported.plugin.register).not.toHaveBeenCalled();

    const noCheck = setup({ platform: 'android', permission: 'granted' });
    await noCheck.controller.signedIn('user-1');
    expect(noCheck.plugin.register).not.toHaveBeenCalled();

    const supported = setup({
      platform: 'android',
      permission: 'granted',
      getSupportPlugin: () => ({ isSupported: async () => ({ supported: true }) }),
    });
    await supported.controller.signedIn('user-1');
    expect(supported.plugin.register).toHaveBeenCalledTimes(1);
  });

  it('is inert without the native plugin', async () => {
    const { controller, api } = setup({ getPlugin: () => null });
    controller.start();
    await controller.signedIn('user-1');
    controller.noteTaskStarted();
    expect(controller.getSoftPrompt().visible).toBe(false);
    await controller.unregisterOnSignOut();
    expect(api.unregister).not.toHaveBeenCalled();
  });

  describe('taps', () => {
    const tap = (data: unknown, actionId = 'tap'): PushActionEvent => ({ actionId, notification: { data } });

    it('navigates in the app once the router is ready', () => {
      const { controller, plugin } = setup();
      controller.start();
      const navigate = vi.fn();
      controller.setNavigator(navigate);
      plugin.emit('pushNotificationActionPerformed', tap({ kind: 'task_finished', path: '/c/42' }));
      expect(navigate).toHaveBeenCalledWith('/c/42');
    });

    it('queues a cold-start tap until the router mounts, then applies it once', () => {
      const { controller, plugin, session } = setup();
      controller.start();
      plugin.emit('pushNotificationActionPerformed', tap({ path: '/c/42' }));
      expect(readPendingTap(session, NOW)).toBe('/c/42');

      const navigate = vi.fn();
      controller.setNavigator(navigate);
      expect(navigate).toHaveBeenCalledWith('/c/42');
      expect(session.data.has(PENDING_TAP_KEY)).toBe(false);

      const cleanup = controller.setNavigator(navigate);
      expect(navigate).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it('keeps the last queued tap only', () => {
      const { controller, plugin } = setup();
      controller.start();
      plugin.emit('pushNotificationActionPerformed', tap({ path: '/c/1' }));
      plugin.emit('pushNotificationActionPerformed', tap({ path: '/c/2' }));
      const navigate = vi.fn();
      controller.setNavigator(navigate);
      expect(navigate.mock.calls).toEqual([['/c/2']]);
    });

    it('survives the sign-in reload through sessionStorage', () => {
      const before = setup();
      before.controller.start();
      before.plugin.emit('pushNotificationActionPerformed', tap({ path: '/c/9' }));

      const after = setup({ sessionStorage: before.session });
      after.controller.start();
      const navigate = vi.fn();
      after.controller.setNavigator(navigate);
      expect(navigate).toHaveBeenCalledWith('/c/9');
    });

    it('queues again after the router unmounts', () => {
      const { controller, plugin } = setup();
      controller.start();
      const first = vi.fn();
      const cleanup = controller.setNavigator(first);
      cleanup();
      plugin.emit('pushNotificationActionPerformed', tap({ path: '/c/3' }));
      expect(first).not.toHaveBeenCalled();
      const second = vi.fn();
      controller.setNavigator(second);
      expect(second).toHaveBeenCalledWith('/c/3');
    });

    it('opens a shared artifact in the system browser, router or not', () => {
      const { controller, plugin, openExternal } = setup();
      controller.start();
      plugin.emit('pushNotificationActionPerformed', tap({ kind: 'artifact_shared', url: 'https://view.mindshub.ai/a/1' }));
      expect(openExternal).toHaveBeenCalledWith('https://view.mindshub.ai/a/1');
    });

    it('ignores a dismiss and a payload with nowhere to go', () => {
      const { controller, plugin, openExternal } = setup();
      controller.start();
      const navigate = vi.fn();
      controller.setNavigator(navigate);
      plugin.emit('pushNotificationActionPerformed', tap({ path: '/c/1' }, 'dismiss'));
      plugin.emit('pushNotificationActionPerformed', tap({ kind: 'task_finished' }));
      expect(navigate).not.toHaveBeenCalled();
      expect(openExternal).not.toHaveBeenCalled();
    });

    it('attaches its listeners once', () => {
      const { controller, plugin } = setup();
      controller.start();
      controller.start();
      expect(plugin.addListener).toHaveBeenCalledTimes(3);
    });
  });

  describe('sign-out', () => {
    it('removes this device token from the user and keeps the OS registration', async () => {
      const { controller, plugin, api } = setup();
      const unregisterNative = vi.fn();
      (plugin as unknown as { unregister: unknown }).unregister = unregisterNative;
      controller.start();
      await controller.signedIn('user-1');
      plugin.emit('registration', { value: 't1' });
      await flush();

      await controller.unregisterOnSignOut();

      expect(api.unregister).toHaveBeenCalledWith('t1');
      expect(unregisterNative).not.toHaveBeenCalled();
    });

    it('never rejects, and the next user re-sends the same token', async () => {
      const { controller, plugin, api, log } = setup();
      api.unregister.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));
      controller.start();
      await controller.signedIn('user-1');
      plugin.emit('registration', { value: 't1' });
      await flush();

      await expect(controller.unregisterOnSignOut()).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith('could not unregister this device', expect.any(Error));

      await controller.signedIn('user-2');
      plugin.emit('registration', { value: 't1' });
      await flush();
      expect(api.register).toHaveBeenLastCalledWith(expect.objectContaining({ token: 't1' }));
      expect(api.register).toHaveBeenCalledTimes(2);
    });

    it('has nothing to remove when this session never got a token', async () => {
      const { controller, api } = setup({ permission: 'prompt' });
      await controller.signedIn('user-1');
      await controller.unregisterOnSignOut();
      expect(api.unregister).not.toHaveBeenCalled();
    });

    it('hides an open soft prompt', async () => {
      const { controller } = setup({ permission: 'prompt' });
      await controller.signedIn('user-1');
      controller.noteTaskStarted();
      await controller.unregisterOnSignOut();
      expect(controller.getSoftPrompt().visible).toBe(false);
    });
  });
});

describe('outside the mobile app', () => {
  it('has no controller and every entry point is a no-op', async () => {
    expect(mobilePush()).toBeNull();
    const cleanup = setMobilePushNavigator(vi.fn());
    expect(() => cleanup()).not.toThrow();
    await expect(unregisterMobilePushOnSignOut()).resolves.toBeUndefined();
  });
});
