import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui/Toast';
import { useLiveAppAvailability } from './useLiveAppAvailability';
import { acknowledgeLiveAppAvailability, fetchLiveAppAvailability } from '../api';
import { setLiveApps } from '../../lib/liveApps';

vi.mock('../api', () => ({
  acknowledgeLiveAppAvailability: vi.fn(),
  fetchLiveAppAvailability: vi.fn(),
}));
vi.mock('../../../shared/diagnostics', () => ({ diagnostic: vi.fn() }));

const MESSAGE = 'A live-app slot is available. Ask your agent to launch your app again.';
const pending = { scope: 'person-a', waiting: true, notice: null };
const available = { ...pending, notice: { id: 'notice-1', message: MESSAGE } };
let displayedAtAcknowledgement;

function Watcher({ accountScope }) {
  useLiveAppAvailability(accountScope);
  return null;
}
function App({ accountScope = 'proxy-session' }) {
  return <ToastProvider><Watcher accountScope={accountScope} /></ToastProvider>;
}
const settle = () => act(async () => {});
const tick = (ms = 15_000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function visibility(value) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  setLiveApps(true);
  fetchLiveAppAvailability.mockResolvedValue(pending);
  displayedAtAcknowledgement = [];
  acknowledgeLiveAppAvailability.mockImplementation(async () => {
    // Assert this outside the mock: the watcher catches acknowledgement errors,
    // so an assertion thrown here could otherwise be swallowed as a retry.
    displayedAtAcknowledgement.push({
      visible: document.visibilityState === 'visible',
      rendered: screen.queryByText(MESSAGE) !== null,
    });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('live-app availability notices', () => {
  it('notifies a refused person within a minute without a chat or any app cards', async () => {
    render(<App />);
    await settle();
    expect(fetchLiveAppAvailability).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();

    fetchLiveAppAvailability.mockResolvedValue(available);
    await tick();

    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    expect(acknowledgeLiveAppAvailability).toHaveBeenCalledExactlyOnceWith('notice-1');
    expect(displayedAtAcknowledgement).toEqual([{ visible: true, rendered: true }]);
    await tick(60_000);
    expect(screen.getAllByText(MESSAGE)).toHaveLength(1);
    expect(acknowledgeLiveAppAvailability).toHaveBeenCalledTimes(1);
  });

  it('keeps one visible toast and retries an acknowledgement whose reply failed', async () => {
    fetchLiveAppAvailability.mockResolvedValue(available);
    acknowledgeLiveAppAvailability.mockRejectedValueOnce(new Error('offline'));
    render(<App />);
    await settle();
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    expect(acknowledgeLiveAppAvailability).toHaveBeenCalledTimes(1);

    await tick();
    expect(screen.getAllByText(MESSAGE)).toHaveLength(1);
    expect(acknowledgeLiveAppAvailability).toHaveBeenCalledTimes(2);
    await tick();
    expect(acknowledgeLiveAppAvailability).toHaveBeenCalledTimes(2);
  });

  it('leaves a notice on the server if the tab hides while its request is pending', async () => {
    const read = deferred();
    fetchLiveAppAvailability.mockReturnValueOnce(read.promise);
    render(<App />);
    await settle();
    act(() => visibility('hidden'));
    await act(async () => { read.resolve(available); });
    await tick(60_000);
    expect(fetchLiveAppAvailability).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
    expect(acknowledgeLiveAppAvailability).not.toHaveBeenCalled();

    fetchLiveAppAvailability.mockResolvedValue(available);
    act(() => visibility('visible'));
    await settle();
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    expect(acknowledgeLiveAppAvailability).toHaveBeenCalledTimes(1);
  });

  it('makes no hidden-tab reads and checks immediately when the window receives focus', async () => {
    act(() => visibility('hidden'));
    render(<App />);
    await tick(60_000);
    expect(fetchLiveAppAvailability).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fetchLiveAppAvailability.mockResolvedValue(available);
    act(() => window.dispatchEvent(new Event('focus')));
    await settle();
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
  });

  it('keeps the current notice through a failed read and retries on the next tick', async () => {
    fetchLiveAppAvailability.mockResolvedValue(available);
    render(<App />);
    await settle();
    fetchLiveAppAvailability.mockRejectedValueOnce(new Error('offline'));
    await tick();
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    await tick();
    expect(fetchLiveAppAvailability).toHaveBeenCalledTimes(3);
    expect(screen.getAllByText(MESSAGE)).toHaveLength(1);
  });

  it('drops an old in-flight result when the browser account identity changes', async () => {
    const read = deferred();
    fetchLiveAppAvailability.mockReturnValueOnce(read.promise);
    const view = render(<App accountScope="person-a" />);
    await settle();
    fetchLiveAppAvailability.mockResolvedValue({ scope: 'person-b', waiting: false, notice: null });
    view.rerender(<App accountScope="person-b" />);
    await settle();
    await act(async () => { read.resolve(available); });
    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
    expect(acknowledgeLiveAppAvailability).not.toHaveBeenCalled();
  });

  it("closes the previous proxy identity's notice when the server reports a different scope", async () => {
    fetchLiveAppAvailability.mockResolvedValue(available);
    render(<App />);
    await settle();
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    fetchLiveAppAvailability.mockResolvedValue({ scope: 'person-b', waiting: false, notice: null });
    await tick();
    await tick(1_000);
    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
  });

  it('clears the previous notice when authentication is refused', async () => {
    fetchLiveAppAvailability.mockResolvedValue(available);
    render(<App />);
    await settle();
    fetchLiveAppAvailability.mockRejectedValue(Object.assign(new Error('signed out'), { status: 401 }));
    await tick();
    await tick(1_000);
    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
  });

  it('does nothing with the capability off and removes its toast when it turns off', async () => {
    setLiveApps(false);
    render(<App />);
    await tick(60_000);
    expect(fetchLiveAppAvailability).not.toHaveBeenCalled();
    fetchLiveAppAvailability.mockResolvedValue(available);
    act(() => setLiveApps(true));
    await settle();
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    act(() => setLiveApps(false));
    await tick(60_000);
    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
    expect(fetchLiveAppAvailability).toHaveBeenCalledTimes(1);
  });
});
