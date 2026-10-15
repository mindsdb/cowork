import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('electron', () => ({ dialog: { showErrorBox: vi.fn() } }));

import { installMainErrorDialog, isChromiumNetError } from './main-error-dialog';

const runnerListeners = process.listeners('uncaughtException');

afterEach(() => {
  for (const listener of process.listeners('uncaughtException')) {
    if (!runnerListeners.includes(listener)) process.off('uncaughtException', listener);
  }
  vi.restoreAllMocks();
});

// Call only the listener under test; emitting would also reach the runner's own.
function fireUncaught(err: Error): void {
  const added = process.listeners('uncaughtException').filter((l) => !runnerListeners.includes(l));
  for (const listener of added) listener(err, 'uncaughtException');
}

describe('isChromiumNetError', () => {
  it('matches Chromium net errors only', () => {
    expect(isChromiumNetError(new Error('net::ERR_NETWORK_CHANGED'))).toBe(true);
    expect(isChromiumNetError(new Error('ECONNRESET'))).toBe(false);
    expect(isChromiumNetError('net::ERR_NETWORK_CHANGED')).toBe(false);
  });
});

describe('installMainErrorDialog', () => {
  it('logs a net error from a listener-less request instead of showing the dialog', () => {
    const showErrorBox = vi.fn();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    installMainErrorDialog(showErrorBox);
    fireUncaught(new Error('net::ERR_NETWORK_CHANGED'));
    expect(showErrorBox).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
  });

  it('keeps the dialog for any other uncaught error', () => {
    const showErrorBox = vi.fn();
    installMainErrorDialog(showErrorBox);
    const err = new TypeError('boom');
    fireUncaught(err);
    expect(showErrorBox).toHaveBeenCalledExactlyOnceWith(
      'A JavaScript error occurred in the main process',
      `Uncaught Exception:\n${err.stack}`,
    );
  });
});
