import { describe, expect, it } from 'vitest';
import { newTaskBrowserOff, showsBrowserSwitch, taskBrowserOn } from './browserSwitch';

describe('showsBrowserSwitch', () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('on in Settings %s, offered here %s: the + menu shows the switch %s', (browserOnInSettings, browseAvailable, shown) => {
    expect(showsBrowserSwitch({ browserOnInSettings, browseAvailable })).toBe(shown);
  });
});

describe('newTaskBrowserOff', () => {
  it("keeps the person's Off while the switch is hidden, as long as Settings has the browser on", () => {
    /* A status read that answers unavailable between Off and Send hides the
       switch; the Off still goes with the new task. */
    expect(newTaskBrowserOff({ browserOnInSettings: true, composerBrowserOff: true })).toBe(true);
  });

  it('starts with the browser on when the composer switch is on', () => {
    expect(newTaskBrowserOff({ browserOnInSettings: true, composerBrowserOff: false })).toBe(false);
  });

  it('sends no Off of its own while Settings has the browser off, since no task gets it', () => {
    expect(newTaskBrowserOff({ browserOnInSettings: false, composerBrowserOff: true })).toBe(false);
  });

  it("lets a caller's own choice win over the composer", () => {
    expect(newTaskBrowserOff({ callerBrowserOff: false, browserOnInSettings: true, composerBrowserOff: true })).toBe(false);
    expect(newTaskBrowserOff({ callerBrowserOff: true, browserOnInSettings: true, composerBrowserOff: false })).toBe(true);
  });
});

describe('taskBrowserOn', () => {
  it("opens the pane and warms the browser only where the + menu offers it and the task's switch is on", () => {
    expect(taskBrowserOn({ switchShown: true, taskBrowserOff: false })).toBe(true);
    expect(taskBrowserOn({ switchShown: true, taskBrowserOff: undefined })).toBe(true);
    expect(taskBrowserOn({ switchShown: true, taskBrowserOff: true })).toBe(false);
    // A not_entitled or organization_off account: no pane and no warm-up.
    expect(taskBrowserOn({ switchShown: false, taskBrowserOff: false })).toBe(false);
  });
});
