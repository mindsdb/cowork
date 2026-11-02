import { EventEmitter } from 'events';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { installQuitSignalHandlers, QUIT_SIGNALS } from './quit-signals';

function fakeProcess() {
  const emitter = new EventEmitter();
  return emitter as EventEmitter & Pick<NodeJS.Process, 'on'>;
}

describe('installQuitSignalHandlers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(QUIT_SIGNALS)('quits on %s and logs which signal', (signal) => {
    const proc = fakeProcess();
    const quit = vi.fn();
    vi.stubEnv('LOG_LEVEL', 'INFO');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    installQuitSignalHandlers(quit, proc);

    proc.emit(signal);

    expect(quit).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(entry).toMatchObject({ logger: 'main.quit-signals', event: 'quit_signal_received', exit_signal: signal });
  });

  // Regression: one Ctrl-C under `npm run dev` arrives as several SIGINTs. Each
  // extra quit() would let the app exit before the sidecar drain finished.
  it('quits only once when signals repeat', () => {
    const proc = fakeProcess();
    const quit = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    installQuitSignalHandlers(quit, proc);

    proc.emit('SIGINT');
    proc.emit('SIGINT');
    proc.emit('SIGTERM');

    expect(quit).toHaveBeenCalledTimes(1);
  });
});
