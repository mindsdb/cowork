// The two native boundaries the renderer test cannot see.
//
// `host.test.ts` stubs the bridge, so it proves the renderer picks the right
// method — and nothing more. Dropping the "a person chose this" flag in preload
// or in the IPC handler stays type-correct, keeps `canPickOrganization()` true
// and leaves the picker on screen, while the entitlement fallback silently
// overrides the answer again. That is this ticket's original defect, restored
// at a layer no existing test looks at (ENG-2199).
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
   * Read from source rather than executed: `index.ts` registers every handler
   * in the app at import and pulls in Electron, the server process and the
   * installer with them. The seam being guarded is one argument crossing one
   * boundary, and `organizationLabelSurfaces.test.js` already establishes
   * source reading as how this repo pins a wiring seam a unit test walks past.
   */
  const src = readFileSync(resolve(__dirname, 'index.ts'), 'utf-8');
  const start = src.indexOf('ipcMain.handle(IPC.MINDSHUB_FINALIZE');
  const handler = start < 0 ? '' : src.slice(start, src.indexOf('\n  });', start));

  /**
   * Just the arguments of the `selectEntitledOrg(...)` call, not everything
   * after it. Scoping matters: with the wider slice, deleting the forwarding
   * and leaving any later mention of the name — a comment is enough — left
   * this green while the flag was being dropped.
   */
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
