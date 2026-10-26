import { describe, it, expect } from 'vitest';
import { normalizeComposerDisabledConnections, toggleConnectionMute } from './connectionMutes';

const GMAIL = { engine: 'gmail', name: 'mail' };
const SLACK = { engine: 'slack', name: 'team' };

describe('normalizeComposerDisabledConnections', () => {
  it('reads a missing list as no mutes', () => {
    expect(normalizeComposerDisabledConnections(undefined)).toEqual([]);
  });

  it('trims entries and drops incomplete ones', () => {
    expect(normalizeComposerDisabledConnections([
      { engine: ' gmail ', name: 'mail ' },
      { engine: 'slack' },
    ])).toEqual([GMAIL]);
  });
});

describe('toggleConnectionMute', () => {
  it('mutes a connection once', () => {
    const muted = toggleConnectionMute([SLACK], GMAIL, false);
    expect(muted).toEqual([SLACK, GMAIL]);
    expect(toggleConnectionMute(muted, GMAIL, false)).toBe(muted);
  });

  it('unmutes a connection, matching the engine case-insensitively', () => {
    expect(toggleConnectionMute([GMAIL, SLACK], { engine: 'GMAIL', name: 'mail' }, true)).toEqual([SLACK]);
  });

  it('returns the same list when nothing changes, so a setter can skip the render', () => {
    const list = [SLACK];
    expect(toggleConnectionMute(list, GMAIL, true)).toBe(list);
    expect(toggleConnectionMute(list, { engine: '', name: 'x' }, false)).toBe(list);
  });

  it('starts a chat record with no mutes field from an empty list', () => {
    expect(toggleConnectionMute(undefined, GMAIL, false)).toEqual([GMAIL]);
    expect(toggleConnectionMute(undefined, GMAIL, true)).toEqual([]);
  });
});
