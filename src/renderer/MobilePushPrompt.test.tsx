import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MobilePushPrompt } from './MobilePushPrompt';
import { createMobilePush, type PushPermission } from './lib/mobilePush';

function controllerWith(permission: PushPermission) {
  const plugin = {
    checkPermissions: vi.fn(async () => ({ receive: permission })),
    requestPermissions: vi.fn(async () => ({ receive: 'granted' as const })),
    register: vi.fn(async () => {}),
    addListener: vi.fn(),
  };
  const storage = new Map<string, string>();
  const controller = createMobilePush({
    platform: 'ios',
    appVersion: '1.0.0',
    getPlugin: () => plugin as never,
    api: { register: vi.fn(async () => ({})), unregister: vi.fn(async () => ({})) },
    storage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => { storage.set(k, v); },
      removeItem: (k) => { storage.delete(k); },
    },
    sessionStorage: null,
    openExternal: vi.fn(),
    log: vi.fn(),
  });
  return { controller, plugin, storage };
}

afterEach(cleanup);

describe('MobilePushPrompt', () => {
  it('renders nothing outside the app or until offered', async () => {
    render(<MobilePushPrompt controller={null} />);
    expect(screen.queryByTestId('mobile-push-prompt')).toBeNull();

    const { controller } = controllerWith('prompt');
    await controller.signedIn('user-1');
    render(<MobilePushPrompt controller={controller} />);
    expect(screen.queryByTestId('mobile-push-prompt')).toBeNull();
  });

  it('appears when the first task starts; "Turn on" asks the OS and registers', async () => {
    const { controller, plugin } = controllerWith('prompt');
    await controller.signedIn('user-1');
    render(<MobilePushPrompt controller={controller} />);

    act(() => controller.noteTaskStarted());
    expect(screen.getByText('Get notified when your tasks finish')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn on' })); });
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(plugin.register).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('mobile-push-prompt')).toBeNull();
  });

  it('"Not now" hides it and snoozes the offer', async () => {
    const { controller, plugin, storage } = controllerWith('prompt');
    await controller.signedIn('user-1');
    render(<MobilePushPrompt controller={controller} />);
    act(() => controller.noteTaskStarted());

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('mobile-push-prompt')).toBeNull();
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(storage.size).toBe(1);
  });
});
