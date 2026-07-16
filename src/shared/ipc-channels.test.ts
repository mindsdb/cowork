import { describe, it, expect } from 'vitest';
import { IPC } from './ipc-channels';

// Contract guard: channel strings are the main↔renderer wire protocol.
// A duplicate value silently routes two features onto one handler; a renamed
// value breaks any renderer (including an OTA-updated one running against an
// older main process) that still sends the old name. Renames must be treated
// as breaking changes, not refactors.
//
// The preload↔host bridge-shape check (qa.md §5a.5) needs an `electron` mock
// and lands with the Phase 3 renderer work.
describe('IPC channel contract', () => {
  const entries = Object.entries(IPC);

  it('has no duplicate channel values', () => {
    const values = entries.map(([, v]) => v);
    const dupes = values.filter((v, i) => values.indexOf(v) !== i);
    expect(dupes).toEqual([]);
  });

  it('every channel is a non-empty "namespace:action" string', () => {
    for (const [key, value] of entries) {
      expect(value, `IPC.${key}`).toMatch(/^[a-z-]+:[a-z-]+$/);
    }
  });

  it('locks the full channel map (a rename here is a breaking protocol change)', () => {
    // If this snapshot fails, you renamed/removed a channel. That breaks any
    // renderer bundle still sending the old name (OTA UI can lag the main
    // process). Add new channels freely; treat renames as migrations.
    expect(IPC).toMatchSnapshot();
  });
});
