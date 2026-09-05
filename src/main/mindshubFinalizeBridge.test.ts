// Verify the explicit-choice flag crosses preload and IPC; renderer bridge mocks cannot catch
// either layer dropping it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { IPC } from '../shared/ipc-channels';

const invoke = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const exposed = vi.hoisted(() => ({ current: null as Record<string, any> | null }));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Record<string, any>) => { exposed.current = api; },
  },
  ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn(), send: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}));

describe('preload carries the explicit pick', () => {
  beforeEach(async () => {
    invoke.mockClear();
    vi.resetModules();
    await import('./preload');
  });

  it('exposes the capability method an older shell does not have', () => {
    expect(typeof exposed.current?.mindshubFinalizeChosen).toBe('function');
  });

  it('appends the flag itself, so the renderer cannot forget it', async () => {
    await exposed.current!.mindshubFinalizeChosen('org-beta');
    // The literal `true` is the point: this method exists precisely so the
    // flag is not something a caller has to remember to pass.
    expect(invoke).toHaveBeenCalledWith(IPC.MINDSHUB_FINALIZE, 'org-beta', true);
  });

  it('leaves the original method able to send no pick at all', async () => {
    await exposed.current!.mindshubFinalize();
    expect(invoke).toHaveBeenCalledWith(IPC.MINDSHUB_FINALIZE, undefined, undefined);
  });
});

describe('the finalize IPC handler forwards the flag', () => {
  /*
   * Read the argument-forwarding seam from source; importing index.ts initializes unrelated
   * Electron/server/installer handlers.
   */
  const src = readFileSync(resolve(__dirname, 'index.ts'), 'utf-8');
  const start = src.indexOf('ipcMain.handle(IPC.MINDSHUB_FINALIZE');
  const handler = start < 0 ? '' : src.slice(start, src.indexOf('\n  });', start));

  /** Scope to selectEntitledOrg arguments so a later mention cannot mask missing flag forwarding. */
  const selectCall = (() => {
    const at = handler.indexOf('selectEntitledOrg(');
    if (at < 0) return '';
    const end = handler.indexOf('});', at);
    return end < 0 ? handler.slice(at) : handler.slice(at, end + 3);
  })();

  it('locates the handler at all, so the assertions below are not vacuous', () => {
    expect(start).toBeGreaterThan(-1);
    expect(selectCall).toContain('selectEntitledOrg(');
  });

  it('accepts the flag off the wire', () => {
    expect(handler).toMatch(/chosenByUser\??:\s*boolean/);
  });

  it('passes it into selectEntitledOrg rather than dropping it', () => {
    expect(selectCall).toMatch(/chosenByUser\s*:/);
  });

  it('compares it strictly, so a truthy non-boolean cannot arm the flag', () => {
    // `Boolean(chosenByUser)` would treat the string "false" as a choice.
    expect(selectCall).toMatch(/chosenByUser:\s*chosenByUser === true/);
  });
});
