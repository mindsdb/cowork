import { describe, it, expect } from 'vitest';
import { surfaceCopy } from './surface';

// ENG-2172 and ENG-2169: the web and desktop apps look the same but keep
// separate work, and nothing on screen said which one the user was in.
describe('surfaceCopy', () => {
  it('names the web app and points at the desktop app on web', () => {
    const copy = surfaceCopy(true);
    expect(copy.label).toBe('Web app');
    expect(copy.detail).toBe('Tasks and artifacts made here stay in the web app. The desktop app keeps its own.');
    expect(copy.tasksNote).toBe('Tasks made in the desktop app stay there.');
    expect(copy.artifactsNote).toBe('Artifacts made in the desktop app stay there.');
  });

  it('names the desktop app and points at the web app on desktop', () => {
    const copy = surfaceCopy(false);
    expect(copy.label).toBe('Desktop app');
    expect(copy.detail).toBe('Tasks and artifacts made here stay in the desktop app. The web app keeps its own.');
    expect(copy.tasksNote).toBe('Tasks made in the web app stay there.');
    expect(copy.artifactsNote).toBe('Artifacts made in the web app stay there.');
  });
});
