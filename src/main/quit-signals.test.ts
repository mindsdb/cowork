import { EventEmitter } from 'events';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { installQuitSignalHandlers, QUIT_SIGNALS } from './quit-signals';

function fakeProcess() {
  const emitter = new EventEmitter();
  return emitter as EventEmitter & Pick<NodeJS.Process, 'on'>;
}

function fakeApp() {
  let ready!: () => void;
  const whenReadyPromise = new Promise<void>((resolve) => { ready = resolve; });
  return { whenReady: () => whenReadyPromise, quit: vi.fn(), ready };
}

describe('installQuitSignalHandlers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(QUIT_SIGNALS)('quits on %s and logs which signal', async (signal) => {
    const proc = fakeProcess();
    const app = fakeApp();
    vi.stubEnv('LOG_LEVEL', 'INFO');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const installed = installQuitSignalHandlers(app, proc);
    app.ready();
    await installed;

    proc.emit(signal);

    expect(app.quit).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(entry).toMatchObject({ logger: 'main.quit-signals', event: 'quit_signal_received', exit_signal: signal });
  });

  // Regression: one Ctrl-C under `npm run dev` arrives as several SIGINTs. Each
  // extra quit() would let the app exit before the sidecar drain finished.
  it('quits only once when signals repeat', async () => {
    const proc = fakeProcess();
    const app = fakeApp();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const installed = installQuitSignalHandlers(app, proc);
    app.ready();
    await installed;

    proc.emit('SIGINT');
    proc.emit('SIGINT');
    proc.emit('SIGTERM');

    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  // Electron's native signal handlers, installed during startup, replace any
  // registered before them. Ours must wait for ready so they are installed last.
  it('registers no handler until the app is ready', async () => {
    const proc = fakeProcess();
    const app = fakeApp();
    const installed = installQuitSignalHandlers(app, proc);
    await Promise.resolve();

    for (const signal of QUIT_SIGNALS) expect(proc.listenerCount(signal)).toBe(0);

    app.ready();
    await installed;
    for (const signal of QUIT_SIGNALS) expect(proc.listenerCount(signal)).toBe(1);
  });
});
