import { EventEmitter } from 'events';
import { describe, it, expect, vi } from 'vitest';
import { installQuitSignalHandlers, QUIT_SIGNALS } from './quit-signals';

function fakeProcess() {
  const emitter = new EventEmitter();
  return emitter as EventEmitter & Pick<NodeJS.Process, 'on'>;
}

describe('installQuitSignalHandlers', () => {
  it.each(QUIT_SIGNALS)('quits on %s', (signal) => {
    const proc = fakeProcess();
    const quit = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    installQuitSignalHandlers(quit, proc);

    proc.emit(signal);

    expect(quit).toHaveBeenCalledTimes(1);
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
