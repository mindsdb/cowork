import { describe, it, expect } from 'vitest';
import { IPC } from './ipc-channels';

// IPC strings are a versioned wire contract: duplicate values collide, and renames break mixed
// OTA/main versions.
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
    // Snapshot changes to existing names require migration; OTA renderer and main can run different
    // versions.
    expect(IPC).toMatchSnapshot();
  });
});
