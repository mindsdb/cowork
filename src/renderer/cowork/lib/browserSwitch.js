/* Where the shared browser shows up around a task: the + menu's Browser
   switch, the browser a new task starts with, and a task's pane and web
   warm-up. Settings has the person's own switch (on by default), and
   GET /browse/status says whether this deployment offers the browser now
   (hooks/useBrowseAvailable). */

/**
 * Whether the + menu shows its Browser switch: on in Settings, and offered
 * here. Off in Settings, no task gets the browser, so there is nothing to
 * switch; where it isn't offered (a self-hosted stack, no decisions model to
 * pick its steps), neither. On the web the browser runs in MindsDB's cloud,
 * which takes only a MindsHub credential, so it is offered only where
 * MindsHub is the LLM provider (`webWithoutMindsHub` false), whatever an
 * older server answers.
 *
 * @param {{ browserOnInSettings: boolean, browseAvailable: boolean, webWithoutMindsHub?: boolean }} gates
 * @returns {boolean}
 */
export function showsBrowserSwitch({ browserOnInSettings, browseAvailable, webWithoutMindsHub = false }) {
  return browserOnInSettings && browseAvailable && !webWithoutMindsHub;
}

/**
 * Whether a task the Home composer creates starts with its browser off. A
 * caller's own choice wins (the artifact viewer passes one). Otherwise the
 * composer's switch decides whenever Settings has the browser on, shown or
 * not: availability only hides the switch, and never drops an Off the person
 * set. Sending Off where no browser runs changes nothing.
 *
 * @param {{ callerBrowserOff?: boolean, browserOnInSettings: boolean, composerBrowserOff: boolean }} choice
 * @returns {boolean}
 */
export function newTaskBrowserOff({ callerBrowserOff, browserOnInSettings, composerBrowserOff }) {
  return !!(callerBrowserOff ?? (browserOnInSettings && composerBrowserOff));
}

/**
 * Whether a task's Browser steps open the pane and, on the web, the task
 * starts its browser early: the + menu offers the browser, and the task's own
 * switch is on.
 *
 * @param {{ switchShown: boolean, taskBrowserOff?: boolean }} task
 * @returns {boolean}
 */
export function taskBrowserOn({ switchShown, taskBrowserOff }) {
  return switchShown && !taskBrowserOff;
}
