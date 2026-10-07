import { describe, it, expect } from 'vitest';
import { surfaceCopy } from './surface';

// ENG-2172 and ENG-2169: the web and desktop apps look the same but keep
// separate work, and nothing on screen said which one the user was in.
describe('surfaceCopy', () => {
  it('points at the desktop app on web', () => {
    const copy = surfaceCopy(true);
    expect(copy.tasksNote).toBe('Tasks made in the desktop app stay there.');
    expect(copy.artifactsNote).toBe('Artifacts made in the desktop app stay there.');
  });

  it('points at the web app on desktop', () => {
    const copy = surfaceCopy(false);
    expect(copy.tasksNote).toBe('Tasks made in the web app stay there.');
    expect(copy.artifactsNote).toBe('Artifacts made in the web app stay there.');
  });
});
